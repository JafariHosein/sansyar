/**
 * `npm.cmd run check:race` — the engines' proof: the membership gate, the seats,
 * the queue, the clock and the manager's word.
 *
 * The owner's worry, verbatim: when a crowd taps «ثبت‌نام» at the same moment on a
 * سانس whose capacity is about to run out, nobody may be told they have a seat
 * they do not have — and nobody may be sent to the gateway for a seat that went to
 * somebody else. The newest round adds the **account** to the story: a fresh
 * account can do *nothing* until the manager approves it once (the membership
 * gate), and once approved, a seat it asks for is **its own** — there is no second
 * approval, and a freed seat goes straight to the first person in line.
 *
 * This script drives the **real** transaction bodies — `registerSeat` and
 * `cancelSeat` (`src/server/registration-core.ts`) plus `decideMembership`
 * (`src/server/membership-core.ts`), the very functions the server actions call —
 * against a throwaway fixture. The whole story runs here:
 *
 *   1. the membership gate: a `PENDING` account and a `REJECTED` one are both
 *      refused with their own sentence and **no row is written**; approving one
 *      makes the app work (the very next tap is a seat), a second decision on a
 *      member is `ALREADY_APPROVED`, and a rejection is **not final** — the same
 *      account is re-approved and registers;
 *   2. the account's own race: a decision fired against the account's first
 *      registration serializes on the user row — either the request is refused as
 *      `NOT_APPROVED` or it lands the seat, never both; and an approve × reject
 *      raced on one account always leaves it `APPROVED` (the approval is the last
 *      word, whichever call reached the lock first);
 *   3. thirty concurrent registrations on a capacity-12 سانس → exactly 12
 *      `CONFIRMED` and 18 `WAITLIST`, dense positions ۱..۱۸, zero refusals;
 *   4. 60 calls (a double tap per player) → one row per player, every duplicate
 *      answered `ALREADY`, never a raw P2002;
 *   5. three confirmed seats released → each promotes the *oldest* waiter
 *      **straight into `CONFIRMED`** with `promotedAt` stamped; no `Penalty` row
 *      for a free cancel;
 *   6. a seat raced by two cancels → exactly one release, the loser told
 *      `ALREADY_CANCELED`, exactly one promotion; two seats freed together promote
 *      the two next waiters, each exactly once;
 *   7. leaving the waitlist is free wherever the clock is (the hall was already
 *      full, so nothing is freed), and coming back lands at the **back** of the
 *      queue with every stamp cleared;
 *   8. the late story on a second سانس: two seats taken at once, a queue exit
 *      inside the late window still free, the first late cancel a warning
 *      (`days = 0`, no ban), the second a real ban — and the banned player refused
 *      with `BANNED` while his own row is left untouched;
 *   9. the guards: a started سانس takes no registration and no cancel
 *      (`CLOSED` / `STARTED`), an account without a row cannot cancel
 *      (`NOT_REGISTERED`), an unknown سانس is `NOT_FOUND`, and an active ban
 *      outranks the membership gate (`BANNED`, not `NOT_APPROVED`).
 *
 * It is safe to re-run and it **never touches seeded rows**: every row it creates
 * lives under its own reserved ids (`racecheck_*`, `eitaaId` 990000001…990000040)
 * and cleanup refuses to delete anything outside that reservation.
 *
 * Exit code 0 = every assertion held («PASS»), 1 = something broke («FAIL»).
 *
 * Run from the project root (`npm.cmd run check:race`), with MySQL/MariaDB up.
 */
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient, type RegistrationStatus } from "../src/generated/prisma/client";
import { toPersianDigits } from "../src/lib/format";
import {
  ALREADY_REGISTERED,
  cancelSeat,
  MEMBER_PENDING,
  MEMBER_REJECTED,
  registerSeat,
  type CancelEngineResult,
} from "../src/server/registration-core";
import {
  decideMembership,
  MEMBER_ALREADY_APPROVED,
  MEMBER_NOT_FOUND,
  MEMBER_NOT_PENDING,
} from "../src/server/membership-core";
import type { RegisterOutcome } from "../src/server/actions/results";

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

/** `990000001` … `990000040`. Seeded players live at `100000000`/`2000000xx`. */
const RESERVED_EITAA_PREFIX = "9900000";
/** Every id this script invents starts with this. Seeded ids start with `seed_`. */
const RESERVED_ID_PREFIX = "racecheck_";

/** The hall of the main story: twelve seats, two days out, registration open. */
const MAIN_CAPACITY = 12;
/** The crowd of §۵.۲ — 30 taps for 12 seats. */
const MAIN_PLAYERS = 30;
/** The membership sandbox: four seats for the four accounts the manager approves. */
const MEMBER_CAPACITY = 4;
/** The six accounts of the membership story (players ۱..۶). */
const MEMBER_PLAYERS = 6;
/** The second hall: two seats, starts in six hours (inside the free window). */
const LATE_CAPACITY = 2;
/** Players ۳۷..۳۹: the late-cancel story, so one of them can always wait in line. */
const LATE_PLAYERS = 3;
/** Player ۴۰: the guard's row on a سانس that has already started. */
const GUARD_PLAYERS = 1;
const TOTAL_PLAYERS = MEMBER_PLAYERS + MAIN_PLAYERS + LATE_PLAYERS + GUARD_PLAYERS;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** The membership status of the six story accounts, in order (players ۱..۶). */
const MEMBER_STORY_STATUS = [
  /** ۱ — the account that is approved and whose very next tap is a seat. */
  "PENDING",
  /** ۲ — rejected first, then re-approved: «رد شدن پایان کار نیست». */
  "PENDING",
  /** ۳ — seeded as rejected, approved later. */
  "REJECTED",
  /** ۴ — the account raced against its own first registration. */
  "PENDING",
  /** ۵ — the account the manager's two decisions are raced on. */
  "PENDING",
  /** ۶ — stays pending: the active ban that outranks the gate. */
  "PENDING",
] as const;

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

/** A promise that rejected is a failure of its own: the engines never throw. */
function checkNoRejection(label: string, settled: PromiseSettledResult<unknown>[]): void {
  const failed = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  check(label, failed.length === 0, failed[0] ? String(failed[0].reason) : undefined);
}

/** The fulfilled values, in call order — `Promise.allSettled` preserves it. */
function valuesOf<T>(settled: PromiseSettledResult<T>[]): T[] {
  return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

/**
 * One settled result, unwrapped by position — for the ordered pairs below whose
 * two calls return **different** types (a registration and a decision), where
 * `valuesOf` would flatten them into one union. A rejection throws: by then the
 * `checkNoRejection` line above has already reported it.
 */
function unwrap<T>(settled: PromiseSettledResult<T>): T {
  if (settled.status === "rejected") throw settled.reason;
  return settled.value;
}

// ---------------------------------------------------------------------------
// Fixture — four reserved sessions and forty reserved players
// ---------------------------------------------------------------------------

type Fixture = {
  venueId: string;
  /** The main hall: capacity 12, registration open, starts in two days. */
  mainSessionId: string;
  mainTitle: string;
  mainStartsAt: Date;
  /** The membership sandbox: capacity 4, where the approved accounts take seats. */
  memberSessionId: string;
  /** The late-cancel hall: capacity 2, starts in six hours, rules pinned. */
  lateSessionId: string;
  /** A سانس that has already started — the guard's own session. */
  startedSessionId: string;
  /** 40 user ids, in pools: the six story accounts, the crowd, the late three, the guard. */
  players: string[];
};

/** The membership status of player `index` (1-based); everybody else is approved. */
function membershipOf(index: number): (typeof MEMBER_STORY_STATUS)[number] | "APPROVED" {
  return MEMBER_STORY_STATUS[index - 1] ?? "APPROVED";
}

async function setup(): Promise<Fixture> {
  const now = new Date();

  const venue = await client.venue.create({
    data: {
      id: `${RESERVED_ID_PREFIX}venue`,
      name: "سالن تست همزمانی سانس‌یار",
      address: "تهران، تست — فقط برای اسکریپت check:race",
    },
    select: { id: true },
  });

  // The main hall: two days out (so every cancel is well inside the free window),
  // registration open right now. `freeCancelHours` is **pinned on the row** — the
  // verdicts below must not depend on whatever the admin has edited in `Setting`.
  const mainStartsAt = new Date(now.getTime() + 2 * DAY_MS);
  const mainTitle = "سانس تست ظرفیت همزمان";
  const main = await client.session.create({
    data: {
      id: `${RESERVED_ID_PREFIX}session_main`,
      venueId: venue.id,
      title: mainTitle,
      startsAt: mainStartsAt,
      endsAt: new Date(mainStartsAt.getTime() + 90 * MINUTE_MS),
      registrationOpensAt: new Date(now.getTime() - DAY_MS),
      registrationClosesAt: new Date(now.getTime() + DAY_MS),
      capacity: MAIN_CAPACITY,
      priceToman: 90_000,
      paymentMode: "IN_PERSON",
      status: "PUBLISHED",
      freeCancelHours: 12,
    },
    select: { id: true },
  });

  // The membership sandbox: one day out, open, four seats for the four accounts
  // the manager approves. Small on purpose — what it exists to prove is *who may
  // hold a seat*, not how a crowd behaves.
  const memberStartsAt = new Date(now.getTime() + DAY_MS);
  const member = await client.session.create({
    data: {
      id: `${RESERVED_ID_PREFIX}session_member`,
      venueId: venue.id,
      title: "سانس تست دروازه‌ی عضویت",
      startsAt: memberStartsAt,
      endsAt: new Date(memberStartsAt.getTime() + 90 * MINUTE_MS),
      registrationOpensAt: new Date(now.getTime() - DAY_MS),
      registrationClosesAt: new Date(now.getTime() + 12 * HOUR_MS),
      capacity: MEMBER_CAPACITY,
      priceToman: 60_000,
      paymentMode: "IN_PERSON",
      status: "PUBLISHED",
      freeCancelHours: 12,
    },
    select: { id: true },
  });

  // The late-cancel hall: starts in six hours, i.e. **inside** the twelve-hour
  // free window, and every rule this script asserts on is pinned on the row, so
  // the numbers below are the session's own and not the settings row's.
  const late = await client.session.create({
    data: {
      id: `${RESERVED_ID_PREFIX}session_late`,
      venueId: venue.id,
      title: "سانس تست انصراف دیرهنگام",
      startsAt: new Date(now.getTime() + 6 * HOUR_MS),
      endsAt: new Date(now.getTime() + 7 * HOUR_MS),
      registrationOpensAt: new Date(now.getTime() - DAY_MS),
      registrationClosesAt: new Date(now.getTime() + 3 * HOUR_MS),
      capacity: LATE_CAPACITY,
      priceToman: 80_000,
      paymentMode: "IN_PERSON",
      status: "PUBLISHED",
      freeCancelHours: 12,
      lateCancelEnabled: true,
      lateCancelFirstWarning: true,
      lateCancelPenaltyDays: 3,
      lateCancelWarningWindowDays: 14,
    },
    select: { id: true },
  });

  // The guard's hall: published and already running. Nothing may be registered or
  // canceled on it.
  const started = await client.session.create({
    data: {
      id: `${RESERVED_ID_PREFIX}session_started`,
      venueId: venue.id,
      title: "سانس تست شروعمده",
      startsAt: new Date(now.getTime() - HOUR_MS),
      endsAt: new Date(now.getTime() + 30 * MINUTE_MS),
      registrationOpensAt: new Date(now.getTime() - 3 * DAY_MS),
      registrationClosesAt: new Date(now.getTime() - 2 * HOUR_MS),
      capacity: 2,
      priceToman: 50_000,
      paymentMode: "IN_PERSON",
      status: "PUBLISHED",
    },
    select: { id: true },
  });

  const players: string[] = [];
  for (let index = 1; index <= TOTAL_PLAYERS; index += 1) {
    const user = await client.user.create({
      data: {
        eitaaId: `${RESERVED_EITAA_PREFIX}${String(index).padStart(2, "0")}`,
        name: `تست ${toPersianDigits(index)}`,
        // Half of the fixture answers the first-run sheet; the other half is how
        // the fallback (`fullNameOf` → `null`) stays covered by a real row.
        firstName: index % 2 === 0 ? `نام ${toPersianDigits(index)}` : null,
        lastName: index % 2 === 0 ? `خانوادگی ${toPersianDigits(index)}` : null,
        // The six story accounts carry their own state; everybody else is an
        // established member, so the seat engines only ever see approved people.
        membershipStatus: membershipOf(index),
      },
      select: { id: true },
    });
    players.push(user.id);
  }

  console.log(
    `  سانس‌های ساختگی ساخته شد: ظرفیت ${toPersianDigits(MAIN_CAPACITY)} اصلی، ${toPersianDigits(
      MEMBER_CAPACITY,
    )} عضویت و ${toPersianDigits(LATE_CAPACITY)} دیرشروع — ${toPersianDigits(TOTAL_PLAYERS)} بازیکن تست`,
  );

  return {
    venueId: venue.id,
    mainSessionId: main.id,
    mainTitle,
    mainStartsAt,
    memberSessionId: member.id,
    lateSessionId: late.id,
    startedSessionId: started.id,
    players,
  };
}

/** Player ۱..۶ — the membership story. */
function member(fx: Fixture, index: number): string {
  return fx.players[index - 1];
}

/** Players ۷..۳۶ — the crowd of the main hall. */
function crowdOf(fx: Fixture): string[] {
  return fx.players.slice(MEMBER_PLAYERS, MEMBER_PLAYERS + MAIN_PLAYERS);
}

/** Players ۳۷..۳۹ — the late-cancel story. */
function latePlayer(fx: Fixture, index: number): string {
  return fx.players[MEMBER_PLAYERS + MAIN_PLAYERS + index - 1];
}

/** Player ۴۰ — the guard on the سانس that has already started. */
function guardPlayerOf(fx: Fixture): string {
  return fx.players[MEMBER_PLAYERS + MAIN_PLAYERS + LATE_PLAYERS];
}

// ---------------------------------------------------------------------------
// Reads — the harness always asks the database, never the engine's own answer
// ---------------------------------------------------------------------------

/** One seat row, in the queue's own order (`createdAt`, then `id`). */
async function rowsOf(sessionId: string, statuses: RegistrationStatus[]) {
  return client.registration.findMany({
    where: { sessionId, status: { in: statuses } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      status: true,
      createdAt: true,
      promotedAt: true,
      canceledAt: true,
      cancelType: true,
      paidAt: true,
      paymentStatus: true,
      attendance: true,
      user: { select: { eitaaId: true } },
    },
  });
}

type SeatCounts = {
  confirmed: number;
  waitlist: number;
  canceled: number;
  /** `CONFIRMED` — the seats people hold, which is the engine's occupancy rule. */
  occupied: number;
};

/** The counts as the database holds them — one `groupBy`, never a stored column. */
async function seatCounts(sessionId: string): Promise<SeatCounts> {
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
  )}، لغوشده ${toPersianDigits(counts.canceled)} (اشغال ${toPersianDigits(counts.occupied)})`;
}

/** Every penalty row of the reserved players, oldest first. */
async function penaltyRows(userIds: string[]) {
  return client.penalty.findMany({
    where: { userId: { in: userIds } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, userId: true, type: true, days: true, reason: true, startsAt: true, endsAt: true },
  });
}

/** One player's row in one session — every stamp the engines write. */
async function registrationOf(sessionId: string, userId: string) {
  return client.registration.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      promotedAt: true,
      canceledAt: true,
      cancelType: true,
      paidAt: true,
      paymentStatus: true,
      attendance: true,
    },
  });
}

/** `userId → eitaaId`, read from the database — the ids the messages travel to. */
async function eitaaIdsOf(userIds: string[]): Promise<Map<string, string>> {
  const rows = await client.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, eitaaId: true },
  });
  return new Map(rows.map((row) => [row.id, row.eitaaId]));
}

/** `[1, 2, … n]` — what a dense queue looks like. */
function densePositions(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

// ---------------------------------------------------------------------------
// موج ۱ — the membership gate
// ---------------------------------------------------------------------------

async function membershipWave(fx: Fixture): Promise<void> {
  group("موج ۱ — دروازه‌ی عضویت: تا مدیر تأیید نکند، هیچ کاری نمی‌شود");

  const pending = member(fx, 1);
  const rejectThenApprove = member(fx, 2);
  const rejected = member(fx, 3);
  const raced = member(fx, 4);
  const raceDecision = member(fx, 5);
  const eitaa = await eitaaIdsOf([pending, rejectThenApprove, rejected, raced, raceDecision]);
  const now = new Date();

  // ۱ — accounts the manager has not approved: refused at the engine, no row at
  //     all. The client gate would have shown its waiting screen long before this
  //     call — this is the half that makes the gate true for a hand-made request.
  const pendingTap = await registerSeat(client, { sessionId: fx.mainSessionId, userId: pending, now });
  check(
    "تپ حساب «در انتظار تأیید» → NOT_APPROVED با جمله‌ی «عضویتت هنوز تأیید نشده»",
    !pendingTap.ok && pendingTap.code === "NOT_APPROVED" && pendingTap.error === MEMBER_PENDING,
    pendingTap.ok ? `ok برگشت (${pendingTap.status})` : `${pendingTap.code}: ${pendingTap.error}`,
  );

  const rejectedTap = await registerSeat(client, { sessionId: fx.mainSessionId, userId: rejected, now });
  check(
    "حساب «ردشده» هم → NOT_APPROVED، با جمله‌ی «درخواست عضویتت تأیید نشده»",
    !rejectedTap.ok && rejectedTap.code === "NOT_APPROVED" && rejectedTap.error === MEMBER_REJECTED,
    rejectedTap.ok ? `ok برگشت (${rejectedTap.status})` : `${rejectedTap.code}: ${rejectedTap.error}`,
  );

  const afterRefusals = await seatCounts(fx.mainSessionId);
  check(
    "و هیچ ردیفی برای هیچ‌کدام نوشته نشد — دروازه پیش از صندلی جلوی ثبت‌نام را گرفت",
    afterRefusals.confirmed === 0 && afterRefusals.waitlist === 0 && afterRefusals.canceled === 0,
    countsText(afterRefusals),
  );

  // ۲ — the manager's word: the very next tap is a seat.
  const approve = await decideMembership(client, { userId: pending, decision: "APPROVED", now });
  check(
    "تأیید مدیر → ok، و پیام به شناسه‌ی ایتای خودِ همان حساب می‌رود",
    approve.ok && approve.decision === "APPROVED" && approve.userEitaaId === eitaa.get(pending),
    approve.ok ? `eitaa=${approve.userEitaaId}` : `${approve.code}: ${approve.error}`,
  );
  const approvedRow = await client.user.findUnique({
    where: { id: pending },
    select: { membershipStatus: true, membershipDecidedAt: true },
  });
  check(
    "و مهر تصمیم روی حساب نشست (همان لحظه)",
    approvedRow?.membershipStatus === "APPROVED" && approvedRow.membershipDecidedAt?.getTime() === now.getTime(),
    `status=${approvedRow?.membershipStatus ?? "?"}`,
  );

  const memberTap = await registerSeat(client, { sessionId: fx.memberSessionId, userId: pending, now });
  check(
    "ثبت‌نام همان حسابِ تازه‌تأییدشده → CONFIRMED؛ تأیید دومِ صندلی وجود ندارد",
    memberTap.ok && memberTap.status === "CONFIRMED" && memberTap.waitlistPosition === null,
    memberTap.ok ? `status=${memberTap.status}` : `${memberTap.code}: ${memberTap.error}`,
  );

  // ۳ — the decision's own edges, all four of them.
  const decideAgain = await decideMembership(client, { userId: pending, decision: "APPROVED", now });
  check(
    "تأیید دوباره‌ی یک عضو → ALREADY_APPROVED",
    !decideAgain.ok && decideAgain.code === "ALREADY_APPROVED" && decideAgain.error === MEMBER_ALREADY_APPROVED,
    decideAgain.ok ? "ok برگشت" : `${decideAgain.code}: ${decideAgain.error}`,
  );
  const rejectMember = await decideMembership(client, { userId: pending, decision: "REJECTED", now });
  check(
    "رد کردن یک عضو تأییدشده هم → ALREADY_APPROVED (تأیید پس گرفته نمی‌شود)",
    !rejectMember.ok && rejectMember.code === "ALREADY_APPROVED",
    rejectMember.ok ? "ok برگشت" : `${rejectMember.code}: ${rejectMember.error}`,
  );
  const decideMissing = await decideMembership(client, {
    userId: `${RESERVED_ID_PREFIX}missing_user`,
    decision: "APPROVED",
    now,
  });
  check(
    "تصمیم روی شناسه‌ی ناشناس → NOT_FOUND (بدون خطای خام)",
    !decideMissing.ok && decideMissing.code === "NOT_FOUND" && decideMissing.error === MEMBER_NOT_FOUND,
    decideMissing.ok ? "ok برگشت" : `${decideMissing.code}: ${decideMissing.error}`,
  );

  // ۴ — a rejection is **not final**: rejected → still locked out → re-approved →
  //     the app works. This is the owner's own rule, told in order.
  const firstWord = await decideMembership(client, { userId: rejectThenApprove, decision: "REJECTED", now });
  check("گفتن «رد» به یک درخواست در انتظار → ok", firstWord.ok && firstWord.decision === "REJECTED", firstWord.ok ? undefined : `${firstWord.code}: ${firstWord.error}`);

  const refusedAfterReject = await registerSeat(client, {
    sessionId: fx.memberSessionId,
    userId: rejectThenApprove,
    now,
  });
  check(
    "بعد از رد شدن باز هم هیچ کاری نمی‌شود (NOT_APPROVED با جمله‌ی رد)",
    !refusedAfterReject.ok && refusedAfterReject.code === "NOT_APPROVED" && refusedAfterReject.error === MEMBER_REJECTED,
    refusedAfterReject.ok ? `ok برگشت (${refusedAfterReject.status})` : `${refusedAfterReject.code}: ${refusedAfterReject.error}`,
  );

  const secondReject = await decideMembership(client, { userId: rejectThenApprove, decision: "REJECTED", now });
  check(
    "رد دوباره → NOT_PENDING (تنها تصمیم مفید برای ردشده، تأیید است)",
    !secondReject.ok && secondReject.code === "NOT_PENDING" && secondReject.error === MEMBER_NOT_PENDING,
    secondReject.ok ? "ok برگشت" : `${secondReject.code}: ${secondReject.error}`,
  );

  const reApprove = await decideMembership(client, { userId: rejectThenApprove, decision: "APPROVED", now });
  check(
    "تأیید یک حساب ردشده → ok (رد شدن پایان کار نیست؛ مدیر از فهرست «ردشده‌ها» برمی‌گرداندش)",
    reApprove.ok && reApprove.decision === "APPROVED",
    reApprove.ok ? undefined : `${reApprove.code}: ${reApprove.error}`,
  );

  const retryTap = await registerSeat(client, { sessionId: fx.memberSessionId, userId: rejectThenApprove, now });
  check(
    "و حالا سانس می‌گیرد → CONFIRMED",
    retryTap.ok && retryTap.status === "CONFIRMED",
    retryTap.ok ? `status=${retryTap.status}` : `${retryTap.code}: ${retryTap.error}`,
  );

  const reviveRejected = await decideMembership(client, { userId: rejected, decision: "APPROVED", now });
  const rejectedSeat = await registerSeat(client, { sessionId: fx.memberSessionId, userId: rejected, now });
  check(
    "حساب «ردشده‌ی» ابتدایی هم با «تأیید» برمی‌گردد و سانس می‌گیرد",
    reviveRejected.ok && rejectedSeat.ok && rejectedSeat.status === "CONFIRMED",
    rejectedSeat.ok ? `status=${rejectedSeat.status}` : `${rejectedSeat.code}: ${rejectedSeat.error}`,
  );

  // ۵ — the account's own race: its first-ever registration against the decision
  //     that unlocks it. The two transactions serialize on the user row (the seat
  //     engine locks session → user, the decision locks user only), so the tap
  //     either lands or is refused — never a seat that contradicts the gate.
  const racedSettled = await Promise.allSettled([
    registerSeat(client, { sessionId: fx.memberSessionId, userId: raced, now }),
    decideMembership(client, { userId: raced, decision: "APPROVED", now }),
  ]);
  checkNoRejection("مسابقه‌ی «تأیید حساب» و «ثبت‌نام خودِ بازیکن» بدون خطای خام تمام شد", racedSettled);

  const racedTap = unwrap(racedSettled[0]);
  const racedDecision = unwrap(racedSettled[1]);
  check(
    "تصمیم مدیر همیشه می‌نشیند: حساب APPROVED شد",
    racedDecision.ok && racedDecision.decision === "APPROVED",
    racedDecision.ok ? undefined : `${racedDecision.code}: ${racedDecision.error}`,
  );
  check(
    racedTap.ok
      ? "شاخه‌ی «تأیید زودتر رسید»: ثبت‌نام همان‌جا صندلی شد (CONFIRMED)"
      : "شاخه‌ی «ثبت‌نام زودتر رسید»: NOT_APPROVED و بدون ردیف",
    racedTap.ok ? racedTap.status === "CONFIRMED" : racedTap.code === "NOT_APPROVED",
    racedTap.ok ? `status=${racedTap.status}` : `${racedTap.code}: ${racedTap.error}`,
  );
  if (!racedTap.ok) {
    const racedRetry = await registerSeat(client, { sessionId: fx.memberSessionId, userId: raced, now });
    check(
      "و تپ بعدیِ همان بازیکن، حالا که حساب تأیید شده → CONFIRMED",
      racedRetry.ok && racedRetry.status === "CONFIRMED",
      racedRetry.ok ? `status=${racedRetry.status}` : `${racedRetry.code}: ${racedRetry.error}`,
    );
  }

  // ۶ — approve × reject raced on one account. The rule the two branches share:
  //     the approval is the last word, whichever call reached the lock first.
  const duelledSettled = await Promise.allSettled([
    decideMembership(client, { userId: raceDecision, decision: "APPROVED", now }),
    decideMembership(client, { userId: raceDecision, decision: "REJECTED", now }),
  ]);
  checkNoRejection("دو تصمیم هم‌زمان روی یک حساب: قفل ردیف کاربر، آن‌ها را پشت هم چید", duelledSettled);

  const duelApprove = unwrap(duelledSettled[0]);
  const duelReject = unwrap(duelledSettled[1]);
  check(
    "«تأیید» همیشه موفق است — حتی اگر «رد» زودتر نشسته باشد",
    duelApprove.ok && duelApprove.decision === "APPROVED",
    duelApprove.ok ? undefined : `${duelApprove.code}: ${duelApprove.error}`,
  );
  check(
    "«رد» یا زودتر نشسته، یا با ALREADY_APPROVED باخته — حال سومی وجود ندارد",
    duelReject.ok || duelReject.code === "ALREADY_APPROVED",
    duelReject.ok ? "رد زودتر نشست" : `${duelReject.code}: ${duelReject.error}`,
  );
  const duelledRow = await client.user.findUnique({
    where: { id: raceDecision },
    select: { membershipStatus: true },
  });
  check(
    "و آخرین حرف روی حساب، در هر دو شاخه، «APPROVED» است",
    duelledRow?.membershipStatus === "APPROVED",
    `status=${duelledRow?.membershipStatus ?? "?"}`,
  );

  // The sandbox, end to end: four seats, the four approved accounts, nobody else.
  const sandbox = await seatCounts(fx.memberSessionId);
  check(
    `اتاق عضویت پر شد: ${toPersianDigits(MEMBER_CAPACITY)} صندلی برای ${toPersianDigits(
      MEMBER_CAPACITY,
    )} عضو تأییدشده`,
    sandbox.confirmed === MEMBER_CAPACITY && sandbox.occupied === MEMBER_CAPACITY,
    countsText(sandbox),
  );
}

// ---------------------------------------------------------------------------
// موج ۲ — the crowd
// ---------------------------------------------------------------------------

async function crowdWave(fx: Fixture): Promise<void> {
  group(
    `موج ۲ — ${toPersianDigits(MAIN_PLAYERS)} ثبت‌نام همزمان روی ظرفیت ${toPersianDigits(
      MAIN_CAPACITY,
    )}: صندلی یا لیست انتظار`,
  );

  const crowd = crowdOf(fx);
  const settled = await Promise.allSettled(
    crowd.map((userId) => registerSeat(client, { sessionId: fx.mainSessionId, userId })),
  );

  checkNoRejection("هیچ پرومیسی رد نشد (بدون خطای دیتابیس یا قفل)", settled);

  const outcomes = valuesOf(settled);
  const accepted = outcomes.filter((o): o is Extract<RegisterOutcome, { ok: true }> => o.ok);
  const refused = outcomes.filter((o): o is Extract<RegisterOutcome, { ok: false }> => !o.ok);

  const seated = accepted.filter((o) => o.status === "CONFIRMED");
  const waiting = accepted.filter((o) => o.status === "WAITLIST");

  check(
    `دقیقاً ${toPersianDigits(MAIN_CAPACITY)} نفر صندلی گرفتند`,
    seated.length === MAIN_CAPACITY,
    `شد ${toPersianDigits(seated.length)}`,
  );
  check(
    `دقیقاً ${toPersianDigits(MAIN_PLAYERS - MAIN_CAPACITY)} نفر به لیست انتظار رفتند`,
    waiting.length === MAIN_PLAYERS - MAIN_CAPACITY,
    `شد ${toPersianDigits(waiting.length)}`,
  );
  check(
    "هیچ درخواستی رد نشد (نه ALREADY، نه CLOSED، نه NOT_APPROVED)",
    refused.length === 0,
    refused.length > 0 ? `کدها: ${[...new Set(refused.map((o) => o.code))].join(", ")}` : undefined,
  );
  check(
    `هر ${toPersianDigits(MAIN_PLAYERS)} تپ یک جواب گرفت — چه صندلی، چه نوبت`,
    accepted.length === MAIN_PLAYERS,
    `پاسخ‌ها: ${toPersianDigits(accepted.length)}`,
  );

  const positions = waiting
    .map((o) => o.waitlistPosition)
    .filter((position): position is number => position !== null)
    .sort((a, b) => a - b);
  check(
    `${toPersianDigits(MAIN_PLAYERS - MAIN_CAPACITY)} شماره‌ی نوبت، یکتا و بدون پرش (۱ تا ${toPersianDigits(
      MAIN_PLAYERS - MAIN_CAPACITY,
    )})`,
    JSON.stringify(positions) === JSON.stringify(densePositions(MAIN_PLAYERS - MAIN_CAPACITY)),
    `شماره‌ها: ${positions.join(", ")}`,
  );

  const counts = await seatCounts(fx.mainSessionId);
  check(
    `در دیتابیس: ${toPersianDigits(MAIN_CAPACITY)} صندلی، ${toPersianDigits(
      MAIN_PLAYERS - MAIN_CAPACITY,
    )} در لیست انتظار — و ظرفیت دقیقاً پر است`,
    counts.confirmed === MAIN_CAPACITY &&
      counts.waitlist === MAIN_PLAYERS - MAIN_CAPACITY &&
      counts.occupied === MAIN_CAPACITY,
    countsText(counts),
  );

  const rows = await rowsOf(fx.mainSessionId, ["CONFIRMED", "WAITLIST"]);
  const uniquePlayers = new Set(rows.map((row) => row.userId)).size;
  check(
    `${toPersianDigits(MAIN_PLAYERS)} ردیف و یک ردیف برای هر بازیکن (بدون ردیف تکراری)`,
    rows.length === MAIN_PLAYERS && uniquePlayers === MAIN_PLAYERS,
    `ردیف‌ها ${toPersianDigits(rows.length)}، بازیکن یکتا ${toPersianDigits(uniquePlayers)}`,
  );
  check(
    "هر ردیف تازه تمیز است: نه مهر ارتقا، نه لغو، نه پرداخت، نه حضور",
    rows.every(
      (row) =>
        row.promotedAt === null &&
        row.canceledAt === null &&
        row.cancelType === null &&
        row.paidAt === null &&
        row.paymentStatus === "UNPAID" &&
        row.attendance === "PENDING",
    ),
  );
}

// ---------------------------------------------------------------------------
// موج ۳ — the double tap
// ---------------------------------------------------------------------------

async function doubleTapWave(fx: Fixture): Promise<void> {
  group("موج ۳ — هر بازیکن دو بار پشت هم (۶۰ فراخوان): یک ردیف، یک جمله");

  const crowd = crowdOf(fx);
  const taps = crowd.flatMap((userId) => [userId, userId]);

  const settled = await Promise.allSettled(
    taps.map((userId) => registerSeat(client, { sessionId: fx.mainSessionId, userId })),
  );

  checkNoRejection("هیچ پرومیسی رد نشد (P2002 خام بالا نیامد)", settled);

  const outcomes = valuesOf(settled);
  const already = outcomes.filter(
    (outcome) => !outcome.ok && outcome.code === "ALREADY" && outcome.error === ALREADY_REGISTERED,
  );
  check(
    `هر ۶۰ تپ تکراری جواب «قبلاً برای این سانس ثبت‌نام کردی» گرفت (${toPersianDigits(
      already.length,
    )} از ${toPersianDigits(outcomes.length)})`,
    already.length === outcomes.length,
    `غیرمنتظره: ${[...new Set(outcomes.filter((o) => o.ok || o.code !== "ALREADY").map((o) => (o.ok ? "ok" : o.code)))].join(", ")}`,
  );

  const rows = await rowsOf(fx.mainSessionId, ["CONFIRMED", "WAITLIST"]);
  const counts = await seatCounts(fx.mainSessionId);
  check(
    "هیچ ردیف جدیدی ساخته نشد — همان ۳۰ ردیف و همان ۱۲/۱۸",
    rows.length === MAIN_PLAYERS &&
      counts.confirmed === MAIN_CAPACITY &&
      counts.waitlist === MAIN_PLAYERS - MAIN_CAPACITY &&
      counts.occupied === MAIN_CAPACITY,
    countsText(counts),
  );
}

// ---------------------------------------------------------------------------
// موج ۴ — releases and promotions
// ---------------------------------------------------------------------------

async function releaseWave(fx: Fixture): Promise<void> {
  group("موج ۴ — آزادسازی ۳ صندلی: نفر اول صف مستقیم می‌رود تو سالن");

  const victims = (await rowsOf(fx.mainSessionId, ["CONFIRMED"])).slice(0, 3);
  const queueBefore = await rowsOf(fx.mainSessionId, ["WAITLIST"]);
  const now = new Date();

  const releases = victims.map((victim, index) => ({ victim, waiter: queueBefore[index] }));
  check(
    `حداقل ${toPersianDigits(releases.length)} نفر در صف انتظار هست (هر آزادسازی یک ارتقا دارد)`,
    releases.every((release) => release.waiter !== undefined),
    `صف ${toPersianDigits(queueBefore.length)} نفره`,
  );

  for (const [index, release] of releases.entries()) {
    const outcome = await cancelSeat(client, {
      sessionId: fx.mainSessionId,
      userId: release.victim.userId,
      now,
    });

    check(
      `انصراف ${toPersianDigits(index + 1)}: «لغو آزاد» بدون جریمه`,
      outcome.ok && outcome.kind === "FREE" && outcome.penaltyDays === 0,
      outcome.ok ? `kind=${outcome.kind} days=${outcome.penaltyDays}` : `${outcome.code}: ${outcome.error}`,
    );
    check(
      `انصراف ${toPersianDigits(index + 1)}: نفر اول صف (${release.waiter?.user.eitaaId ?? "?"}) بالا آمد و موتور همان را نام برد`,
      outcome.ok &&
        outcome.promoted === true &&
        outcome.promotedEitaaId === release.waiter?.user.eitaaId,
      outcome.ok ? `promoted=${String(outcome.promoted)} eitaa=${String(outcome.promotedEitaaId)}` : undefined,
    );
    check(
      `انصراف ${toPersianDigits(index + 1)}: عنوان سانس و ساعت شروع همراه نتیجه آمدند (ورودی پیام بعد از تراکنش)`,
      outcome.ok &&
        outcome.sessionTitle === fx.mainTitle &&
        outcome.startsAt.getTime() === fx.mainStartsAt.getTime(),
    );
  }

  const counts = await seatCounts(fx.mainSessionId);
  check(
    `پس از سه انصراف: باز هم ${toPersianDigits(MAIN_CAPACITY)} صندلی پر است — هر لغو یک ارتقا داشت، ${toPersianDigits(
      queueBefore.length - 3,
    )} در صف مانده`,
    counts.confirmed === MAIN_CAPACITY &&
      counts.canceled === 3 &&
      counts.waitlist === queueBefore.length - 3 &&
      counts.occupied === MAIN_CAPACITY,
    countsText(counts),
  );

  const promotedRows = (await rowsOf(fx.mainSessionId, ["CONFIRMED"])).filter(
    (row) => row.promotedAt !== null,
  );
  check(
    "هر سه ارتقایافته همین حالا در سالن‌اند — با مهر ارتقای همین لحظه",
    promotedRows.length === 3 && promotedRows.every((row) => row.promotedAt?.getTime() === now.getTime()),
    `ارتقایافته‌ها: ${toPersianDigits(promotedRows.length)}`,
  );
  check(
    "همان سه نفر اول صف بالا آمدند، به همان ترتیب",
    promotedRows.map((row) => row.id).join(",") ===
      queueBefore
        .slice(0, 3)
        .map((row) => row.id)
        .join(","),
  );
  check(
    "صندلی ارتقایافته هنوز پولی نداده و حضورش ثبت نشده",
    promotedRows.every((row) => row.paymentStatus === "UNPAID" && row.paidAt === null && row.attendance === "PENDING"),
  );

  const released = await rowsOf(fx.mainSessionId, ["CANCELED"]);
  check(
    "هر سه ردیف انصرافی CANCELED با نوع FREE و همان لحظه",
    released.length === 3 &&
      released.every((row) => row.cancelType === "FREE" && row.canceledAt?.getTime() === now.getTime()),
    `لغوشده‌ها: ${toPersianDigits(released.length)}`,
  );

  const queueAfter = await rowsOf(fx.mainSessionId, ["WAITLIST"]);
  const keptOrder = queueAfter.every((row, index) => row.id === queueBefore[index + 3]?.id);
  check(
    `صف ${toPersianDigits(queueAfter.length)} نفره شد و ترتیبش حفظ شد`,
    queueAfter.length === queueBefore.length - 3 && keptOrder,
    `طول صف ${toPersianDigits(queueAfter.length)}`,
  );

  const penalties = await penaltyRows(fx.players);
  check(
    "انصراف آزاد هیچ جریمه‌ای نمی‌نویسد",
    penalties.length === 0,
    `جریمه‌ها: ${toPersianDigits(penalties.length)}`,
  );
}

// ---------------------------------------------------------------------------
// موج ۵ — the cancel races
// ---------------------------------------------------------------------------

async function cancelRaceWave(fx: Fixture): Promise<void> {
  group("موج ۵ — مسابقه‌ی انصراف: یک صندلی دو تپ، و دو صندلی هم‌زمان");

  // ۱ — one seat, two taps at the same instant. The session lock serializes them,
  //     so the loser reads a `CANCELED` row — never a second FREE release (which
  //     would have promoted a second waiter into a hall that only lost one seat).
  const target = (await rowsOf(fx.mainSessionId, ["CONFIRMED"]))[0];
  const queueBefore = await rowsOf(fx.mainSessionId, ["WAITLIST"]);
  const now = new Date();

  const settled = await Promise.allSettled([
    cancelSeat(client, { sessionId: fx.mainSessionId, userId: target.userId, now }),
    cancelSeat(client, { sessionId: fx.mainSessionId, userId: target.userId, now }),
  ]);
  checkNoRejection("دو انصراف هم‌زمان روی یک ردیف: بدون خطای خام", settled);

  const winner = unwrap(settled[0]);
  check(
    "دقیقاً یکی صندلی را آزاد کرد",
    settled.filter((result) => result.status === "fulfilled" && result.value.ok).length === 1,
    `نتیجه‌ها: ${settled.map((result) => (result.status === "fulfilled" && result.value.ok ? "ok" : "refused")).join(", ")}`,
  );

  const loser = settled.filter(
    (result): result is PromiseFulfilledResult<Extract<CancelEngineResult, { ok: false }>> =>
      result.status === "fulfilled" && !result.value.ok,
  )[0];
  check(
    "دومی گفت «این ثبت‌نام قبلاً لغو شده» (ALREADY_CANCELED) — نه یک لغو دوم",
    loser !== undefined && loser.value.code === "ALREADY_CANCELED",
    loser ? `${loser.value.code}: ${loser.value.error}` : "هیچ بازنده‌ای پیدا نشد",
  );
  check(
    "و فقط یک نفر از صف بالا آمد — همان نفر اول",
    winner.ok && winner.promoted === true && winner.promotedEitaaId === queueBefore[0]?.user.eitaaId,
    winner.ok ? `promoted=${String(winner.promoted)} eitaa=${String(winner.promotedEitaaId)}` : `${winner.code}: ${winner.error}`,
  );

  const afterFirstRace = await seatCounts(fx.mainSessionId);
  check(
    `اشغال ثابت ماند: یک صندلی رفت و یک نفر آمد — ${toPersianDigits(MAIN_CAPACITY)} پر`,
    afterFirstRace.confirmed === MAIN_CAPACITY &&
      afterFirstRace.waitlist === queueBefore.length - 1 &&
      afterFirstRace.occupied === MAIN_CAPACITY,
    countsText(afterFirstRace),
  );

  const promotedOnce = await client.registration.findUnique({
    where: { id: queueBefore[0].id },
    select: { status: true, promotedAt: true },
  });
  check(
    "ردیف بالا‌آمده CONFIRMED است با مهر ارتقای همین لحظه",
    promotedOnce?.status === "CONFIRMED" && promotedOnce.promotedAt?.getTime() === now.getTime(),
    `status=${promotedOnce?.status ?? "?"}`,
  );

  // ۲ — two different seats released together: the two next waiters, each exactly
  //     once. The mapping to which cancel promoted whom is the database's
  //     business; the queue's own rule is what must hold.
  const queueMid = await rowsOf(fx.mainSessionId, ["WAITLIST"]);
  const seats = (await rowsOf(fx.mainSessionId, ["CONFIRMED"])).slice(0, 2);
  const before = await seatCounts(fx.mainSessionId);

  const bothSettled = await Promise.allSettled(
    seats.map((seat) => cancelSeat(client, { sessionId: fx.mainSessionId, userId: seat.userId, now })),
  );
  checkNoRejection("دو انصراف هم‌زمان روی دو صندلی: بدون خطای خام", bothSettled);

  const both = valuesOf(bothSettled);
  check(
    "هر دو آزاد شدند (لغو آزاد، بدون جریمه)",
    both.length === 2 && both.every((outcome) => outcome.ok && outcome.kind === "FREE"),
    both.map((outcome) => (outcome.ok ? outcome.kind : outcome.code)).join(", "),
  );

  const promotedIds = both.map((outcome) => (outcome.ok ? outcome.promotedEitaaId : null));
  const queueHead = queueMid.slice(0, 2).map((row) => row.user.eitaaId);
  check(
    "دقیقاً دو نفر بالا آمدند — همان دو نفر اول صف، هر کدام یک‌بار و هیچ‌کس دوباره",
    promotedIds.every((id) => id !== null) &&
      new Set(promotedIds).size === 2 &&
      queueHead.every((eitaaId) => promotedIds.includes(eitaaId)),
    `بالا‌آمده‌ها: ${promotedIds.join(", ")}`,
  );

  const after = await seatCounts(fx.mainSessionId);
  check(
    `اشغال ثابت ماند و صف دو نفر کوتاه شد (${toPersianDigits(after.waitlist)} نفر)`,
    after.confirmed === MAIN_CAPACITY &&
      after.occupied === MAIN_CAPACITY &&
      after.waitlist === before.waitlist - 2 &&
      after.canceled === before.canceled + 2,
    countsText(after),
  );

  const penalties = await penaltyRows(fx.players);
  check(
    "هیچ‌کدام از این لغوها جریمه نداشت (همه داخل پنجره‌ی آزاد سانس اصلی‌اند)",
    penalties.length === 0,
    `جریمه‌ها: ${toPersianDigits(penalties.length)}`,
  );
}

// ---------------------------------------------------------------------------
// موج ۶ — leaving the waitlist
// ---------------------------------------------------------------------------

async function waitlistWave(fx: Fixture): Promise<void> {
  group("موج ۶ — خداحافظی با لیست انتظار: آزاد در هر ساعتی، بازگشت به انتهای صف");

  const queueBefore = await rowsOf(fx.mainSessionId, ["WAITLIST"]);
  const target = queueBefore[0];
  const now = new Date();

  const leaving = await cancelSeat(client, { sessionId: fx.mainSessionId, userId: target.userId, now });
  check(
    "لغو یک ردیف لیست انتظار → «لغو آزاد» (سالن از قبل پر بود؛ چیزی آزاد نمی‌شود)",
    leaving.ok && leaving.kind === "FREE" && leaving.penaltyDays === 0,
    leaving.ok ? `kind=${leaving.kind} days=${leaving.penaltyDays}` : `${leaving.code}: ${leaving.error}`,
  );
  check(
    "و کسی را بالا نمی‌آورد — نه ارتقایی، نه نامی",
    leaving.ok && leaving.promoted === false && leaving.promotedEitaaId === null,
    leaving.ok ? `promoted=${String(leaving.promoted)}` : undefined,
  );
  check(
    "برای نفر لیست انتظار هیچ جریمه‌ای نوشته نشد",
    (await penaltyRows([target.userId])).length === 0,
  );

  const afterLeaving = await seatCounts(fx.mainSessionId);
  check(
    `اشغال ثابت ${toPersianDigits(MAIN_CAPACITY)} و صف یکی کوتاه‌تر شد`,
    afterLeaving.confirmed === MAIN_CAPACITY &&
      afterLeaving.occupied === MAIN_CAPACITY &&
      afterLeaving.waitlist === queueBefore.length - 1,
    countsText(afterLeaving),
  );

  const returned = await registerSeat(client, { sessionId: fx.mainSessionId, userId: target.userId, now });
  check(
    `بازگشت به سانسِ پر → لیست انتظار، انتهای صف (نوبت ${toPersianDigits(queueBefore.length)})`,
    returned.ok && returned.status === "WAITLIST" && returned.waitlistPosition === queueBefore.length,
    returned.ok ? `status=${returned.status} position=${String(returned.waitlistPosition)}` : `${returned.code}: ${returned.error}`,
  );

  const row = await registrationOf(fx.mainSessionId, target.userId);
  check(
    "همان یک ردیف باززنده شد (نه ردیف دوم) و همه‌ی مهرها پاک شدند",
    row?.id === target.id &&
      row.status === "WAITLIST" &&
      row.promotedAt === null &&
      row.canceledAt === null &&
      row.cancelType === null &&
      row.paidAt === null &&
      row.paymentStatus === "UNPAID" &&
      row.attendance === "PENDING",
    `status=${row?.status ?? "?"}`,
  );
  check(
    "و ترتیب صف از نو نوشته شد: این ردیف الان آخر صف است",
    row?.createdAt.getTime() === now.getTime(),
  );

  const after = await seatCounts(fx.mainSessionId);
  check(
    "طول صف به همان عدد برگشت و سانس پر ماند",
    after.waitlist === queueBefore.length && after.confirmed === MAIN_CAPACITY && after.occupied === MAIN_CAPACITY,
    countsText(after),
  );
}

// ---------------------------------------------------------------------------
// موج ۷ — the late-cancel story on the second سانس
// ---------------------------------------------------------------------------

async function lateStory(fx: Fixture): Promise<void> {
  group("موج ۷ — سانس دیرشروع: صندلی‌های هم‌زمان، اخطار اول، محرومیت واقعی");

  const first = latePlayer(fx, 1);
  const second = latePlayer(fx, 2);
  const third = latePlayer(fx, 3);
  const eitaa = await eitaaIdsOf([first, second, third]);
  const now = new Date();

  // ۱ — two taps at once, both land seats: this hall is empty, and an approved
  //     member's tap is a seat.
  const settled = await Promise.allSettled([
    registerSeat(client, { sessionId: fx.lateSessionId, userId: first, now }),
    registerSeat(client, { sessionId: fx.lateSessionId, userId: second, now }),
  ]);
  checkNoRejection("هیچ پرومیسی رد نشد", settled);
  check(
    `دو ثبت‌نام هم‌زمان روی ظرفیت ${toPersianDigits(LATE_CAPACITY)} → هر دو صندلی گرفتند`,
    valuesOf(settled).every((outcome) => outcome.ok && outcome.status === "CONFIRMED"),
    valuesOf(settled).map((outcome) => (outcome.ok ? outcome.status : outcome.code)).join(", "),
  );

  const afterBoth = await seatCounts(fx.lateSessionId);
  check(
    "سالن با دو صندلی پر شد",
    afterBoth.confirmed === LATE_CAPACITY && afterBoth.occupied === LATE_CAPACITY,
    countsText(afterBoth),
  );

  // ۲ — the third player waits in line.
  const waiting = await registerSeat(client, { sessionId: fx.lateSessionId, userId: third, now });
  check(
    "نفر سوم → لیست انتظار، نوبت ۱",
    waiting.ok && waiting.status === "WAITLIST" && waiting.waitlistPosition === 1,
    waiting.ok ? `status=${waiting.status}` : `${waiting.code}: ${waiting.error}`,
  );

  // ۳ — the sharp one: leaving the queue is free **inside** the late window too.
  //     The clock says «late», the status says «nothing was held» — the status
  //     wins, and no rule is even read.
  const queueExit = await cancelSeat(client, { sessionId: fx.lateSessionId, userId: third, now });
  check(
    "لغو ردیف انتظار داخل پنجره‌ی دیرهنگام → باز هم «لغو آزاد»، بدون جریمه",
    queueExit.ok && queueExit.kind === "FREE" && queueExit.penaltyDays === 0,
    queueExit.ok ? `kind=${queueExit.kind} days=${queueExit.penaltyDays}` : `${queueExit.code}: ${queueExit.error}`,
  );
  check(
    "و کسی را بالا نمی‌آورد (سالن از قبل پر بود، جا آزاد نشد)",
    queueExit.ok && queueExit.promoted === false && queueExit.promotedEitaaId === null,
  );
  check(
    "برای نفر لیست انتظار هیچ جریمه‌ای نوشته نشد",
    (await penaltyRows([third])).length === 0,
  );

  // ۴ — the third asks again: the queue was empty, so the word is «نوبت ۱».
  const thirdAgain = await registerSeat(client, { sessionId: fx.lateSessionId, userId: third, now });
  check(
    "و دوباره ثبت‌نام می‌کند → لیست انتظار، نوبت ۱",
    thirdAgain.ok && thirdAgain.status === "WAITLIST" && thirdAgain.waitlistPosition === 1,
    thirdAgain.ok ? `status=${thirdAgain.status}` : `${thirdAgain.code}: ${thirdAgain.error}`,
  );

  // ۵ — the second leaves late: the first late cancel inside the window is a
  //     warning, and the freed seat goes straight to the first person in line.
  const secondLate = await cancelSeat(client, { sessionId: fx.lateSessionId, userId: second, now });
  check(
    "انصراف ۶ ساعت به شروع → «اخطار اول»، بدون محرومیت",
    secondLate.ok && secondLate.kind === "LATE_WARNING" && secondLate.penaltyDays === 0,
    secondLate.ok ? `kind=${secondLate.kind} days=${secondLate.penaltyDays}` : `${secondLate.code}: ${secondLate.error}`,
  );
  check(
    "و صندلی آزادشده مستقیم به نفر اول صف رسید",
    secondLate.ok && secondLate.promoted === true && secondLate.promotedEitaaId === eitaa.get(third),
    secondLate.ok ? `promoted=${String(secondLate.promoted)} eitaa=${String(secondLate.promotedEitaaId)}` : undefined,
  );

  const thirdRow = await registrationOf(fx.lateSessionId, third);
  check(
    "ردیف بالا‌آمده CONFIRMED است با مهر ارتقای همین لحظه",
    thirdRow?.status === "CONFIRMED" && thirdRow.promotedAt?.getTime() === now.getTime(),
    `status=${thirdRow?.status ?? "?"}`,
  );

  const secondPenalties = await penaltyRows([second]);
  check(
    "دقیقاً یک ردیف اخطار برای نفر دوم: صفر روز، بدون پنجره، با کلمه‌ی «اخطار»",
    secondPenalties.length === 1 &&
      secondPenalties[0].type === "LATE_CANCEL" &&
      secondPenalties[0].days === 0 &&
      secondPenalties[0].startsAt.getTime() === secondPenalties[0].endsAt.getTime() &&
      secondPenalties[0].reason.includes("اخطار"),
    secondPenalties.map((row) => `days=${row.days}`).join(", "),
  );

  // ۶ — the first leaves late too: their own first warning, and an empty queue —
  //     so nobody is promoted (the freed seat simply stays empty).
  const firstLate = await cancelSeat(client, { sessionId: fx.lateSessionId, userId: first, now });
  check(
    "اخطار اول نفر اول هم بدون محرومیت",
    firstLate.ok && firstLate.kind === "LATE_WARNING" && firstLate.penaltyDays === 0,
    firstLate.ok ? `kind=${firstLate.kind}` : `${firstLate.code}: ${firstLate.error}`,
  );
  check(
    "صف خالی است → کسی بالا نمی‌آید",
    firstLate.ok && firstLate.promoted === false && firstLate.promotedEitaaId === null,
  );

  // ۷ — a fresh registration: the seat is there, and the warning is history, not
  //     an eraser (the row restarts, the Penalty row stays).
  const firstAgain = await registerSeat(client, { sessionId: fx.lateSessionId, userId: first, now });
  check(
    "ثبت‌نام دوباره روی صندلی آزاد → CONFIRMED، و اخطار قبلی سر جایش است",
    firstAgain.ok && firstAgain.status === "CONFIRMED" && (await penaltyRows([first])).length === 1,
    firstAgain.ok ? `status=${firstAgain.status}` : `${firstAgain.code}: ${firstAgain.error}`,
  );

  // ۸ — the second late cancel inside the window: a real ban, 3 days.
  const firstLateAgain = await cancelSeat(client, { sessionId: fx.lateSessionId, userId: first, now });
  check(
    "دومین انصراف دیرهنگام در همان بازه → محرومیت واقعی (۳ روز، طبق قوانین پین‌شده‌ی سانس)",
    firstLateAgain.ok && firstLateAgain.kind === "LATE_PENALTY" && firstLateAgain.penaltyDays === 3,
    firstLateAgain.ok ? `kind=${firstLateAgain.kind} days=${firstLateAgain.penaltyDays}` : `${firstLateAgain.code}: ${firstLateAgain.error}`,
  );

  const firstPenalties = await penaltyRows([first]);
  check(
    "دو جریمه در کل برای نفر اول: یک اخطار و یک محرومیت ۳ روزه که از همین لحظه شروع می‌شود",
    firstPenalties.length === 2 &&
      firstPenalties[1].days === 3 &&
      firstPenalties[1].startsAt.getTime() === now.getTime() &&
      firstPenalties[1].endsAt.getTime() === now.getTime() + 3 * DAY_MS,
    firstPenalties.map((row) => `days=${row.days}`).join(", "),
  );

  // ۹ — the second comes back to the empty seat: a clean seat, no waiting.
  const secondAgain = await registerSeat(client, { sessionId: fx.lateSessionId, userId: second, now });
  check(
    "نفر دوم روی صندلی آزاد → CONFIRMED",
    secondAgain.ok && secondAgain.status === "CONFIRMED",
    secondAgain.ok ? `status=${secondAgain.status}` : `${secondAgain.code}: ${secondAgain.error}`,
  );

  // ۱۰ — the ban closes the app for that player, before anything else.
  const banned = await registerSeat(client, { sessionId: fx.lateSessionId, userId: first, now });
  check(
    "ثبت‌نام در دوران محرومیت → BANNED با همان تاریخ پایان",
    !banned.ok && banned.code === "BANNED" && banned.bannedUntil === firstPenalties[1].endsAt.toISOString(),
    banned.ok ? "ok برگشت" : `${banned.code}: ${banned.error}`,
  );
  check(
    "ردیف بازیکن محروم دست‌نخورده ماند — ban جلوی ثبت‌نام را گرفت، ردیف را عوض نکرد",
    (await registrationOf(fx.lateSessionId, first))?.status === "CANCELED",
  );

  const final = await seatCounts(fx.lateSessionId);
  check(
    "سالن دوباره پر است و صف خالی",
    final.confirmed === LATE_CAPACITY && final.waitlist === 0 && final.occupied === LATE_CAPACITY,
    countsText(final),
  );
}

// ---------------------------------------------------------------------------
// موج ۸ — the guards
// ---------------------------------------------------------------------------

async function guardsWave(fx: Fixture): Promise<void> {
  group("موج ۸ — نگهبان‌ها: سانسِ شروعمده، حساب بی‌ردیف، و محرومیتی که از دروازه هم جلوتر است");

  const guard = guardPlayerOf(fx);
  const now = new Date();

  const startedTap = await registerSeat(client, { sessionId: fx.startedSessionId, userId: guard, now });
  check(
    "ثبت‌نام روی سانسِ شروعمده → CLOSED",
    !startedTap.ok && startedTap.code === "CLOSED",
    startedTap.ok ? `ok برگشت (${startedTap.status})` : `${startedTap.code}: ${startedTap.error}`,
  );

  const startedCancel = await cancelSeat(client, { sessionId: fx.startedSessionId, userId: guard, now });
  check(
    "لغو روی همان سانس → STARTED با جمله‌ی «سانس شروع شده»",
    !startedCancel.ok && startedCancel.code === "STARTED" && startedCancel.error.includes("شروع"),
    startedCancel.ok ? "ok برگشت" : `${startedCancel.code}: ${startedCancel.error}`,
  );

  const missingSession = await registerSeat(client, {
    sessionId: `${RESERVED_ID_PREFIX}missing_session`,
    userId: guard,
    now,
  });
  check(
    "ثبت‌نام روی سانس ناشناس → NOT_FOUND",
    !missingSession.ok && missingSession.code === "NOT_FOUND",
    missingSession.ok ? "ok برگشت" : `${missingSession.code}: ${missingSession.error}`,
  );

  const unregisteredCancel = await cancelSeat(client, { sessionId: fx.mainSessionId, userId: member(fx, 5), now });
  check(
    "لغو جایی که ردیفی نداری → NOT_REGISTERED",
    !unregisteredCancel.ok && unregisteredCancel.code === "NOT_REGISTERED",
    unregisteredCancel.ok ? "ok برگشت" : `${unregisteredCancel.code}: ${unregisteredCancel.error}`,
  );

  // The ban outranks the membership gate on purpose: player ۶ is still `PENDING`
  // (so the gate would refuse too) **and** has an active manual ban. Getting
  // `BANNED` — not `NOT_APPROVED` — is what proves the order.
  const bannedMember = member(fx, 6);
  const banEndsAt = new Date(now.getTime() + 2 * DAY_MS);
  await client.penalty.create({
    data: {
      userId: bannedMember,
      type: "MANUAL",
      days: 3,
      reason: "محرومیت دستی تست check:race",
      startsAt: new Date(now.getTime() - DAY_MS),
      endsAt: banEndsAt,
    },
  });

  const bannedTap = await registerSeat(client, { sessionId: fx.mainSessionId, userId: bannedMember, now });
  check(
    "حساب «در انتظار تأیید» با محرومیت فعال → BANNED (محرومیت از دروازه‌ی عضویت هم جلوتر است)",
    !bannedTap.ok && bannedTap.code === "BANNED" && bannedTap.bannedUntil === banEndsAt.toISOString(),
    bannedTap.ok ? `ok برگشت (${bannedTap.status})` : `${bannedTap.code}: ${bannedTap.error}`,
  );
  check(
    "و برای او ردیفی نوشته نشد",
    (await registrationOf(fx.mainSessionId, bannedMember)) === null,
  );
}

// ---------------------------------------------------------------------------
// بررسی نهایی — the invariants that hold whatever the races did
// ---------------------------------------------------------------------------

async function invariants(fx: Fixture): Promise<void> {
  group("بررسی نهایی — ناوابسته به ترتیب موج‌ها");

  const halls = [
    { name: `سانس اصلی (${toPersianDigits(MAIN_CAPACITY)} نفره)`, id: fx.mainSessionId, capacity: MAIN_CAPACITY },
    { name: `اتاق عضویت (${toPersianDigits(MEMBER_CAPACITY)} نفره)`, id: fx.memberSessionId, capacity: MEMBER_CAPACITY },
    { name: `سانس دیرشروع (${toPersianDigits(LATE_CAPACITY)} نفره)`, id: fx.lateSessionId, capacity: LATE_CAPACITY },
  ];

  for (const hall of halls) {
    const counts = await seatCounts(hall.id);
    check(
      `«${hall.name}»: اشغال هرگز از ظرفیت بیشتر نشد`,
      counts.occupied <= hall.capacity,
      countsText(counts),
    );
  }

  const crowd = crowdOf(fx);
  const mainRows = await client.registration.findMany({
    where: { sessionId: fx.mainSessionId },
    select: { userId: true },
  });
  check(
    `در سانس اصلی برای هر ${toPersianDigits(MAIN_PLAYERS)} بازیکن دقیقاً یک ردیف است`,
    mainRows.length === MAIN_PLAYERS &&
      new Set(mainRows.map((row) => row.userId)).size === MAIN_PLAYERS &&
      mainRows.every((row) => crowd.includes(row.userId)),
    `ردیف‌ها ${toPersianDigits(mainRows.length)}`,
  );

  const main = await seatCounts(fx.mainSessionId);
  check(
    `سانس اصلی پرِ پر است: ${toPersianDigits(MAIN_CAPACITY)} صندلی و هیچ ردیف نیمه‌کاری`,
    main.confirmed === MAIN_CAPACITY && main.occupied === MAIN_CAPACITY,
    countsText(main),
  );

  const memberRows = await client.registration.findMany({
    where: { sessionId: fx.memberSessionId },
    select: { userId: true, status: true },
  });
  const approvedMembers = [member(fx, 1), member(fx, 2), member(fx, 3), member(fx, 4)];
  check(
    "اتاق عضویت مال همان چهار عضو تأییدشده است — نه کمتر، نه بیشتر",
    memberRows.length === MEMBER_CAPACITY &&
      memberRows.every((row) => row.status === "CONFIRMED") &&
      approvedMembers.every((id) => memberRows.some((row) => row.userId === id)),
    `ردیف‌ها ${toPersianDigits(memberRows.length)}`,
  );

  const penalties = await penaltyRows(fx.players);
  check(
    "در کل اجرا فقط چهار جریمه نوشته شد: دو اخطار صفر‌روزه، یک محرومیت ۳ روزه‌ی انصراف دیرهنگام و یک محرومیت دستی",
    penalties.length === 4 &&
      penalties.filter((row) => row.days === 0).length === 2 &&
      penalties.filter((row) => row.type === "LATE_CANCEL" && row.days === 3).length === 1 &&
      penalties.filter((row) => row.type === "MANUAL" && row.days === 3).length === 1,
    penalties.map((row) => `type=${row.type} days=${row.days}`).join(", "),
  );

  const stillPending = await client.user.count({
    where: { id: { in: fx.players }, membershipStatus: "PENDING" },
  });
  check(
    "دقیقاً یک حساب تستی هنوز در انتظار تأیید مانده — همان که محرومش کرده‌ایم",
    stillPending === 1,
    `در انتظار: ${toPersianDigits(stillPending)}`,
  );

  // The gate's own invariant, asked of the database at the end: after every race
  // and every decision, not one seat in this run belongs to an account the
  // manager has not approved.
  const unapprovedSeats = await client.registration.count({
    where: {
      user: { is: { eitaaId: { startsWith: RESERVED_EITAA_PREFIX }, membershipStatus: { not: "APPROVED" } } },
    },
  });
  check(
    "هیچ ردیفی به حساب تأییدنشده تعلق ندارد (دروازه‌ی عضویت، در پایانِ همه‌ی موج‌ها)",
    unapprovedSeats === 0,
    `ردیف‌ها: ${toPersianDigits(unapprovedSeats)}`,
  );
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

  const sessions = venues.length
    ? await client.session.findMany({
        where: { venueId: { in: venues.map((row) => row.id) } },
        select: { id: true },
      })
    : [];
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

  // Registrations → penalties → users → sessions → venue: children before
  // parents, exactly as the relations require.
  if (sessionIds.length > 0 || userIds.length > 0) {
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

  const [venues, sessions, users, registrations, penalties] = await Promise.all([
    client.venue.count({ where: { id: { startsWith: RESERVED_ID_PREFIX } } }),
    client.session.count({ where: { id: { startsWith: RESERVED_ID_PREFIX } } }),
    client.user.count({ where: { eitaaId: eitaa } }),
    client.registration.count({ where: { user: { eitaaId: eitaa } } }),
    client.penalty.count({ where: { user: { eitaaId: eitaa } } }),
  ]);

  check(
    "پاک‌سازی کامل: سالن، سانس، کاربر، ثبت‌نام و جریمه‌ی تستی صفر شد",
    venues === 0 && sessions === 0 && users === 0 && registrations === 0 && penalties === 0,
    `سالن ${venues}، سانس ${sessions}، کاربر ${users}، ثبت‌نام ${registrations}، جریمه ${penalties}`,
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
  console.log("check:race — دروازه‌ی عضویت، صندلی‌ها، صف، ارتقا و محرومیت");
  console.log(`دیتابیس: ${describeDatabase(databaseUrl)}`);

  await cleanup();

  const fixture = await setup();
  try {
    await membershipWave(fixture);
    await crowdWave(fixture);
    await doubleTapWave(fixture);
    await releaseWave(fixture);
    await cancelRaceWave(fixture);
    await waitlistWave(fixture);
    await lateStory(fixture);
    await guardsWave(fixture);
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
    process.exit(1);
  }

  console.log(`\nPASS — ${toPersianDigits(checks)} بررسی، همه سبز.`);
  process.exit(0);
}

void run();
