/**
 * `npm.cmd run check:balance` — the balance engine's proof (موجودی حساب).
 *
 * The owner's rule, verbatim: money paid for a seat that is given up lands on the
 * account's balance — **never in cash** — and the next seat spends it
 * automatically before asking anybody for anything. Four writers make that true
 * (`src/server/balance-core.ts`), the two seat engines call them
 * (`src/server/registration-core.ts`), and the manager's board calls them too
 * (`src/server/actions/admin-session-manage.ts`). A `"use server"` module with
 * `server-only` imports cannot be driven by a `tsx` script, so this harness
 * exercises the **same pieces those actions call** (`refundSeatToBalance`,
 * `chargeSeatFromBalance`, `lockBalances`, `findNextWaiter`, `promoteFromQueue`)
 * inside transactions shaped exactly like the actions' bodies — and asserts every
 * claim against the **database**, never against the engine's own answer:
 *
 *   1. a fresh account with a zero balance takes a seat: `CONFIRMED`, `UNPAID`,
 *      nothing off the balance and **no** `BalanceEntry` row;
 *   2. the manager's hand: one `ADMIN_ADJUST` credit, a subtract larger than the
 *      balance refused (`INSUFFICIENT`, nothing moves), `delta 0` a clean no-op
 *      with no row, an unknown account `NOT_FOUND`;
 *   3. a seat the balance covers entirely: `PAID_BALANCE`, `paidAt` stamped, the
 *      balance down by exactly the price, one `REGISTRATION_DEDUCT`;
 *   4. a half-covered seat: the spent part is stated, the row stays `UNPAID` and
 *      still owes the rest — `seatOutstanding` says how much;
 *   5. the **price snapshot**: a manager's price edit never re-prices a seat that
 *      was already taken, so the cancel refunds the seat's own `amountToman`;
 *   6. the cancel: the refund lands on the balance with one `CANCEL_REFUND`, and
 *      the freed seat promotes the first waiter **straight into `CONFIRMED`** —
 *      charging that account's balance; a `WAITLIST` row cancelling pays nothing;
 *   7. the **mirror**: two cancels, each refunding one player while charging the
 *      other, fired at the same instant in both directions — the reason
 *      `lockBalances` exists. Both must succeed (no deadlock) and end with every
 *      balance exactly right;
 *   8. the ledger invariant: `User.balance` equals the sum of that account's
 *      `BalanceEntry.amount` rows, every row's `balanceAfter` chains, and the last
 *      row of a ledger explains the current column without replaying history;
 *   9. the membership gate: a `PENDING` account's registration is refused
 *      (`NOT_APPROVED`) and moves no money; after the manager approves, the very
 *      same call lands a seat and charges the balance;
 *  10. a **late** cancel refunds exactly like a free one, penalty or not — the
 *      penalty engine itself is `check:attendance`'s ground, and this script only
 *      ever asserts the money of it;
 *  11. the manager's own board writes, simulated faithfully through their pieces:
 *      «حذف ثبت‌نام» (refund the removed seat, promote the first waiter),
 *      «ارتقای دستی از لیست انتظار» (charge the pulled-up account) and
 *      «لغو کل سانس» (send every live row's money back in one lock order).
 *
 * It is safe to re-run and it **never touches seeded rows**: every row it creates
 * lives under its own reserved ids (`balcheck_*`, `eitaaId` 970000001…) and both
 * the start-up release and the final cleanup refuse to delete anything outside
 * that reservation. Do not run it next to `check:race` / `check:attendance` /
 * `db:seed` — it only ever touches its own ids anyway.
 *
 * Exit code 0 = every assertion held («PASS»), 1 = something broke («FAIL»).
 *
 * Run from the project root (`npm.cmd run check:balance`), with MySQL/MariaDB up.
 */
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient, type RegistrationStatus } from "../src/generated/prisma/client";
import { cancelRefundToman, seatBalanceUsed, seatOutstanding } from "../src/lib/balance";
import { formatToman, toPersianDigits } from "../src/lib/format";
import {
  adjustBalanceByAdmin,
  chargeSeatFromBalance,
  lockBalances,
  refundSeatToBalance,
} from "../src/server/balance-core";
import { decideMembership } from "../src/server/membership-core";
import {
  cancelSeat,
  findNextWaiter,
  MEMBER_PENDING,
  promoteFromQueue,
  registerSeat,
} from "../src/server/registration-core";

// `@next/env` is the loader `next dev` and the server actions use, so the
// `DATABASE_URL` here is byte-for-byte the one the app connects with (a hand
// rolled dotenv read would not be). It is loaded before the first `process.env`
// read below — the imports above never touch it.
loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });

/** The connection string the app itself uses — resolved exactly the same way. */
function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("FAIL — DATABASE_URL تنظیم نشده؛ .env را بساز و دوباره بزن.");
    process.exit(1);
  }
  return url;
}

const databaseUrl = requireDatabaseUrl();
const client = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

// ---------------------------------------------------------------------------
// The reservation — the only rows this script is allowed to create or delete
// ---------------------------------------------------------------------------

/** `970000001` … — seeded players live at `100000000`/`2000000xx`. */
const RESERVED_EITAA_PREFIX = "9700000";
/** Every id this script invents starts with this. Seeded ids start with `seed_`. */
const RESERVED_ID_PREFIX = "balcheck_";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Pinned on every session this script creates, so the seeded `Setting` row never decides it. */
const FREE_CANCEL_HOURS = 12;

// ---------------------------------------------------------------------------
// The money of the fixture — the numbers every assertion below expects
// ---------------------------------------------------------------------------

/** The main seat price: the zero-balance, full-cover and mirror stories are all priced exactly this. */
const SEAT_PRICE = 20_000;
/**
 * What the manager edits `balcheck_session_funded` to **after** its seats exist.
 * A taken seat keeps its own snapshot, so this number must never show up in a
 * charge or a refund.
 */
const BUMPED_PRICE = 35_000;
/** The manager's own hall, priced differently on purpose — the formulas are not wired to 20,000. */
const MANAGER_PRICE = 25_000;
/** The ledger story's price. */
const LEDGER_PRICE = 10_000;

const FUNDED_CREDIT = 60_000;
const PARTIAL_CREDIT = 8_000;
const GATE_CREDIT = 30_000;
const MIRROR_CREDIT = 40_000;
const LEDGER_CREDIT = 50_000;
const LEDGER_FINAL_SUBTRACT = 15_000;
const MGR_MANUAL_CREDIT = 10_000;

// ---------------------------------------------------------------------------
// Tiny assertion kit — one Persian line per assertion, `ok` / `FAIL` tag first
// ---------------------------------------------------------------------------

let checks = 0;
let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? `\n       ↳ ${detail}` : ""}`);
}

function group(title: string): void {
  console.log(`\n${title}`);
}

/** A rejected promise is a failure of its own: the engines never throw. */
function checkNoRejection(label: string, settled: PromiseSettledResult<unknown>[]): void {
  const failed = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  check(label, failed.length === 0, failed[0] ? String(failed[0].reason) : undefined);
}

/** One settled result, unwrapped by position — the ordered pairs below return different types. */
function unwrap<T>(settled: PromiseSettledResult<T>): T {
  if (settled.status === "rejected") throw settled.reason;
  return settled.value;
}

/** `۴۵٬۰۰۰ تومان` — the same wording the screens use. */
function toman(amount: number): string {
  return formatToman(amount);
}

// ---------------------------------------------------------------------------
// Fixture — the halls and accounts the story plays out on
// ---------------------------------------------------------------------------

/** The nine halls of this run, keyed by the story they carry. */
type SessionKey = "zero" | "funded" | "partial" | "gate" | "late" | "ledger" | "mirrorA" | "mirrorB" | "manager";

/** The fourteen accounts of this run. */
type UserKey =
  | "zero"
  | "funded"
  | "waiter1"
  | "waiter2"
  | "partial"
  | "gate"
  | "late"
  | "ledger"
  | "mirrorA"
  | "mirrorB"
  | "mgrOwner"
  | "mgrWaiter"
  | "mgrWaiter2"
  | "admin";

type Fixture = {
  venueId: string;
  sessions: Record<SessionKey, string>;
  users: Record<UserKey, string>;
  /** `userKey → eitaaId`, so a promotion can be named without a second read. */
  eitaa: Map<UserKey, string>;
};

/** Every fixture account, in creation order: what it is for and how it starts. */
const USER_SPECS: {
  key: UserKey;
  name: string;
  membership: "PENDING" | "APPROVED" | "REJECTED";
  role?: "USER" | "ADMIN";
}[] = [
  { key: "zero", name: "حساب بی‌موجودی", membership: "APPROVED" },
  { key: "funded", name: "حساب شارژشده", membership: "APPROVED" },
  { key: "waiter1", name: "صف اول موجودی", membership: "APPROVED" },
  { key: "waiter2", name: "صف دوم موجودی", membership: "APPROVED" },
  { key: "partial", name: "حساب کم‌موجودی", membership: "APPROVED" },
  // The membership gate's own account: it stays pending until §۹ approves it.
  { key: "gate", name: "حساب در انتظار تأیید", membership: "PENDING" },
  { key: "late", name: "حساب انصراف دیرهنگام", membership: "APPROVED" },
  { key: "ledger", name: "حساب دفتر کل", membership: "APPROVED" },
  { key: "mirrorA", name: "حساب آینه الف", membership: "APPROVED" },
  { key: "mirrorB", name: "حساب آینه ب", membership: "APPROVED" },
  { key: "mgrOwner", name: "صندلی‌دار مدیر", membership: "APPROVED" },
  { key: "mgrWaiter", name: "صف مدیر اول", membership: "APPROVED" },
  { key: "mgrWaiter2", name: "صف مدیر دوم", membership: "APPROVED" },
  // The manager whose name rides on every `ADMIN_ADJUST` row.
  { key: "admin", name: "مدیر تست موجودی", membership: "APPROVED", role: "ADMIN" },
];

async function setup(): Promise<Fixture> {
  const now = new Date();
  const startsInTwoDays = new Date(now.getTime() + 2 * DAY_MS);
  const startsInSixHours = new Date(now.getTime() + 6 * HOUR_MS);

  const venue = await client.venue.create({
    data: {
      id: `${RESERVED_ID_PREFIX}venue`,
      name: "سالن تست موجودی سانس‌یار",
      address: "تهران، تست — فقط برای اسکریپت check:balance",
    },
    select: { id: true },
  });

  /**
   * One reserved session. Every rule this script asserts on is **pinned on the
   * row** (the free window everywhere, the late rules on the one late hall), so
   * an edit to the seeded `Setting` row can never change a verdict here.
   */
  async function makeSession(input: {
    key: SessionKey;
    title: string;
    capacity: number;
    priceToman: number;
    startsAt: Date;
    closesInHours?: number;
    lateRules?: boolean;
  }): Promise<string> {
    const row = await client.session.create({
      data: {
        id: `${RESERVED_ID_PREFIX}session_${input.key}`,
        venueId: venue.id,
        title: input.title,
        startsAt: input.startsAt,
        endsAt: new Date(input.startsAt.getTime() + 90 * MINUTE_MS),
        registrationOpensAt: new Date(now.getTime() - DAY_MS),
        registrationClosesAt: new Date(now.getTime() + (input.closesInHours ?? 12) * HOUR_MS),
        capacity: input.capacity,
        priceToman: input.priceToman,
        paymentMode: "IN_PERSON",
        status: "PUBLISHED",
        freeCancelHours: FREE_CANCEL_HOURS,
        ...(input.lateRules
          ? {
              lateCancelEnabled: true,
              lateCancelFirstWarning: true,
              lateCancelPenaltyDays: 3,
              lateCancelWarningWindowDays: 14,
            }
          : {}),
      },
      select: { id: true },
    });
    return row.id;
  }

  const sessions: Record<SessionKey, string> = {
    zero: await makeSession({
      key: "zero",
      title: "سانس تست بدون موجودی",
      capacity: 2,
      priceToman: SEAT_PRICE,
      startsAt: startsInTwoDays,
    }),
    funded: await makeSession({
      key: "funded",
      title: "سانس تست شارژ و ارتقا",
      capacity: 1,
      priceToman: SEAT_PRICE,
      startsAt: startsInTwoDays,
    }),
    partial: await makeSession({
      key: "partial",
      title: "سانس تست موجودی ناکافی",
      capacity: 1,
      priceToman: SEAT_PRICE,
      startsAt: startsInTwoDays,
    }),
    gate: await makeSession({
      key: "gate",
      title: "سانس تست دروازه‌ی عضویت",
      capacity: 1,
      priceToman: SEAT_PRICE,
      startsAt: startsInTwoDays,
    }),
    // Starts in six hours — inside the twelve-hour free window, so its cancel is
    // a *late* one, and its rules are pinned so the verdict is this row's own.
    late: await makeSession({
      key: "late",
      title: "سانس تست انصراف دیرهنگام",
      capacity: 1,
      priceToman: SEAT_PRICE,
      startsAt: startsInSixHours,
      closesInHours: 3,
      lateRules: true,
    }),
    ledger: await makeSession({
      key: "ledger",
      title: "سانس تست دفتر کل",
      capacity: 2,
      priceToman: LEDGER_PRICE,
      startsAt: startsInTwoDays,
    }),
    mirrorA: await makeSession({
      key: "mirrorA",
      title: "سانس تست آینه ۱",
      capacity: 1,
      priceToman: SEAT_PRICE,
      startsAt: startsInTwoDays,
    }),
    mirrorB: await makeSession({
      key: "mirrorB",
      title: "سانس تست آینه ۲",
      capacity: 1,
      priceToman: SEAT_PRICE,
      startsAt: startsInTwoDays,
    }),
    manager: await makeSession({
      key: "manager",
      title: "سانس تست دست مدیر",
      capacity: 1,
      priceToman: MANAGER_PRICE,
      startsAt: startsInTwoDays,
    }),
  };

  const users = {} as Record<UserKey, string>;
  const eitaa = new Map<UserKey, string>();
  for (const [index, spec] of USER_SPECS.entries()) {
    const eitaaId = `${RESERVED_EITAA_PREFIX}${String(index + 1).padStart(2, "0")}`;
    const user = await client.user.create({
      data: {
        eitaaId,
        name: spec.name,
        role: spec.role ?? "USER",
        membershipStatus: spec.membership,
      },
      select: { id: true },
    });
    users[spec.key] = user.id;
    eitaa.set(spec.key, eitaaId);
  }

  console.log(
    `  سانس‌های ساختگی ساخته شد: ${toPersianDigits(Object.keys(sessions).length)} سانس و ${toPersianDigits(
      USER_SPECS.length,
    )} حساب تست — قیمت‌ها ${toPersianDigits(SEAT_PRICE)}، ${toPersianDigits(
      MANAGER_PRICE,
    )} و ${toPersianDigits(LEDGER_PRICE)} تومان`,
  );

  return { venueId: venue.id, sessions, users, eitaa };
}

// ---------------------------------------------------------------------------
// Reads — the harness always asks the database, never the engine's own answer
// ---------------------------------------------------------------------------

/** One account's balance column. */
async function balanceOf(userId: string): Promise<number> {
  const row = await client.user.findUnique({ where: { id: userId }, select: { balance: true } });
  return row?.balance ?? -1;
}

/** One account's ledger, oldest first — the order the chain assertions walk. */
async function entriesOf(userId: string) {
  return client.balanceEntry.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      amount: true,
      balanceAfter: true,
      type: true,
      note: true,
      sessionId: true,
      registrationId: true,
      byAdminId: true,
    },
  });
}

async function entryCount(userId: string): Promise<number> {
  return client.balanceEntry.count({ where: { userId } });
}

/** `sum(BalanceEntry.amount)` for one account — the ledger's own answer. */
async function sumEntriesOf(userId: string): Promise<number> {
  const grouped = await client.balanceEntry.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return grouped._sum.amount ?? 0;
}

async function penaltyCount(userId: string): Promise<number> {
  return client.penalty.count({ where: { userId } });
}

/** One player's row in one session — every money column and every stamp. */
async function seatOf(sessionId: string, userId: string) {
  return client.registration.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
    select: {
      id: true,
      sessionId: true,
      userId: true,
      status: true,
      createdAt: true,
      canceledAt: true,
      cancelType: true,
      promotedAt: true,
      paymentStatus: true,
      paidAt: true,
      amountToman: true,
      paidFromBalance: true,
    },
  });
}

/** The queue, in the engine's own order (`createdAt`, then `id`). */
async function queueOf(sessionId: string) {
  return client.registration.findMany({
    where: { sessionId, status: "WAITLIST" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      createdAt: true,
      amountToman: true,
      paidFromBalance: true,
      paymentStatus: true,
      user: { select: { eitaaId: true } },
    },
  });
}

type SeatCounts = { confirmed: number; waitlist: number; canceled: number; occupied: number };

/** The counts as the database holds them — one `groupBy`, never a stored column. */
async function countsOf(sessionId: string): Promise<SeatCounts> {
  const grouped = await client.registration.groupBy({
    by: ["status"],
    where: { sessionId },
    _count: { _all: true },
  });

  const pick = (status: RegistrationStatus): number =>
    grouped.find((row) => row.status === status)?._count._all ?? 0;

  const confirmed = pick("CONFIRMED");
  return {
    confirmed,
    waitlist: pick("WAITLIST"),
    canceled: pick("CANCELED"),
    occupied: confirmed,
  };
}

function countsText(counts: SeatCounts): string {
  return `تأییدشده ${toPersianDigits(counts.confirmed)}، لیست انتظار ${toPersianDigits(
    counts.waitlist,
  )}، لغوشده ${toPersianDigits(counts.canceled)}`;
}

// ---------------------------------------------------------------------------
// موج ۱ — a zero balance is a clean no-op, not an invented ledger row
// ---------------------------------------------------------------------------

async function zeroBalanceWave(fx: Fixture): Promise<void> {
  group("موج ۱ — حساب بدون موجودی: صندلی می‌گیرد و هیچ ردیفی در دفتر نوشته نمی‌شود");

  const userId = fx.users.zero;
  const now = new Date();
  const outcome = await registerSeat(client, { sessionId: fx.sessions.zero, userId, now });

  check(
    "ثبت‌نام با موجودی صفر → CONFIRMED، UNPAID و صفر تومان از موجودی",
    outcome.ok && outcome.status === "CONFIRMED" && outcome.paymentStatus === "UNPAID" && outcome.fromBalance === 0,
    outcome.ok
      ? `status=${outcome.status} fromBalance=${toPersianDigits(outcome.fromBalance)}`
      : `${outcome.code}: ${outcome.error}`,
  );

  const seat = await seatOf(fx.sessions.zero, userId);
  check(
    `صندلی در دیتابیس: اسنپ‌شات ${toman(SEAT_PRICE)}، بدون پول از موجودی، بدون مهر پرداخت`,
    seat?.status === "CONFIRMED" &&
      seat.paymentStatus === "UNPAID" &&
      seat.paidFromBalance === 0 &&
      seat.paidAt === null &&
      seat.amountToman === SEAT_PRICE,
    `status=${seat?.status ?? "?"} paidFromBalance=${toPersianDigits(seat?.paidFromBalance ?? -1)}`,
  );

  const balance = await balanceOf(userId);
  check("موجودی همان صفر ماند", balance === 0, `موجودی ${toman(balance)}`);

  const entries = await entriesOf(userId);
  check(
    "و هیچ ردیف دفتری برایش نوشته نشد (موجودی صفر یعنی هیچ حرکتی)",
    entries.length === 0,
    `ردیف‌ها: ${toPersianDigits(entries.length)}`,
  );

  check(
    `خواننده‌ی نمایش: تمام ${toman(seatOutstanding(seat ?? { amountToman: 0, paidFromBalance: 0, paymentStatus: "UNPAID" }))} مانده است`,
    seat !== null && seatOutstanding(seat) === SEAT_PRICE && seatBalanceUsed(seat) === 0,
  );
}

// ---------------------------------------------------------------------------
// موج ۲ — the manager's hand on the balance
// ---------------------------------------------------------------------------

async function adminAdjustWave(fx: Fixture): Promise<void> {
  group("موج ۲ — دست مدیر روی موجودی: شارژ، کسر بیشتر از موجودی، صفر و حساب ناشناس");

  const userId = fx.users.funded;
  const now = new Date();

  const credit = await adjustBalanceByAdmin(client, {
    userId,
    delta: FUNDED_CREDIT,
    note: "شارژ تستی check:balance",
    adminId: fx.users.admin,
    now,
  });
  check(
    `شارژ ${toman(FUNDED_CREDIT)} → ok و موجودی ${toman(FUNDED_CREDIT)}`,
    credit.ok && credit.balance === FUNDED_CREDIT,
    credit.ok ? `balance=${String(credit.balance)}` : credit.code,
  );

  const balance = await balanceOf(userId);
  const entries = await entriesOf(userId);
  const first = entries[0];
  check(
    `و دقیقاً یک ردیف ADMIN_ADJUST: مبلغ +${toman(FUNDED_CREDIT)}، balanceAfter ${toman(FUNDED_CREDIT)} و به نام مدیر`,
    balance === FUNDED_CREDIT &&
      entries.length === 1 &&
      first?.type === "ADMIN_ADJUST" &&
      first.amount === FUNDED_CREDIT &&
      first.balanceAfter === FUNDED_CREDIT &&
      first.byAdminId === fx.users.admin &&
      first.note === "شارژ تستی check:balance",
    `ردیف‌ها ${toPersianDigits(entries.length)}، balance=${toPersianDigits(balance)}`,
  );

  const overshoot = await adjustBalanceByAdmin(client, {
    userId,
    delta: -(FUNDED_CREDIT + 10_000),
    adminId: fx.users.admin,
    now,
  });
  check(
    "کسر بیشتر از موجودی → INSUFFICIENT (موجودی هیچ‌وقت منفی نمی‌شود)",
    !overshoot.ok && overshoot.code === "INSUFFICIENT",
    overshoot.ok ? `ok برگشت (${String(overshoot.balance)})` : overshoot.code,
  );
  check(
    "و آن کسر نه موجودی را عوض کرد و نه ردیفی نوشت",
    (await balanceOf(userId)) === FUNDED_CREDIT && (await entryCount(userId)) === 1,
    `موجودی ${toPersianDigits(await balanceOf(userId))}، ردیف‌ها ${toPersianDigits(await entryCount(userId))}`,
  );

  const noop = await adjustBalanceByAdmin(client, {
    userId,
    delta: 0,
    note: "بدون تغییر",
    adminId: fx.users.admin,
    now,
  });
  check(
    "delta صفر → ok، بدون تغییر و بدون ردیف تازه",
    noop.ok && noop.balance === FUNDED_CREDIT && (await entryCount(userId)) === 1,
    noop.ok ? `balance=${String(noop.balance)}` : noop.code,
  );

  const ghost = await adjustBalanceByAdmin(client, {
    userId: `${RESERVED_ID_PREFIX}ghost_user`,
    delta: 1_000,
    adminId: fx.users.admin,
    now,
  });
  check(
    "حساب ناشناس → NOT_FOUND (بدون خطای خام)",
    !ghost.ok && ghost.code === "NOT_FOUND",
    ghost.ok ? "ok برگشت" : ghost.code,
  );
}

// ---------------------------------------------------------------------------
// موج ۳ — a seat the balance covers entirely
// ---------------------------------------------------------------------------

async function fullCoverageWave(fx: Fixture): Promise<void> {
  group(`موج ۳ — صندلی ${toman(SEAT_PRICE)} با موجودی ${toman(FUNDED_CREDIT)}: کامل از موجودی`);

  const userId = fx.users.funded;
  const now = new Date();
  const outcome = await registerSeat(client, { sessionId: fx.sessions.funded, userId, now });

  check(
    "ثبت‌نام → CONFIRMED، از موجودی همان قیمت صندلی، و پرداخت کامل",
    outcome.ok &&
      outcome.status === "CONFIRMED" &&
      outcome.fromBalance === SEAT_PRICE &&
      outcome.paymentStatus === "PAID_BALANCE",
    outcome.ok
      ? `fromBalance=${toPersianDigits(outcome.fromBalance)} status=${outcome.paymentStatus}`
      : `${outcome.code}: ${outcome.error}`,
  );

  const seat = await seatOf(fx.sessions.funded, userId);
  check(
    `صندلی: paidFromBalance ${toman(SEAT_PRICE)}، PAID_BALANCE، paidAt همان لحظه، اسنپ‌شات ${toman(
      SEAT_PRICE,
    )}`,
    seat?.paidFromBalance === SEAT_PRICE &&
      seat.paymentStatus === "PAID_BALANCE" &&
      seat.paidAt?.getTime() === now.getTime() &&
      seat.amountToman === SEAT_PRICE &&
      seat.status === "CONFIRMED",
    `paidFromBalance=${toPersianDigits(seat?.paidFromBalance ?? -1)} status=${seat?.paymentStatus ?? "?"}`,
  );

  const balance = await balanceOf(userId);
  check(
    `موجودی روی ${toman(FUNDED_CREDIT - SEAT_PRICE)} نشست (${toman(FUNDED_CREDIT)} منهای قیمت صندلی)`,
    balance === FUNDED_CREDIT - SEAT_PRICE,
    `موجودی ${toman(balance)}`,
  );

  const entries = await entriesOf(userId);
  const last = entries[entries.length - 1];
  check(
    `و یک REGISTRATION_DEDUCT منفی ${toman(SEAT_PRICE)} با balanceAfter ${toman(
      FUNDED_CREDIT - SEAT_PRICE,
    )}، وصل به همان صندلی و همان سانس`,
    entries.length === 2 &&
      last?.type === "REGISTRATION_DEDUCT" &&
      last.amount === -SEAT_PRICE &&
      last.balanceAfter === FUNDED_CREDIT - SEAT_PRICE &&
      last.registrationId === seat?.id &&
      last.sessionId === fx.sessions.funded,
    `ردیف آخر: type=${last?.type ?? "?"} amount=${toPersianDigits(last?.amount ?? 0)}`,
  );

  check(
    "خواننده‌های نمایش برای صندلی کامل: مانده صفر، استفاده‌شده تمام قیمت، برگشتِ لغو تمام قیمت",
    seat !== null &&
      seatOutstanding(seat) === 0 &&
      seatBalanceUsed(seat) === SEAT_PRICE &&
      cancelRefundToman(seat) === SEAT_PRICE,
  );
}

// ---------------------------------------------------------------------------
// موج ۴ — a seat the balance only partly covers
// ---------------------------------------------------------------------------

async function partialCoverageWave(fx: Fixture): Promise<void> {
  group("موج ۴ — موجودی ناکافی: هر چه هست خرج می‌شود و بقیه به عهده‌ی بازیکن می‌ماند");

  const userId = fx.users.partial;
  const now = new Date();

  const credit = await adjustBalanceByAdmin(client, {
    userId,
    delta: PARTIAL_CREDIT,
    adminId: fx.users.admin,
    now,
  });
  check(`شارژ ${toman(PARTIAL_CREDIT)} → ok`, credit.ok && credit.balance === PARTIAL_CREDIT, credit.ok ? undefined : credit.code);

  const outcome = await registerSeat(client, { sessionId: fx.sessions.partial, userId, now });
  check(
    `ثبت‌نام روی صندلی ${toman(SEAT_PRICE)} → ${toman(PARTIAL_CREDIT)} از موجودی، ولی ردیف UNPAID می‌ماند`,
    outcome.ok &&
      outcome.fromBalance === PARTIAL_CREDIT &&
      outcome.paymentStatus === "UNPAID" &&
      outcome.status === "CONFIRMED",
    outcome.ok
      ? `fromBalance=${toPersianDigits(outcome.fromBalance)} status=${outcome.paymentStatus}`
      : `${outcome.code}: ${outcome.error}`,
  );

  const seat = await seatOf(fx.sessions.partial, userId);
  check(
    "صندلی: paidFromBalance همان ۸٬۰۰۰، UNPAID و بدون مهر پرداخت",
    seat?.paidFromBalance === PARTIAL_CREDIT && seat.paymentStatus === "UNPAID" && seat.paidAt === null,
    `paidFromBalance=${toPersianDigits(seat?.paidFromBalance ?? -1)} status=${seat?.paymentStatus ?? "?"}`,
  );

  const balance = await balanceOf(userId);
  check("موجودی صفر شد — هر چه بود خرج شد", balance === 0, `موجودی ${toman(balance)}`);

  const entries = await entriesOf(userId);
  const last = entries[entries.length - 1];
  check(
    `و یک REGISTRATION_DEDUCT منفی ${toman(PARTIAL_CREDIT)} با balanceAfter صفر`,
    entries.length === 2 && last?.type === "REGISTRATION_DEDUCT" && last.amount === -PARTIAL_CREDIT && last.balanceAfter === 0,
    `ردیف آخر: amount=${toPersianDigits(last?.amount ?? 0)}`,
  );

  check(
    `بیرون‌بده‌ی صندلی ${toman(SEAT_PRICE - PARTIAL_CREDIT)} است — همان جمله‌ی «حضوری بده»`,
    seat !== null && seatOutstanding(seat) === SEAT_PRICE - PARTIAL_CREDIT,
    `seatOutstanding=${toPersianDigits(seatOutstanding(seat ?? { amountToman: 0, paidFromBalance: 0, paymentStatus: "UNPAID" }))}`,
  );
}

// ---------------------------------------------------------------------------
// موج ۵ — the price snapshot, and the queue that is about to move
// ---------------------------------------------------------------------------

async function priceSnapshotWave(fx: Fixture): Promise<void> {
  group("موج ۵ — اسنپ‌شات قیمت: ویرایش قیمت سانس، صندلی گرفته‌شده را گران نمی‌کند");

  const now = new Date();

  const credit1 = await adjustBalanceByAdmin(client, {
    userId: fx.users.waiter1,
    delta: SEAT_PRICE,
    adminId: fx.users.admin,
    now,
  });
  const credit2 = await adjustBalanceByAdmin(client, {
    userId: fx.users.waiter2,
    delta: SEAT_PRICE,
    adminId: fx.users.admin,
    now,
  });
  check(
    `دو حساب صف هر کدام ${toman(SEAT_PRICE)} شارژ شدند (پس با هم یکی‌اند)`,
    credit1.ok && credit2.ok && credit1.balance === SEAT_PRICE && credit2.balance === SEAT_PRICE,
  );

  const first = await registerSeat(client, { sessionId: fx.sessions.funded, userId: fx.users.waiter1, now });
  const second = await registerSeat(client, { sessionId: fx.sessions.funded, userId: fx.users.waiter2, now });
  check(
    "سالن پر است → هر دو فقط لیست انتظار گرفتند، به ترتیب نوبت ۱ و ۲",
    first.ok &&
      first.status === "WAITLIST" &&
      first.waitlistPosition === 1 &&
      second.ok &&
      second.status === "WAITLIST" &&
      second.waitlistPosition === 2,
    `${first.ok ? first.status : first.code} / ${second.ok ? second.status : second.code}`,
  );
  check(
    "و برای نفر لیست انتظار هیچ پولی از موجودی کم نشد",
    (await balanceOf(fx.users.waiter1)) === SEAT_PRICE && (await balanceOf(fx.users.waiter2)) === SEAT_PRICE,
    `موجودی‌ها: ${toPersianDigits(await balanceOf(fx.users.waiter1))} و ${toPersianDigits(await balanceOf(fx.users.waiter2))}`,
  );

  const queue = await queueOf(fx.sessions.funded);
  check(
    "صف در دیتابیس: دو نفر به ترتیب ورود",
    queue.length === 2 && queue[0].userId === fx.users.waiter1 && queue[1].userId === fx.users.waiter2,
    `صف: ${queue.map((row) => row.user.eitaaId).join(", ")}`,
  );

  // The tie-break: with identical `createdAt`, the queue is ordered by id. Both
  // rows are given the same instant here, so §۶'s promotion proves the second
  // half of `findNextWaiter`'s order (`createdAt`, then `id`).
  const tie = new Date(now.getTime());
  await client.registration.updateMany({
    where: { id: { in: queue.map((row) => row.id) } },
    data: { createdAt: tie },
  });
  const tiedQueue = await queueOf(fx.sessions.funded);
  check(
    "با «createdAt» یکسان، ترتیب صف را شناسه تعیین می‌کند (همان قاعده‌ی موتور)",
    tiedQueue.length === 2 &&
      tiedQueue.every((row) => row.createdAt.getTime() === tie.getTime()) &&
      tiedQueue[0].id < tiedQueue[1].id,
    `شناسه‌ها: ${tiedQueue.map((row) => row.id).join(" < ")}`,
  );

  const bumped = await client.session.update({
    where: { id: fx.sessions.funded },
    data: { priceToman: BUMPED_PRICE },
    select: { priceToman: true },
  });
  check(
    `مدیر قیمت سانس را ${toman(SEAT_PRICE)} → ${toman(BUMPED_PRICE)} کرد`,
    bumped.priceToman === BUMPED_PRICE,
    `قیمت ${toPersianDigits(bumped.priceToman)}`,
  );

  const takenSeat = await seatOf(fx.sessions.funded, fx.users.funded);
  check(
    `صندلی گرفته‌شده هنوز اسنپ‌شات خودش را دارد (${toman(SEAT_PRICE)})، نه قیمت تازه`,
    takenSeat?.amountToman === SEAT_PRICE,
    `amountToman=${toPersianDigits(takenSeat?.amountToman ?? -1)}`,
  );

  const queued = await client.registration.findMany({
    where: { id: { in: tiedQueue.map((row) => row.id) } },
    select: { amountToman: true },
  });
  check(
    "و ردیف‌های صف هم اسنپ‌شات خودشان را دارند",
    queued.length === 2 && queued.every((row) => row.amountToman === SEAT_PRICE),
    queued.map((row) => toPersianDigits(row.amountToman)).join(", "),
  );
}

// ---------------------------------------------------------------------------
// موج ۶ — the refund, and the freed seat that promotes the first waiter
// ---------------------------------------------------------------------------

async function refundAndPromotionWave(fx: Fixture): Promise<void> {
  group("موج ۶ — لغو صندلی پرداخت‌شده: پول به موجودی برمی‌گردد و نفر اول صف مستقیم صندلی می‌گیرد");

  const now = new Date();
  const canceler = fx.users.funded;

  const seatBefore = await seatOf(fx.sessions.funded, canceler);
  const queueBefore = await queueOf(fx.sessions.funded);
  const expected = queueBefore[0];
  const leftover = queueBefore.find((row) => row.userId !== expected?.userId);

  check(
    "پیش از لغو: صف دو نفره است و دیتابیس نفر اول را خودش تعیین می‌کند",
    queueBefore.length === 2 && expected !== undefined && leftover !== undefined,
    `صدر صف: ${expected?.id ?? "?"}`,
  );

  const outcome = await cancelSeat(client, { sessionId: fx.sessions.funded, userId: canceler, now });
  check(
    "لغو داخل پنجره‌ی آزاد → ok، بدون جریمه و با برگشت پول",
    outcome.ok &&
      outcome.kind === "FREE" &&
      outcome.penaltyDays === 0 &&
      outcome.refundedToman === (seatBefore?.amountToman ?? -1),
    outcome.ok ? `kind=${outcome.kind} refund=${toPersianDigits(outcome.refundedToman)}` : `${outcome.code}: ${outcome.error}`,
  );
  check(
    `برگشت دقیقاً اسنپ‌شات خودِ صندلی است (${toman(SEAT_PRICE)}), نه قیمت تازه‌ی ${toman(BUMPED_PRICE)}`,
    outcome.ok && outcome.refundedToman === SEAT_PRICE && outcome.refundedToman !== Number(BUMPED_PRICE),
    outcome.ok ? `refund=${toPersianDigits(outcome.refundedToman)}` : `${outcome.code}: ${outcome.error}`,
  );
  check(
    "و صندلی آزادشده به همان نفر اول صف رسید (همان که دیتابیس اول می‌داندش)",
    outcome.ok && outcome.promoted === true && outcome.promotedEitaaId === expected?.user.eitaaId,
    outcome.ok
      ? `promoted=${String(outcome.promoted)} eitaa=${String(outcome.promotedEitaaId)}`
      : `${outcome.code}: ${outcome.error}`,
  );

  const cancelerBalance = await balanceOf(canceler);
  check(
    `موجودی لغوکننده به ${toman(FUNDED_CREDIT)} برگشت (${toman(FUNDED_CREDIT - SEAT_PRICE)} + ${toman(SEAT_PRICE)})`,
    cancelerBalance === FUNDED_CREDIT,
    `موجودی ${toman(cancelerBalance)}`,
  );

  const cancelerEntries = await entriesOf(canceler);
  const refundEntry = cancelerEntries[cancelerEntries.length - 1];
  check(
    `و یک CANCEL_REFUND مثبت ${toman(SEAT_PRICE)} با balanceAfter ${toman(FUNDED_CREDIT)} وصل به همان صندلی`,
    cancelerEntries.length === 3 &&
      refundEntry?.type === "CANCEL_REFUND" &&
      refundEntry.amount === SEAT_PRICE &&
      refundEntry.balanceAfter === FUNDED_CREDIT &&
      refundEntry.registrationId === seatBefore?.id,
    `ردیف آخر: type=${refundEntry?.type ?? "?"} amount=${toPersianDigits(refundEntry?.amount ?? 0)}`,
  );

  const canceledSeat = await seatOf(fx.sessions.funded, canceler);
  check(
    "ردیف لغوشده CANCELED با نوع FREE و همان لحظه؛ تاریخچه‌ی پولش (paidFromBalance) دست‌نخورده",
    canceledSeat?.status === "CANCELED" &&
      canceledSeat.cancelType === "FREE" &&
      canceledSeat.canceledAt?.getTime() === now.getTime() &&
      canceledSeat.paidFromBalance === SEAT_PRICE,
    `status=${canceledSeat?.status ?? "?"} cancelType=${canceledSeat?.cancelType ?? "?"}`,
  );

  const promotedSeat = await seatOf(fx.sessions.funded, expected?.userId ?? "");
  check(
    "ردیف بالا‌آمده CONFIRMED است، با مهر ارتقا و پرداخت کامل از موجودی",
    promotedSeat?.status === "CONFIRMED" &&
      promotedSeat.promotedAt?.getTime() === now.getTime() &&
      promotedSeat.paidFromBalance === SEAT_PRICE &&
      promotedSeat.paymentStatus === "PAID_BALANCE" &&
      promotedSeat.paidAt?.getTime() === now.getTime(),
    `status=${promotedSeat?.status ?? "?"} paidFromBalance=${toPersianDigits(promotedSeat?.paidFromBalance ?? -1)}`,
  );
  check(
    `و شارژش روی اسنپ‌شات خودش نشست، نه قیمت تازه‌ی ${toman(BUMPED_PRICE)}`,
    promotedSeat?.amountToman === SEAT_PRICE,
    `amountToman=${toPersianDigits(promotedSeat?.amountToman ?? -1)}`,
  );

  const promotedBalance = await balanceOf(expected?.userId ?? "");
  check(
    "و موجودی حساب بالا‌آمده خالی شد — ارتقا پول را مثل ثبت‌نام تازه از موجودی برمی‌دارد",
    promotedBalance === 0,
    `موجودی ${toman(promotedBalance)}`,
  );

  const promotedEntries = await entriesOf(expected?.userId ?? "");
  const promotedLast = promotedEntries[promotedEntries.length - 1];
  check(
    `و یک REGISTRATION_DEDUCT منفی ${toman(SEAT_PRICE)} برایش نوشته شد`,
    promotedEntries.length === 2 &&
      promotedLast?.type === "REGISTRATION_DEDUCT" &&
      promotedLast.amount === -SEAT_PRICE &&
      promotedLast.registrationId === promotedSeat?.id,
    `ردیف‌ها ${toPersianDigits(promotedEntries.length)}، آخرین amount=${toPersianDigits(promotedLast?.amount ?? 0)}`,
  );

  const leftoverBalance = await balanceOf(leftover?.userId ?? "");
  check(
    "نفر دوم صف دست‌نخورده ماند — ارتقا فقط مال نفر اول است",
    leftoverBalance === SEAT_PRICE,
    `موجودی ${toman(leftoverBalance)}`,
  );

  // The other half of the rule: leaving the queue is money-free wherever the
  // clock is. The leftover waiter still has a full balance — and it stays.
  const leaving = await cancelSeat(client, { sessionId: fx.sessions.funded, userId: leftover?.userId ?? "", now });
  check(
    "لغو ردیف لیست انتظار → آزاد، بدون برگشت پول و بدون ارتقای کسی",
    leaving.ok && leaving.kind === "FREE" && leaving.refundedToman === 0 && leaving.promoted === false,
    leaving.ok
      ? `kind=${leaving.kind} refund=${toPersianDigits(leaving.refundedToman)}`
      : `${leaving.code}: ${leaving.error}`,
  );
  check(
    "و موجودی‌اش عوض نشد و ردیف دفتری تازه‌ای نیامد",
    (await balanceOf(leftover?.userId ?? "")) === SEAT_PRICE && (await entryCount(leftover?.userId ?? "")) === 1,
    `موجودی ${toPersianDigits(await balanceOf(leftover?.userId ?? ""))}، ردیف‌ها ${toPersianDigits(
      await entryCount(leftover?.userId ?? ""),
    )}`,
  );
  check(
    "و برای نفر لیست انتظار هیچ جریمه‌ای نوشته نشد",
    (await penaltyCount(leftover?.userId ?? "")) === 0,
  );
}

// ---------------------------------------------------------------------------
// موج ۷ — the ledger invariant
// ---------------------------------------------------------------------------

async function ledgerWave(fx: Fixture): Promise<void> {
  group("موج ۷ — دفتر کل: موجودی = جمع ردیف‌ها، و هر ردیف زنجیره‌ی balanceAfter دارد");

  const userId = fx.users.ledger;
  const now = new Date();

  const credit = await adjustBalanceByAdmin(client, {
    userId,
    delta: LEDGER_CREDIT,
    note: "شارژ دفتر کل",
    adminId: fx.users.admin,
    now,
  });
  check(
    `شارژ ${toman(LEDGER_CREDIT)} → موجودی ${toman(LEDGER_CREDIT)}`,
    credit.ok && credit.balance === LEDGER_CREDIT,
    credit.ok ? undefined : credit.code,
  );

  const first = await registerSeat(client, { sessionId: fx.sessions.ledger, userId, now });
  const firstSeat = await seatOf(fx.sessions.ledger, userId);
  check(
    `ثبت‌نام روی صندلی ${toman(LEDGER_PRICE)} → کامل از موجودی`,
    first.ok && first.status === "CONFIRMED" && first.fromBalance === LEDGER_PRICE && first.paymentStatus === "PAID_BALANCE",
    first.ok ? `fromBalance=${toPersianDigits(first.fromBalance)}` : `${first.code}: ${first.error}`,
  );
  check(
    `موجودی ${toman(LEDGER_CREDIT - LEDGER_PRICE)}`,
    (await balanceOf(userId)) === LEDGER_CREDIT - LEDGER_PRICE,
    `موجودی ${toPersianDigits(await balanceOf(userId))}`,
  );

  const cancel1 = await cancelSeat(client, { sessionId: fx.sessions.ledger, userId, now });
  check(
    `لغو اول → برگشت ${toman(LEDGER_PRICE)} و موجودی ${toman(LEDGER_CREDIT)}`,
    cancel1.ok &&
      cancel1.kind === "FREE" &&
      cancel1.refundedToman === LEDGER_PRICE &&
      (await balanceOf(userId)) === LEDGER_CREDIT,
    cancel1.ok ? `refund=${toPersianDigits(cancel1.refundedToman)}` : `${cancel1.code}: ${cancel1.error}`,
  );

  const revive = await registerSeat(client, { sessionId: fx.sessions.ledger, userId, now });
  const revivedSeat = await seatOf(fx.sessions.ledger, userId);
  check(
    "ثبت‌نام دوباره همان یک ردیف را زنده کرد (نه ردیف دوم) و باز هم کامل از موجودی شارژ شد",
    revive.ok &&
      revive.status === "CONFIRMED" &&
      revivedSeat?.id === firstSeat?.id &&
      revivedSeat?.paidFromBalance === LEDGER_PRICE &&
      revivedSeat?.paymentStatus === "PAID_BALANCE",
    `id=${revivedSeat?.id === firstSeat?.id ? "همان ردیف" : "ردیف تازه"} paymentStatus=${revivedSeat?.paymentStatus ?? "?"}`,
  );

  const cancel2 = await cancelSeat(client, { sessionId: fx.sessions.ledger, userId, now });
  check(
    `لغو دوم → باز هم برگشت ${toman(LEDGER_PRICE)} و موجودی سرِ ${toman(LEDGER_CREDIT)}`,
    cancel2.ok && cancel2.refundedToman === LEDGER_PRICE && (await balanceOf(userId)) === LEDGER_CREDIT,
    cancel2.ok ? `refund=${toPersianDigits(cancel2.refundedToman)}` : `${cancel2.code}: ${cancel2.error}`,
  );

  const subtract = await adjustBalanceByAdmin(client, {
    userId,
    delta: -LEDGER_FINAL_SUBTRACT,
    note: "کسر تستی check:balance",
    adminId: fx.users.admin,
    now,
  });
  const expectedFinal = LEDGER_CREDIT - LEDGER_FINAL_SUBTRACT;
  check(
    `کسر ${toman(LEDGER_FINAL_SUBTRACT)} توسط مدیر → ok و موجودی ${toman(expectedFinal)}`,
    subtract.ok && subtract.balance === expectedFinal,
    subtract.ok ? `balance=${String(subtract.balance)}` : subtract.code,
  );

  const entries = await entriesOf(userId);
  const expectedAmounts = [LEDGER_CREDIT, -LEDGER_PRICE, LEDGER_PRICE, -LEDGER_PRICE, LEDGER_PRICE, -LEDGER_FINAL_SUBTRACT];
  const expectedTypes = [
    "ADMIN_ADJUST",
    "REGISTRATION_DEDUCT",
    "CANCEL_REFUND",
    "REGISTRATION_DEDUCT",
    "CANCEL_REFUND",
    "ADMIN_ADJUST",
  ];
  check(
    "دفتر کل دقیقاً شش ردیف با همان ترتیب و همان مبلغ‌ها دارد",
    JSON.stringify(entries.map((row) => row.amount)) === JSON.stringify(expectedAmounts) &&
      JSON.stringify(entries.map((row) => row.type)) === JSON.stringify(expectedTypes),
    `مبلغ‌ها: ${entries.map((row) => toPersianDigits(row.amount)).join(", ")}`,
  );

  let running = 0;
  const chain = entries.map((row) => (running += row.amount));
  check(
    "و هر ردیف balanceAfter همان جمعِ تا آن لحظه است (زنجیره بی‌گسست)",
    chain.map((value) => String(value)).join(",") === entries.map((row) => String(row.balanceAfter)).join(","),
    `زنجیره: ${chain.map((value) => toPersianDigits(value)).join(" → ")}`,
  );

  const balance = await balanceOf(userId);
  const sum = await sumEntriesOf(userId);
  check(
    `و ستون حساب با جمع دفتر برابر است (${toman(expectedFinal)})`,
    balance === expectedFinal && sum === expectedFinal,
    `موجودی ${toPersianDigits(balance)}، جمع دفتر ${toPersianDigits(sum)}`,
  );
}

// ---------------------------------------------------------------------------
// موج ۸ — the mirror: the reason `lockBalances` exists
// ---------------------------------------------------------------------------

async function mirrorWave(fx: Fixture): Promise<void> {
  group("موج ۸ — آینه: دو لغو هم‌زمان که هر کدام به یکی پول می‌دهد و از آن یکی می‌گیرد");

  const now = new Date();
  const A = fx.users.mirrorA;
  const B = fx.users.mirrorB;

  const creditA = await adjustBalanceByAdmin(client, {
    userId: A,
    delta: MIRROR_CREDIT,
    note: "شارژ آینه الف",
    adminId: fx.users.admin,
    now,
  });
  const creditB = await adjustBalanceByAdmin(client, {
    userId: B,
    delta: MIRROR_CREDIT,
    note: "شارژ آینه ب",
    adminId: fx.users.admin,
    now,
  });
  check(
    `هر دو حساب ${toman(MIRROR_CREDIT)} شارژ شدند`,
    creditA.ok && creditB.ok && creditA.balance === MIRROR_CREDIT && creditB.balance === MIRROR_CREDIT,
  );

  // S1: A holds the seat and B waits; S2: the exact mirror image.
  const seatA1 = await registerSeat(client, { sessionId: fx.sessions.mirrorA, userId: A, now });
  const queueB1 = await registerSeat(client, { sessionId: fx.sessions.mirrorA, userId: B, now });
  const seatB2 = await registerSeat(client, { sessionId: fx.sessions.mirrorB, userId: B, now });
  const queueA2 = await registerSeat(client, { sessionId: fx.sessions.mirrorB, userId: A, now });
  check(
    "آینه ساخته شد: الف صندلی سانس ۱ و نفر صف سانس ۲؛ ب صندلی سانس ۲ و نفر صف سانس ۱",
    seatA1.ok &&
      seatA1.status === "CONFIRMED" &&
      queueB1.ok &&
      queueB1.status === "WAITLIST" &&
      seatB2.ok &&
      seatB2.status === "CONFIRMED" &&
      queueA2.ok &&
      queueA2.status === "WAITLIST",
    [seatA1, queueB1, seatB2, queueA2]
      .map((outcome) => (outcome.ok ? outcome.status : outcome.code))
      .join(", "),
  );
  check(
    `هر دو حساب الان ${toman(MIRROR_CREDIT - SEAT_PRICE)} دارند (صندلی خودشان از موجودی رفته؛ صف چیزی هزینه ندارد)`,
    (await balanceOf(A)) === MIRROR_CREDIT - SEAT_PRICE && (await balanceOf(B)) === MIRROR_CREDIT - SEAT_PRICE,
    `الف ${toPersianDigits(await balanceOf(A))}، ب ${toPersianDigits(await balanceOf(B))}`,
  );

  // Round 1 — A cancels in S1 (refunds A, promotes B) while B cancels in S2
  // (refunds B, promotes A). Both transactions refund one account and charge the
  // other: without `lockBalances`'s single global order the two would take the
  // same two rows in opposite directions, which is a textbook deadlock.
  const round1 = await Promise.allSettled([
    cancelSeat(client, { sessionId: fx.sessions.mirrorA, userId: A, now }),
    cancelSeat(client, { sessionId: fx.sessions.mirrorB, userId: B, now }),
  ]);
  checkNoRejection("دور ۱: هیچ‌کدام با خطای دیتابیس (یا بن‌بست) برنگشت", round1);

  const cancelA1 = unwrap(round1[0]);
  const cancelB2 = unwrap(round1[1]);
  check(
    `دور ۱: هر دو لغو موفق بودند و هر دو ${toman(SEAT_PRICE)} برگرداندند`,
    cancelA1.ok &&
      cancelB2.ok &&
      cancelA1.refundedToman === SEAT_PRICE &&
      cancelB2.refundedToman === SEAT_PRICE,
    `${cancelA1.ok ? toPersianDigits(cancelA1.refundedToman) : cancelA1.code} / ${
      cancelB2.ok ? toPersianDigits(cancelB2.refundedToman) : cancelB2.code
    }`,
  );
  check(
    "دور ۱: و هر کدام نفر روبه‌رو را از صف بالا آورد",
    cancelA1.ok &&
      cancelB2.ok &&
      cancelA1.promotedEitaaId === fx.eitaa.get("mirrorB") &&
      cancelB2.promotedEitaaId === fx.eitaa.get("mirrorA"),
    `${String(cancelA1.ok ? cancelA1.promotedEitaaId : "?")} / ${String(cancelB2.ok ? cancelB2.promotedEitaaId : "?")}`,
  );

  const balanceAAfterRound1 = await balanceOf(A);
  const balanceBAfterRound1 = await balanceOf(B);
  check(
    `دور ۱: و موجودی هر دو دقیقاً ${toman(MIRROR_CREDIT - SEAT_PRICE)} ماند`,
    balanceAAfterRound1 === MIRROR_CREDIT - SEAT_PRICE && balanceBAfterRound1 === MIRROR_CREDIT - SEAT_PRICE,
    `الف ${toPersianDigits(balanceAAfterRound1)}، ب ${toPersianDigits(balanceBAfterRound1)}`,
  );

  const promotedInS1 = await seatOf(fx.sessions.mirrorA, B);
  const promotedInS2 = await seatOf(fx.sessions.mirrorB, A);
  check(
    "دور ۱: صندلی‌های آزادشده مستقیم به همان نفر روبه‌رو رسیدند، پرداخت‌شده از موجودی",
    promotedInS1?.status === "CONFIRMED" &&
      promotedInS1.promotedAt?.getTime() === now.getTime() &&
      promotedInS1.paidFromBalance === SEAT_PRICE &&
      promotedInS1.paymentStatus === "PAID_BALANCE" &&
      promotedInS2?.status === "CONFIRMED" &&
      promotedInS2.promotedAt?.getTime() === now.getTime() &&
      promotedInS2.paidFromBalance === SEAT_PRICE &&
      promotedInS2.paymentStatus === "PAID_BALANCE",
    `سانس ۱: ${promotedInS1?.status ?? "?"} · سانس ۲: ${promotedInS2?.status ?? "?"}`,
  );
  check(
    "دور ۱: و هر دو لغوکننده CANCELED شدند",
    (await seatOf(fx.sessions.mirrorA, A))?.status === "CANCELED" &&
      (await seatOf(fx.sessions.mirrorB, B))?.status === "CANCELED",
  );

  // Ready for the mirrored second round: the two canceled rows come back as
  // waiters (a revival, so no charge until a seat frees).
  const reviveA = await registerSeat(client, { sessionId: fx.sessions.mirrorA, userId: A, now });
  const reviveB = await registerSeat(client, { sessionId: fx.sessions.mirrorB, userId: B, now });
  check(
    "آماده‌سازی دور ۲: هر دو ردیف لغوشده به صف برگشتند، بدون هزینه",
    reviveA.ok &&
      reviveA.status === "WAITLIST" &&
      reviveB.ok &&
      reviveB.status === "WAITLIST" &&
      (await balanceOf(A)) === MIRROR_CREDIT - SEAT_PRICE &&
      (await balanceOf(B)) === MIRROR_CREDIT - SEAT_PRICE,
    `${reviveA.ok ? reviveA.status : reviveA.code} / ${reviveB.ok ? reviveB.status : reviveB.code}`,
  );

  // Round 2 — the same mirror with the roles swapped: now B cancels in S1 and A
  // cancels in S2. The two transactions still each refund one account and charge
  // the other, so the lock order is exercised again from the other side.
  const round2 = await Promise.allSettled([
    cancelSeat(client, { sessionId: fx.sessions.mirrorA, userId: B, now }),
    cancelSeat(client, { sessionId: fx.sessions.mirrorB, userId: A, now }),
  ]);
  checkNoRejection("دور ۲: نقش‌ها برعکس — باز هم بدون خطای خام", round2);

  const cancelB1 = unwrap(round2[0]);
  const cancelA2 = unwrap(round2[1]);
  check(
    `دور ۲: هر دو لغو موفق و هر دو ${toman(SEAT_PRICE)} برگرداندند و آن یکی را بالا آوردند`,
    cancelB1.ok &&
      cancelA2.ok &&
      cancelB1.refundedToman === SEAT_PRICE &&
      cancelA2.refundedToman === SEAT_PRICE &&
      cancelB1.promotedEitaaId === fx.eitaa.get("mirrorA") &&
      cancelA2.promotedEitaaId === fx.eitaa.get("mirrorB"),
    `${cancelB1.ok ? toPersianDigits(cancelB1.refundedToman) : cancelB1.code} / ${
      cancelA2.ok ? toPersianDigits(cancelA2.refundedToman) : cancelA2.code
    }`,
  );

  const finalA = await seatOf(fx.sessions.mirrorA, A);
  const finalB = await seatOf(fx.sessions.mirrorB, B);
  const finalBalanceA = await balanceOf(A);
  const finalBalanceB = await balanceOf(B);
  check(
    "پایان: الف صندلی سانس ۱ و ب صندلی سانس ۲ را دارد، هر دو کامل از موجودی",
    finalA?.status === "CONFIRMED" &&
      finalA.promotedAt?.getTime() === now.getTime() &&
      finalA.paidFromBalance === SEAT_PRICE &&
      finalA.paymentStatus === "PAID_BALANCE" &&
      finalB?.status === "CONFIRMED" &&
      finalB.promotedAt?.getTime() === now.getTime() &&
      finalB.paidFromBalance === SEAT_PRICE &&
      finalB.paymentStatus === "PAID_BALANCE",
    `الف: ${finalA?.paymentStatus ?? "?"} · ب: ${finalB?.paymentStatus ?? "?"}`,
  );
  check(
    `و موجودی هر دو حساب دقیقاً روی ${toman(MIRROR_CREDIT - SEAT_PRICE)} نشست`,
    finalBalanceA === MIRROR_CREDIT - SEAT_PRICE && finalBalanceB === MIRROR_CREDIT - SEAT_PRICE,
    `الف ${toPersianDigits(finalBalanceA)}، ب ${toPersianDigits(finalBalanceB)}`,
  );
  check(
    "و دفتر هر دو حساب با موجودی‌شان می‌خواند (هیچ حرکت گم‌شده‌ای نیست)",
    (await sumEntriesOf(A)) === MIRROR_CREDIT - SEAT_PRICE && (await sumEntriesOf(B)) === MIRROR_CREDIT - SEAT_PRICE,
    `جمع الف ${toPersianDigits(await sumEntriesOf(A))}، جمع ب ${toPersianDigits(await sumEntriesOf(B))}`,
  );
}

// ---------------------------------------------------------------------------
// موج ۹ — the membership gate meets the money
// ---------------------------------------------------------------------------

async function gateWave(fx: Fixture): Promise<void> {
  group("موج ۹ — دروازه‌ی عضویت: حساب تأییدنشده نه صندلی می‌گیرد و نه یک ریال از موجودی‌اش تکان می‌خورد");

  const userId = fx.users.gate;
  const now = new Date();

  const credit = await adjustBalanceByAdmin(client, {
    userId,
    delta: GATE_CREDIT,
    note: "شارژ پیش از تأیید",
    adminId: fx.users.admin,
    now,
  });
  check(
    `حساب «در انتظار تأیید» ${toman(GATE_CREDIT)} شارژ شد`,
    credit.ok && credit.balance === GATE_CREDIT,
    credit.ok ? undefined : credit.code,
  );

  const refused = await registerSeat(client, { sessionId: fx.sessions.gate, userId, now });
  check(
    "ثبت‌نام پیش از تأیید → NOT_APPROVED با جمله‌ی «عضویتت هنوز تأیید نشده»",
    !refused.ok && refused.code === "NOT_APPROVED" && refused.error === MEMBER_PENDING,
    refused.ok ? `ok برگشت (${refused.status})` : `${refused.code}: ${refused.error}`,
  );
  check("و برایش هیچ ردیفی نوشته نشد", (await seatOf(fx.sessions.gate, userId)) === null);
  check(
    `و هیچ پولی جابه‌جا نشد: موجودی همان ${toman(GATE_CREDIT)} و همان یک ردیف دفتر`,
    (await balanceOf(userId)) === GATE_CREDIT && (await entryCount(userId)) === 1,
    `موجودی ${toPersianDigits(await balanceOf(userId))}، ردیف‌ها ${toPersianDigits(await entryCount(userId))}`,
  );

  const approved = await decideMembership(client, { userId, decision: "APPROVED", now });
  check(
    "تأیید مدیر → ok",
    approved.ok && approved.decision === "APPROVED",
    approved.ok ? undefined : `${approved.code}: ${approved.error}`,
  );

  const seated = await registerSeat(client, { sessionId: fx.sessions.gate, userId, now });
  check(
    `همان فراخوانی دوباره → صندلی CONFIRMED و ${toman(SEAT_PRICE)} از موجودی`,
    seated.ok &&
      seated.status === "CONFIRMED" &&
      seated.fromBalance === SEAT_PRICE &&
      seated.paymentStatus === "PAID_BALANCE",
    seated.ok ? `fromBalance=${toPersianDigits(seated.fromBalance)}` : `${seated.code}: ${seated.error}`,
  );
  check(
    `و موجودی روی ${toman(GATE_CREDIT - SEAT_PRICE)} نشست`,
    (await balanceOf(userId)) === GATE_CREDIT - SEAT_PRICE,
    `موجودی ${toPersianDigits(await balanceOf(userId))}`,
  );

  const seat = await seatOf(fx.sessions.gate, userId);
  check(
    "صندلی: paidFromBalance همان قیمت، PAID_BALANCE و paidAt همان لحظه",
    seat?.paidFromBalance === SEAT_PRICE &&
      seat.paymentStatus === "PAID_BALANCE" &&
      seat.paidAt?.getTime() === now.getTime(),
    `paidFromBalance=${toPersianDigits(seat?.paidFromBalance ?? -1)} status=${seat?.paymentStatus ?? "?"}`,
  );
}

// ---------------------------------------------------------------------------
// موج ۱۰ — a late cancel refunds exactly like a free one
// ---------------------------------------------------------------------------

async function lateRefundWave(fx: Fixture): Promise<void> {
  group("موج ۱۰ — انصراف دیرهنگام: جریمه‌ها مال check:attendance است، اینجا فقط پول");

  const userId = fx.users.late;
  const now = new Date();

  const credit = await adjustBalanceByAdmin(client, {
    userId,
    delta: SEAT_PRICE,
    note: "شارژ انصراف دیرهنگام",
    adminId: fx.users.admin,
    now,
  });
  check(`شارژ ${toman(SEAT_PRICE)} → ok`, credit.ok && credit.balance === SEAT_PRICE, credit.ok ? undefined : credit.code);

  const seated = await registerSeat(client, { sessionId: fx.sessions.late, userId, now });
  check(
    "ثبت‌نام روی سانسِ ۶ ساعت‌دیگر → CONFIRMED و کامل از موجودی",
    seated.ok &&
      seated.status === "CONFIRMED" &&
      seated.fromBalance === SEAT_PRICE &&
      seated.paymentStatus === "PAID_BALANCE",
    seated.ok ? `status=${seated.status}` : `${seated.code}: ${seated.error}`,
  );

  const seatBefore = await seatOf(fx.sessions.late, userId);
  const left = await cancelSeat(client, { sessionId: fx.sessions.late, userId, now });
  check(
    "انصراف داخل پنجره‌ی دیرهنگام → اخطار اول، بدون محرومیت",
    left.ok && left.kind === "LATE_WARNING" && left.penaltyDays === 0,
    left.ok ? `kind=${left.kind} days=${toPersianDigits(left.penaltyDays)}` : `${left.code}: ${left.error}`,
  );
  check(
    `ولی پولش مثل لغو آزاد برمی‌گردد: دقیقاً اسنپ‌شات خودش (${toman(SEAT_PRICE)})`,
    left.ok && left.refundedToman === (seatBefore?.amountToman ?? -1) && left.refundedToman === SEAT_PRICE,
    left.ok ? `refund=${toPersianDigits(left.refundedToman)}` : `${left.code}: ${left.error}`,
  );

  const balance = await balanceOf(userId);
  check(`موجودی دوباره ${toman(SEAT_PRICE)} شد`, balance === SEAT_PRICE, `موجودی ${toman(balance)}`);

  const entries = await entriesOf(userId);
  const last = entries[entries.length - 1];
  check(
    `و یک CANCEL_REFUND مثبت ${toman(SEAT_PRICE)} با balanceAfter ${toman(SEAT_PRICE)}`,
    entries.length === 3 &&
      last?.type === "CANCEL_REFUND" &&
      last.amount === SEAT_PRICE &&
      last.balanceAfter === SEAT_PRICE,
    `ردیف‌ها ${toPersianDigits(entries.length)}، آخرین amount=${toPersianDigits(last?.amount ?? 0)}`,
  );

  const canceledSeat = await seatOf(fx.sessions.late, userId);
  check(
    "ردیف CANCELED با نوع LATE (لغو دیرهنگام بود، پولش ولی کامل برگشت)",
    canceledSeat?.status === "CANCELED" && canceledSeat.cancelType === "LATE" && canceledSeat.canceledAt?.getTime() === now.getTime(),
    `status=${canceledSeat?.status ?? "?"} cancelType=${canceledSeat?.cancelType ?? "?"}`,
  );

  const penalties = await client.penalty.findMany({
    where: { userId },
    select: { type: true, days: true },
  });
  check(
    "و همان یک جریمه‌ی صفر‌روزه («اخطار») سر جایش است — عمداً اینجا بررسی نمی‌شود که چه می‌کند",
    penalties.length === 1 && penalties[0].type === "LATE_CANCEL" && penalties[0].days === 0,
    penalties.map((row) => `type=${row.type} days=${toPersianDigits(row.days)}`).join(", "),
  );
}

// ---------------------------------------------------------------------------
// موج ۱۱ — the manager's board writes, through the pieces they call
// ---------------------------------------------------------------------------

/**
 * «حذف ثبت‌نام» as `admin-session-manage.ts` writes it: lock the session, find
 * the waiter, lock every account this transaction will touch in one global
 * order, mark the row `CANCELED` (`cancelType = ADMIN`, no promotion stamp), send
 * its money back to the balance and promote the waiter — in that order.
 *
 * The action module itself is `server-only`, so the harness rebuilds its body
 * from the very functions it calls (`findNextWaiter`, `lockBalances`,
 * `refundSeatToBalance`, `promoteFromQueue`) and asserts the result against the
 * database.
 */
async function simulateRemoveRegistration(sessionId: string, registrationId: string, now: Date) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Session\` WHERE id = ${sessionId} FOR UPDATE`;

    const seat = await tx.registration.findUnique({
      where: { id: registrationId },
      select: {
        id: true,
        status: true,
        userId: true,
        amountToman: true,
        paidFromBalance: true,
        paymentStatus: true,
      },
    });
    if (!seat) return { ok: false as const, code: "NOT_FOUND" };

    const freedSeat = seat.status === "CONFIRMED";
    const refundToman = cancelRefundToman(seat);
    const waiter = freedSeat ? await findNextWaiter(tx, sessionId) : null;
    await lockBalances(tx, [
      ...(refundToman > 0 ? [seat.userId] : []),
      ...(waiter ? [waiter.userId] : []),
    ]);

    await tx.registration.update({
      where: { id: seat.id },
      data: { status: "CANCELED", canceledAt: now, cancelType: "ADMIN", promotedAt: null },
    });

    const refund = await refundSeatToBalance(tx, {
      registrationId: seat.id,
      userId: seat.userId,
      sessionId,
      amountToman: seat.amountToman,
      paidFromBalance: seat.paidFromBalance,
      paymentStatus: seat.paymentStatus,
      note: "حذف ثبت‌نام توسط مدیر",
      now,
    });

    const promotedEitaaId = waiter
      ? (await promoteFromQueue(tx, sessionId, waiter, now)).eitaaId
      : null;

    return { ok: true as const, refundedToman: refund.refunded, promotedEitaaId };
  });
}

/** «ارتقای دستی از لیست انتظار» as the action writes it: capacity is deliberately not checked. */
async function simulatePromoteWaiter(sessionId: string, registrationId: string, now: Date) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Session\` WHERE id = ${sessionId} FOR UPDATE`;

    const seat = await tx.registration.findUnique({
      where: { id: registrationId },
      select: {
        id: true,
        status: true,
        userId: true,
        amountToman: true,
        paidFromBalance: true,
        paymentStatus: true,
      },
    });
    if (!seat) return { ok: false as const, code: "NOT_FOUND" };
    if (seat.status !== "WAITLIST") return { ok: false as const, code: "NOT_WAITLIST" };

    await tx.registration.update({
      where: { id: seat.id },
      data: { status: "CONFIRMED", promotedAt: now },
    });

    const charge = await chargeSeatFromBalance(tx, {
      registrationId: seat.id,
      userId: seat.userId,
      sessionId,
      amountToman: seat.amountToman,
      paidFromBalance: seat.paidFromBalance,
      paymentStatus: seat.paymentStatus,
      now,
    });

    return { ok: true as const, applied: charge.applied, paymentStatus: charge.paymentStatus };
  });
}

/** «لغو کل سانس» as the action writes it: every live row released, every refund in one lock order. */
async function simulateCancelSession(sessionId: string, now: Date) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Session\` WHERE id = ${sessionId} FOR UPDATE`;

    const affected = await tx.registration.findMany({
      where: { sessionId, status: { in: ["CONFIRMED", "WAITLIST"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        userId: true,
        amountToman: true,
        paidFromBalance: true,
        paymentStatus: true,
        user: { select: { eitaaId: true } },
      },
    });

    if (affected.length > 0) {
      await tx.registration.updateMany({
        where: { id: { in: affected.map((row) => row.id) } },
        data: { status: "CANCELED", canceledAt: now, cancelType: "ADMIN", promotedAt: null },
      });
    }

    const orderedRows = [...affected].sort((a, b) => (a.userId < b.userId ? -1 : 1));
    await lockBalances(
      tx,
      orderedRows.filter((row) => cancelRefundToman(row) > 0).map((row) => row.userId),
    );

    const refunds: { eitaaId: string; refundedToman: number }[] = [];
    for (const row of orderedRows) {
      const refund = await refundSeatToBalance(tx, {
        registrationId: row.id,
        userId: row.userId,
        sessionId,
        amountToman: row.amountToman,
        paidFromBalance: row.paidFromBalance,
        paymentStatus: row.paymentStatus,
        note: "لغو سانس توسط مدیر",
        now,
      });
      refunds.push({ eitaaId: row.user.eitaaId, refundedToman: refund.refunded });
    }

    return { ok: true as const, canceled: affected.length, refunds };
  });
}

async function managerWave(fx: Fixture): Promise<void> {
  group("موج ۱۱ — دست مدیر روی صندلی‌ها: حذف ثبت‌نام، ارتقای دستی و لغو کل سانس");

  const now = new Date();
  const sessionId = fx.sessions.manager;
  const owner = fx.users.mgrOwner;
  const waiter = fx.users.mgrWaiter;
  const manual = fx.users.mgrWaiter2;

  const creditOwner = await adjustBalanceByAdmin(client, {
    userId: owner,
    delta: MANAGER_PRICE,
    note: "شارژ صندلی‌دار مدیر",
    adminId: fx.users.admin,
    now,
  });
  const creditWaiter = await adjustBalanceByAdmin(client, {
    userId: waiter,
    delta: MANAGER_PRICE,
    note: "شارژ صف مدیر",
    adminId: fx.users.admin,
    now,
  });
  check(
    `دو حساب سانس مدیر هر کدام ${toman(MANAGER_PRICE)} شارژ شدند`,
    creditOwner.ok && creditWaiter.ok,
  );

  const ownerSeat = await registerSeat(client, { sessionId, userId: owner, now });
  const waiterSeat = await registerSeat(client, { sessionId, userId: waiter, now });
  check(
    `صندلی‌دار مدیر سانس را گرفت (${toman(MANAGER_PRICE)}) و نفر بعد به صف رفت`,
    ownerSeat.ok &&
      ownerSeat.status === "CONFIRMED" &&
      ownerSeat.paymentStatus === "PAID_BALANCE" &&
      waiterSeat.ok &&
      waiterSeat.status === "WAITLIST",
    `${ownerSeat.ok ? ownerSeat.status : ownerSeat.code} / ${waiterSeat.ok ? waiterSeat.status : waiterSeat.code}`,
  );

  const ownerRowBefore = await seatOf(sessionId, owner);
  const removal = await simulateRemoveRegistration(sessionId, ownerRowBefore?.id ?? "", now);
  check(
    `«حذف ثبت‌نام» → پول صندلی‌دار کامل برگشت (${toman(MANAGER_PRICE)}) و همین حالا نفر صف بالا آمد`,
    removal.ok && removal.refundedToman === MANAGER_PRICE && removal.promotedEitaaId === fx.eitaa.get("mgrWaiter"),
    removal.ok ? `refund=${toPersianDigits(removal.refundedToman)}` : removal.code,
  );

  const ownerBalance = await balanceOf(owner);
  const ownerEntries = await entriesOf(owner);
  const ownerRefund = ownerEntries[ownerEntries.length - 1];
  check(
    `موجودی صندلی‌دار ${toman(MANAGER_PRICE)} شد و ردیف CANCEL_REFUND با یادداشت مدیر نوشته شد`,
    ownerBalance === MANAGER_PRICE &&
      ownerRefund?.type === "CANCEL_REFUND" &&
      ownerRefund.amount === MANAGER_PRICE &&
      ownerRefund.note === "حذف ثبت‌نام توسط مدیر",
    `موجودی ${toPersianDigits(ownerBalance)}، یادداشت «${ownerRefund?.note ?? ""}»`,
  );

  const ownerRowAfter = await seatOf(sessionId, owner);
  check(
    "و ردیف حذف‌شده CANCELED با نوع ADMIN است، بدون مهر ارتقا و بدون جریمه",
    ownerRowAfter?.status === "CANCELED" &&
      ownerRowAfter.cancelType === "ADMIN" &&
      ownerRowAfter.promotedAt === null &&
      (await penaltyCount(owner)) === 0,
    `status=${ownerRowAfter?.status ?? "?"} cancelType=${ownerRowAfter?.cancelType ?? "?"}`,
  );

  const promotedRow = await seatOf(sessionId, waiter);
  check(
    "نفر صف CONFIRMED شد، با مهر ارتقا و پرداخت کامل از موجودی",
    promotedRow?.status === "CONFIRMED" &&
      promotedRow.promotedAt?.getTime() === now.getTime() &&
      promotedRow.paidFromBalance === MANAGER_PRICE &&
      promotedRow.paymentStatus === "PAID_BALANCE" &&
      promotedRow.amountToman === MANAGER_PRICE,
    `status=${promotedRow?.status ?? "?"} paidFromBalance=${toPersianDigits(promotedRow?.paidFromBalance ?? -1)}`,
  );
  check(
    `و موجودی‌اش خالی شد (${toman(MANAGER_PRICE)} → ۰) با یک REGISTRATION_DEDUCT`,
    (await balanceOf(waiter)) === 0 &&
      (await entriesOf(waiter)).some(
        (row) => row.type === "REGISTRATION_DEDUCT" && row.amount === -MANAGER_PRICE && row.registrationId === promotedRow?.id,
      ),
    `موجودی ${toPersianDigits(await balanceOf(waiter))}`,
  );

  // «ارتقای دستی» — the manager pulls a row up by hand, with a balance that only
  // covers part of the price.
  const creditManual = await adjustBalanceByAdmin(client, {
    userId: manual,
    delta: MGR_MANUAL_CREDIT,
    note: "شارژ صف دوم مدیر",
    adminId: fx.users.admin,
    now,
  });
  const manualSeat = await registerSeat(client, { sessionId, userId: manual, now });
  check(
    `حساب سوم با ${toman(MGR_MANUAL_CREDIT)} شارژ شد و صف گرفت`,
    creditManual.ok && manualSeat.ok && manualSeat.status === "WAITLIST",
    manualSeat.ok ? manualSeat.status : manualSeat.code,
  );

  const manualRowBefore = await seatOf(sessionId, manual);
  const manualPromotion = await simulatePromoteWaiter(sessionId, manualRowBefore?.id ?? "", now);
  check(
    `«ارتقای دستی» → CONFIRMED و ${toman(MGR_MANUAL_CREDIT)} از موجودی (کمتر از قیمت)`,
    manualPromotion.ok && manualPromotion.applied === MGR_MANUAL_CREDIT && manualPromotion.paymentStatus === "UNPAID",
    manualPromotion.ok
      ? `applied=${toPersianDigits(manualPromotion.applied)} status=${manualPromotion.paymentStatus}`
      : manualPromotion.code,
  );

  const manualRowAfter = await seatOf(sessionId, manual);
  check(
    `صندلی‌اش half-paid است: paidFromBalance ${toman(MGR_MANUAL_CREDIT)}، هنوز UNPAID، با مهر ارتقا`,
    manualRowAfter?.status === "CONFIRMED" &&
      manualRowAfter.paidFromBalance === MGR_MANUAL_CREDIT &&
      manualRowAfter.paymentStatus === "UNPAID" &&
      manualRowAfter.paidAt === null &&
      manualRowAfter.promotedAt?.getTime() === now.getTime(),
    `paidFromBalance=${toPersianDigits(manualRowAfter?.paidFromBalance ?? -1)} status=${manualRowAfter?.paymentStatus ?? "?"}`,
  );
  check(
    `و بیرون‌بده‌اش ${toman(MANAGER_PRICE - MGR_MANUAL_CREDIT)} است`,
    manualRowAfter !== null && seatOutstanding(manualRowAfter) === MANAGER_PRICE - MGR_MANUAL_CREDIT,
    `seatOutstanding=${toPersianDigits(seatOutstanding(manualRowAfter ?? { amountToman: 0, paidFromBalance: 0, paymentStatus: "UNPAID" }))}`,
  );

  const counts = await countsOf(sessionId);
  check(
    `و ظرفیت عمداً چک نمی‌شود: سانس ${toPersianDigits(1)} نفره الآن ${toPersianDigits(
      counts.confirmed,
    )} صندلی CONFIRMED دارد (همان رفتار «ارتقای دستی»)`,
    counts.confirmed === 2,
    countsText(counts),
  );

  // «لغو کل سانس» — only the two live rows are released; the row a manager had
  // already removed keeps its own history and gets nothing twice.
  const removedRowBefore = await seatOf(sessionId, owner);
  const bulk = await simulateCancelSession(sessionId, now);
  check(
    `«لغو کل سانس» → هر دو ردیف زنده آزاد شدند و پولشان برگشت: ${toman(MANAGER_PRICE)} و ${toman(
      MGR_MANUAL_CREDIT,
    )}`,
    bulk.ok &&
      bulk.canceled === 2 &&
      bulk.refunds.some((row) => row.refundedToman === MANAGER_PRICE) &&
      bulk.refunds.some((row) => row.refundedToman === MGR_MANUAL_CREDIT),
    `canceled=${toPersianDigits(bulk.canceled)} refunds=${bulk.refunds
      .map((row) => toPersianDigits(row.refundedToman))
      .join(", ")}`,
  );
  check(
    `موجودی نفر صف مدیر به ${toman(MANAGER_PRICE)} و حساب سوم به ${toman(MGR_MANUAL_CREDIT)} برگشت`,
    (await balanceOf(waiter)) === MANAGER_PRICE && (await balanceOf(manual)) === MGR_MANUAL_CREDIT,
    `${toPersianDigits(await balanceOf(waiter))} / ${toPersianDigits(await balanceOf(manual))}`,
  );

  const removedRowAfter = await seatOf(sessionId, owner);
  check(
    "و ردیفی که قبلاً حذف شده بود دست‌نخورده ماند — نه تاریخ دوباره، نه پول دوباره",
    removedRowAfter?.status === "CANCELED" &&
      removedRowAfter.cancelType === "ADMIN" &&
      removedRowAfter.canceledAt?.getTime() === removedRowBefore?.canceledAt?.getTime() &&
      (await entryCount(owner)) === 3,
    `canceledAt=${removedRowAfter?.canceledAt?.toISOString() ?? "?"} ردیف‌های دفتر=${toPersianDigits(
      await entryCount(owner),
    )}`,
  );

  const waiterAfterBulk = await seatOf(sessionId, waiter);
  const manualAfterBulk = await seatOf(sessionId, manual);
  check(
    "و ردیف‌های آزادشده CANCELED با نوع ADMIN و بدون مهر ارتقا شدند",
    waiterAfterBulk?.status === "CANCELED" &&
      waiterAfterBulk.cancelType === "ADMIN" &&
      waiterAfterBulk.promotedAt === null &&
      manualAfterBulk?.status === "CANCELED" &&
      manualAfterBulk.cancelType === "ADMIN" &&
      manualAfterBulk.promotedAt === null,
    `صف: ${waiterAfterBulk?.cancelType ?? "?"} · دستی: ${manualAfterBulk?.cancelType ?? "?"}`,
  );
  check(
    "و هیچ‌کدام از این سه حرکت مدیر جریمه‌ای برای بازیکنان ننوشت",
    (await penaltyCount(owner)) === 0 &&
      (await penaltyCount(waiter)) === 0 &&
      (await penaltyCount(manual)) === 0,
  );
}

// ---------------------------------------------------------------------------
// بررسی نهایی — the invariants that hold whatever the waves did
// ---------------------------------------------------------------------------

async function invariants(fx: Fixture): Promise<void> {
  group("بررسی نهایی — دفتر کل، موجودی و ظرفیت‌ها، برای همه‌ی حساب‌های ساختگی");

  const userIds = Object.values(fx.users);
  const sums = await client.balanceEntry.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds } },
    _sum: { amount: true },
  });
  const sumOf = new Map(sums.map((row) => [row.userId, row._sum.amount ?? 0]));

  const rows = await client.user.findMany({
    where: { id: { in: userIds } },
    orderBy: { eitaaId: "asc" },
    select: { id: true, eitaaId: true, balance: true },
  });

  const mismatched = rows.filter((row) => row.balance !== (sumOf.get(row.id) ?? 0));
  check(
    `برای هر ${toPersianDigits(rows.length)} حساب: موجودی دقیقاً جمع ردیف‌های دفتر است`,
    mismatched.length === 0,
    mismatched
      .map((row) => `${row.eitaaId}: balance=${row.balance} sum=${sumOf.get(row.id) ?? 0}`)
      .join(" · "),
  );

  const ledgerRows = await client.balanceEntry.findMany({
    where: { userId: { in: userIds } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { userId: true, balanceAfter: true },
  });
  const lastAfter = new Map<string, number>();
  for (const row of ledgerRows) lastAfter.set(row.userId, row.balanceAfter);
  const trailing = rows.filter((row) => lastAfter.has(row.id) && lastAfter.get(row.id) !== row.balance);
  check(
    "و balanceAfterِ آخرین ردیف هر دفتر همان موجودی فعلی است",
    trailing.length === 0,
    trailing.map((row) => row.eitaaId).join(", "),
  );

  // Engine-governed halls never hold more seats than their capacity. The
  // manager's own hall is deliberately left out: «ارتقای دستی» is documented to
  // ignore capacity, and §۱۱ asserts that over-fill on purpose.
  const halls: { key: SessionKey; label: string; capacity: number }[] = [
    { key: "zero", label: "سانس بدون موجودی", capacity: 2 },
    { key: "funded", label: "سانس شارژ و ارتقا", capacity: 1 },
    { key: "partial", label: "سانس موجودی ناکافی", capacity: 1 },
    { key: "gate", label: "سانس دروازه‌ی عضویت", capacity: 1 },
    { key: "late", label: "سانس انصراف دیرهنگام", capacity: 1 },
    { key: "ledger", label: "سانس دفتر کل", capacity: 2 },
    { key: "mirrorA", label: "سانس آینه ۱", capacity: 1 },
    { key: "mirrorB", label: "سانس آینه ۲", capacity: 1 },
  ];
  for (const hall of halls) {
    const counts = await countsOf(fx.sessions[hall.key]);
    check(
      `«${hall.label}»: اشغال هرگز از ظرفیت ${toPersianDigits(hall.capacity)} بیشتر نشد`,
      counts.occupied <= hall.capacity,
      countsText(counts),
    );
  }

  const foreign = await client.balanceEntry.count({
    where: {
      sessionId: { in: Object.values(fx.sessions) },
      user: { eitaaId: { not: { startsWith: RESERVED_EITAA_PREFIX } } },
    },
  });
  check(
    "و هیچ ردیف دفتری از این سانس‌ها به حسابی بیرون از بازه‌ی رزروشده وصل نیست",
    foreign === 0,
    `ردیف‌ها: ${toPersianDigits(foreign)}`,
  );

  // The money of the run, in one glance — a log line, not an assertion.
  console.log("\n  موجودی پایان هر حساب:");
  for (const row of rows) {
    console.log(`    ${row.eitaaId} → ${toman(row.balance)} (دفتر: ${toman(sumOf.get(row.id) ?? 0)})`);
  }
}

// ---------------------------------------------------------------------------
// Cleanup — reserved rows only, always, whatever happened above
// ---------------------------------------------------------------------------

/** Refuses to delete anything that is not inside this script's reservation. */
function guardReserved(what: string, ids: string[], allowed: (id: string) => boolean): void {
  const intruder = ids.find((id) => !allowed(id));
  if (intruder) {
    throw new Error(`پاک‌سازی متوقف شد: ${what} «${intruder}» بیرون از بازه‌ی رزروشده است`);
  }
}

async function cleanup(): Promise<void> {
  const venues = await client.venue.findMany({
    where: { id: { startsWith: RESERVED_ID_PREFIX } },
    select: { id: true },
  });
  guardReserved("سالن", venues.map((row) => row.id), (id) => id.startsWith(RESERVED_ID_PREFIX));

  const sessions = await client.session.findMany({
    where: { id: { startsWith: RESERVED_ID_PREFIX } },
    select: { id: true },
  });
  guardReserved("سانس", sessions.map((row) => row.id), (id) => id.startsWith(RESERVED_ID_PREFIX));

  const users = await client.user.findMany({
    where: { eitaaId: { startsWith: RESERVED_EITAA_PREFIX } },
    select: { id: true, eitaaId: true },
  });
  guardReserved(
    "کاربر",
    users.map((row) => row.eitaaId),
    (eitaaId) => eitaaId.startsWith(RESERVED_EITAA_PREFIX),
  );

  const sessionIds = sessions.map((row) => row.id);
  const userIds = users.map((row) => row.id);

  // The ledger first — a movement may name a fixture session, a seat or the
  // manager as its author, and every one of those relations must be gone before
  // the rows they point at are.
  if (sessionIds.length > 0 || userIds.length > 0) {
    await client.balanceEntry.deleteMany({
      where: {
        OR: [
          ...(sessionIds.length > 0 ? [{ sessionId: { in: sessionIds } }] : []),
          ...(userIds.length > 0 ? [{ userId: { in: userIds } }, { byAdminId: { in: userIds } }] : []),
        ],
      },
    });

    // Registrations → penalties → users → sessions → venue: children before
    // parents, exactly as the relations require.
    await client.registration.deleteMany({
      where: {
        OR: [
          ...(sessionIds.length > 0 ? [{ sessionId: { in: sessionIds } }] : []),
          ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
        ],
      },
    });
    await client.penalty.deleteMany({
      where: {
        OR: [
          ...(sessionIds.length > 0 ? [{ sessionId: { in: sessionIds } }] : []),
          ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
        ],
      },
    });
  }
  if (userIds.length > 0) await client.user.deleteMany({ where: { id: { in: userIds } } });
  if (sessionIds.length > 0) await client.session.deleteMany({ where: { id: { in: sessionIds } } });
  if (venues.length > 0) {
    await client.venue.deleteMany({ where: { id: { in: venues.map((row) => row.id) } } });
  }
}

/** The reservation is empty again — no fixture row outlived the run. */
async function assertClean(): Promise<void> {
  const eitaa = { startsWith: RESERVED_EITAA_PREFIX };

  const [venues, sessions, users, registrations, penalties, ledger] = await Promise.all([
    client.venue.count({ where: { id: { startsWith: RESERVED_ID_PREFIX } } }),
    client.session.count({ where: { id: { startsWith: RESERVED_ID_PREFIX } } }),
    client.user.count({ where: { eitaaId: eitaa } }),
    client.registration.count({ where: { user: { eitaaId: eitaa } } }),
    client.penalty.count({ where: { user: { eitaaId: eitaa } } }),
    client.balanceEntry.count({
      where: { OR: [{ user: { eitaaId: eitaa } }, { byAdmin: { eitaaId: eitaa } }] },
    }),
  ]);

  check(
    "پاک‌سازی کامل: سالن، سانس، کاربر، ثبت‌نام، جریمه و ردیف دفتری تستی صفر شد",
    venues === 0 && sessions === 0 && users === 0 && registrations === 0 && penalties === 0 && ledger === 0,
    `سالن ${venues}، سانس ${sessions}، کاربر ${users}، ثبت‌نام ${registrations}، جریمه ${penalties}، دفتر ${ledger}`,
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function describeDatabase(url: string): string {
  const match = /^[a-z]+:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/i.exec(url);
  return match ? `${match[1]}/${match[2] ?? ""}` : "(آدرس ناخوانا)";
}

async function main(): Promise<void> {
  console.log("check:balance — موجودی حساب: شارژ، هزینه‌ی صندلی، برگشت و ارتقا");
  console.log(`دیتابیس: ${describeDatabase(databaseUrl)}`);

  // Release anything a previous run left behind (it may have died mid-story).
  await cleanup();

  const fixture = await setup();
  try {
    await zeroBalanceWave(fixture);
    await adminAdjustWave(fixture);
    await fullCoverageWave(fixture);
    await partialCoverageWave(fixture);
    await priceSnapshotWave(fixture);
    await refundAndPromotionWave(fixture);
    await ledgerWave(fixture);
    await mirrorWave(fixture);
    await gateWave(fixture);
    await lateRefundWave(fixture);
    await managerWave(fixture);
    await invariants(fixture);
  } finally {
    await cleanup();
    await assertClean();
  }
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error: unknown) {
    failures += 1;
    console.log(
      `  FAIL خطای پیش‌بینی‌نشده: ${
        error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)
      }`,
    );
  } finally {
    await client.$disconnect();
  }

  if (failures > 0) {
    console.log(`\nFAIL — ${toPersianDigits(failures)} بررسی رد شد (از ${toPersianDigits(checks)}).`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nPASS — ${toPersianDigits(checks)} بررسی، همه سبز.`);
  process.exitCode = 0;
}

void run();
