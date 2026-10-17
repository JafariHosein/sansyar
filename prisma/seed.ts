/**
 * سانس‌یار — demo seed (PROMPT.md §12).
 *
 * Idempotent: every row is an `upsert`, so `npm.cmd run db:seed` can be re-run
 * safely. Session times are computed **relative to today** (in Tehran
 * wall-clock, converted to UTC), so re-seeding always produces a live demo:
 * one session open right now, one whose registration has not opened yet, one
 * whose capacity is full with a waitlist, and past sessions with attendance.
 *
 * There is no phone-based login anywhere: identity is the Eitaa user id, exactly
 * like production. `User.phone` is the player's **contact number** — asked once
 * on the first run, shown to the manager only — so every demo player gets a
 * deterministic one, except the two deliberate `null`s noted below (they are how
 * the first-run sheet stays reachable from the dev login). The real-name pair the
 * same sheet collects (`firstName` / `lastName`) is seeded the same way, with one
 * deliberate `null` pair for the same reason.
 *
 * The demo also carries the **membership gate** end to end, because a queue
 * nobody can see is a queue nobody can check: three demo accounts are waiting for
 * the manager (`PENDING`, shown in the queue with their name and number) and one
 * is rejected (re-approvable from `/admin` — the owner's rule that a rejection is
 * not a dead end). Every registered player is approved, so the seat engines have
 * only their own two answers: a seat in the hall, or the waitlist.
 *
 * This script builds its own Prisma client instead of importing
 * `src/lib/db.ts`: that module is marked `server-only` and would throw outside
 * the Next.js server runtime.
 */
import "dotenv/config";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import {
  JALALI_WEEKDAYS,
  tehranWallClock,
  tehranWallClockToUtc,
  toJalaliDateTime,
} from "../src/lib/jalali";
import {
  PrismaClient,
  type AttendanceStatus,
  type CancelType,
  type PaymentMode,
  type PaymentStatus,
  type PenaltyType,
  type RegistrationStatus,
  type Session,
  type SessionStatus,
} from "../src/generated/prisma/client";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Used when `ADMIN_EITAA_ID` is empty, so a fresh clone still has an admin. */
const DEMO_ADMIN_EITAA_ID = "100000000";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env and fill it in.");
}

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(databaseUrl),
});

// ---------------------------------------------------------------------------
// Time helpers — the demo is anchored to Asia/Tehran, stored as UTC
// ---------------------------------------------------------------------------

/** Tehran wall-clock `hour:minute` on the day `dayOffset` days from today → UTC. */
function slot(dayOffset: number, hour: number, minute = 0): Date {
  const today = tehranWallClock(new Date());
  const day = new Date(Date.UTC(today.gy, today.gm - 1, today.gd + dayOffset));
  return tehranWallClockToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute);
}

/** «شبِ چهارشنبه» — derived from the seeded date, so a title can never lie. */
function partOfDay(startsAt: Date, part: "شب" | "عصر"): string {
  const { weekdayIndex } = toJalaliDateTime(startsAt);
  return `${part}ِ ${JALALI_WEEKDAYS[weekdayIndex]}`;
}

function sessionTitle(startsAt: Date, part: "شب" | "عصر"): string {
  return `سانس فوتسال — ${partOfDay(startsAt, part)}`;
}

/** Registration opens a few days before the session and closes 3 hours before it. */
function registrationWindow(startsAt: Date, opensDaysBefore = 4, closesHoursBefore = 3) {
  return {
    registrationOpensAt: new Date(startsAt.getTime() - opensDaysBefore * DAY),
    registrationClosesAt: new Date(startsAt.getTime() - closesHoursBefore * HOUR),
  };
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const VENUES = [
  {
    id: "seed_venue_azadi",
    name: "سالن فوتسال آزادی — سالن شماره ۲",
    address: "تهران، خیابان آزادی، نبش کوچه‌ی شهیدان، مجموعه‌ی ورزشی آزادی",
    description: "زمین پارکت سرپوشیده با رختکن و دوش آب گرم.",
    mapUrl: "https://neshan.org/maps/share/35.6997,51.3380",
  },
  {
    id: "seed_venue_alghadir",
    name: "مجموعه‌ی ورزشی الغدیر",
    address: "تهران، بزرگراه همت، خروجی الغدیر، سالن شماره ۱",
    description: "سالن بزرگ‌تر با پارکینگ اختصاصی.",
    mapUrl: null,
  },
] as const;

/**
 * The eight names from the brief, plus eight more so the "capacity full +
 * waitlist" session can actually be full (12 + 3 = 15 registered players) — and
 * three more who are **not registered anywhere**: they exist to staff the
 * manager's membership queue (`farhad` and `sajad` waiting, `kamran` rejected,
 * which is the row the re-approval flow needs). Demo Eitaa ids only — never real
 * ones.
 *
 * `phone` is the contact number as it will be stored (`09XXXXXXXXX`): a fixed
 * `0912` + the last seven digits of the demo id, so re-seeding is deterministic
 * and two players can never share one. **`mehdi` is deliberately `null`** — the
 * one player without a number, which is what makes the first-run sheet reachable
 * for an *existing* account (`npx.cmd tsx scripts/eitaa-sign-initdata.ts --id
 * 200000005`).
 *
 * `firstName` / `lastName` are the **real** name pair the same sheet collects —
 * what the manager reads on a roster, next to the Eitaa display name in `name`.
 * **`ramin` is deliberately `null`** on both halves: the one account whose roster
 * row shows the display-name fallback (`fullNameOf` → `null`), and the one whose
 * sheet still has a half left to answer while their number is already saved.
 *
 * Membership is left at the default for the established members (`APPROVED`); the
 * `MEMBERSHIP_STATUS` map below names the three queue fixtures. A `PENDING`
 * account can do nothing in the app — that is what the waiting screen is for — so
 * no `PENDING` account below holds a registration, and the seat engines only ever
 * see approved people.
 */
const PLAYERS = [
  {
    key: "amirhossein",
    name: "امیرحسین کریمی",
    firstName: "امیرحسین",
    lastName: "کریمی",
    eitaaId: "200000001",
    phone: "09120000001",
  },
  {
    key: "sina",
    name: "سینا محمدی",
    firstName: "سینا",
    lastName: "محمدی",
    eitaaId: "200000002",
    phone: "09120000002",
  },
  {
    key: "mohammadreza",
    name: "محمدرضا رضایی",
    firstName: "محمدرضا",
    lastName: "رضایی",
    eitaaId: "200000003",
    phone: "09120000003",
  },
  {
    key: "arash",
    name: "آرش نادری",
    firstName: "آرش",
    lastName: "نادری",
    eitaaId: "200000004",
    phone: "09120000004",
  },
  {
    key: "mehdi",
    name: "مهدی توکلی",
    firstName: "مهدی",
    lastName: "توکلی",
    eitaaId: "200000005",
    phone: null,
  },
  {
    key: "hossein",
    name: "حسین صادقی",
    firstName: "حسین",
    lastName: "صادقی",
    eitaaId: "200000006",
    phone: "09120000006",
  },
  {
    key: "alireza",
    name: "علیرضا مرادی",
    firstName: "علیرضا",
    lastName: "مرادی",
    eitaaId: "200000007",
    phone: "09120000007",
  },
  {
    key: "parsa",
    name: "پارسا احمدی",
    firstName: "پارسا",
    lastName: "احمدی",
    eitaaId: "200000008",
    phone: "09120000008",
  },
  {
    key: "kian",
    name: "کیان رستمی",
    firstName: "کیان",
    lastName: "رستمی",
    eitaaId: "200000009",
    phone: "09120000009",
  },
  {
    key: "behrad",
    name: "بهراد فتحی",
    firstName: "بهراد",
    lastName: "فتحی",
    eitaaId: "200000010",
    phone: "09120000010",
  },
  {
    key: "saman",
    name: "سامان نیک‌زاد",
    firstName: "سامان",
    lastName: "نیک‌زاد",
    eitaaId: "200000011",
    phone: "09120000011",
  },
  {
    key: "yasin",
    name: "یاسین قاسمی",
    firstName: "یاسین",
    lastName: "قاسمی",
    eitaaId: "200000012",
    phone: "09120000012",
  },
  {
    key: "abolfazl",
    name: "ابوالفضل نوری",
    firstName: "ابوالفضل",
    lastName: "نوری",
    eitaaId: "200000013",
    phone: "09120000013",
  },
  {
    key: "nima",
    name: "نیما شریفی",
    firstName: "نیما",
    lastName: "شریفی",
    eitaaId: "200000014",
    phone: "09120000014",
  },
  {
    key: "omid",
    name: "امید ملکی",
    firstName: "امید",
    lastName: "ملکی",
    eitaaId: "200000015",
    phone: "09120000015",
  },
  {
    key: "ramin",
    name: "رامین اسدی",
    firstName: null,
    lastName: null,
    eitaaId: "200000016",
    phone: "09120000016",
  },
  {
    key: "farhad",
    name: "فرهاد بهرامی",
    firstName: "فرهاد",
    lastName: "بهرامی",
    eitaaId: "200000017",
    phone: "09120000017",
  },
  {
    key: "sajad",
    name: "سجاد قربانی",
    firstName: "سجاد",
    lastName: "قربانی",
    eitaaId: "200000018",
    phone: "09120000018",
  },
  {
    key: "kamran",
    name: "کامران یوسفی",
    firstName: "کامران",
    lastName: "یوسفی",
    eitaaId: "200000019",
    phone: "09120000019",
  },
] as const;

type PlayerKey = (typeof PLAYERS)[number]["key"];

/**
 * The only three accounts that are **not** approved members — a map rather than a
 * field on every entry, because «approved» is the demo's norm and these three are
 * the exception the manager's screen exists for: two people waiting and one the
 * manager turned away (whom `/admin` can take back — a rejection is not final).
 */
const MEMBERSHIP_STATUS: Partial<Record<PlayerKey, SeededMembership>> = {
  farhad: "PENDING",
  sajad: "PENDING",
  kamran: "REJECTED",
};

/** What a seeded account's membership can be — the column's own three states. */
type SeededMembership = "APPROVED" | "PENDING" | "REJECTED";

/**
 * The **demo wallets** (the balance round): two players carry money so the
 * feature is visible the moment the app opens — `sina` covers a whole seat
 * (`۶۰٬۰۰۰` against a `۴۵٬۰۰۰` price → `PAID_BALANCE`), `arash` covers only part
 * of one (`۲۰٬۰۰۰` → «… از موجودیات کم شد · حضوری بده …»).
 *
 * Seeded on **create only**, deliberately: a re-seed must not rewrite money. The
 * ledger (`BalanceEntry`) is never deleted by the seed, so resetting the column
 * would break its arithmetic — the card and the history would disagree. An
 * existing database therefore keeps whatever the manager has adjusted; the
 * opening entry below is written once and left alone.
 */
const SEED_BALANCES: Partial<Record<PlayerKey, number>> = {
  sina: 60_000,
  arash: 20_000,
};

/** one entry per registration of a seeded session */
type RegistrationSeed = {
  player: PlayerKey;
  status?: RegistrationStatus;
  payment?: PaymentStatus;
  attendance?: AttendanceStatus;
  /** minutes late, for `attendance: "LATE"` */
  lateMinutes?: number;
  cancelType?: CancelType;
  /** Came off the waitlist (§۵.۲): stamps `promotedAt`, and always pairs with `CONFIRMED`. */
  promoted?: boolean;
};

const SESSION_IDS = {
  openInPerson: "seed_session_open_in_person",
  soon: "seed_session_soon",
  full: "seed_session_full",
  past: "seed_session_past",
  online: "seed_session_online",
  canceled: "seed_session_canceled",
  draft: "seed_session_draft",
  openSecond: "seed_session_open_second",
  pastOlder: "seed_session_past_older",
} as const;

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

async function seedSettings() {
  // `update: {}` on purpose: re-seeding must not wipe rules the admin edited.
  return prisma.setting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

async function seedAdmin() {
  const configured = (process.env.ADMIN_EITAA_ID ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const eitaaId = configured[0] ?? DEMO_ADMIN_EITAA_ID;

  // **The manager is deliberately left without a number** (the second `null`):
  // the first-run sheet is what asks for it, and the manager should see it too.
  // A re-seed never wipes one the manager has already saved, because the update
  // branch simply does not touch the column. The **real-name pair is left `null`
  // for the same reason** — `ADMIN_EITAA_ID` may hold a real person's id, and an
  // invented pair would be a lie *and* unchangeable (the pair is immutable), so
  // the sheet asks the manager too.
  //
  // The update branch also leaves the **name** alone: `ADMIN_EITAA_ID` holds a
  // real person's id, so re-seeding must never rename an account whose owner has
  // set their own name. Only a fresh row gets the default «مدیر سانس».
  return prisma.user.upsert({
    where: { eitaaId },
    update: { role: "ADMIN", membershipStatus: "APPROVED" },
    create: {
      eitaaId,
      name: "مدیر سانس",
      role: "ADMIN",
      phone: null,
      // The manager approves people; nobody approves the manager.
      membershipStatus: "APPROVED",
    },
  });
}

async function seedVenues() {
  const ids = new Map<string, string>();

  for (const venue of VENUES) {
    const row = await prisma.venue.upsert({
      where: { id: venue.id },
      update: {
        name: venue.name,
        address: venue.address,
        description: venue.description,
        mapUrl: venue.mapUrl,
        isActive: true,
      },
      create: {
        id: venue.id,
        name: venue.name,
        address: venue.address,
        description: venue.description,
        mapUrl: venue.mapUrl,
      },
    });
    ids.set(venue.id, row.id);
  }

  return ids;
}

async function seedPlayers() {
  const ids = new Map<PlayerKey, string>();

  for (const player of PLAYERS) {
    // Everybody below is an established member except the three queue fixtures;
    // a decided account carries a stamp — when is not a fact the demo needs, only
    // *that* it was decided, so the seed run's own clock is honest enough for a
    // fixture.
    const membershipStatus: SeededMembership = MEMBERSHIP_STATUS[player.key] ?? "APPROVED";
    const decided = {
      membershipStatus,
      membershipDecidedAt: membershipStatus === "PENDING" ? null : new Date(),
    };

    const row = await prisma.user.upsert({
      where: { eitaaId: player.eitaaId },
      // The number, the real-name pair **and the membership status** are part of
      // the demo data: re-seeding restores them (and the deliberate `null`s),
      // which is what keeps the first-run sheets and the manager's queue
      // reproducible. The **balance is not** — it is only seeded on a fresh row
      // (see `SEED_BALANCES`): money is the one column a re-seed must never
      // rewrite, or the ledger would stop adding up.
      update: {
        name: player.name,
        phone: player.phone,
        firstName: player.firstName,
        lastName: player.lastName,
        ...decided,
      },
      create: {
        eitaaId: player.eitaaId,
        name: player.name,
        phone: player.phone,
        firstName: player.firstName,
        lastName: player.lastName,
        balance: SEED_BALANCES[player.key] ?? 0,
        ...decided,
      },
    });

    // The opening movement that explains the number: a demo wallet with no entry
    // would be the one balance the ledger cannot account for. Written once,
    // idempotently, and never updated — the owner's own later movements are the
    // history that follows it.
    const opening = SEED_BALANCES[player.key];
    if (opening) {
      await prisma.balanceEntry.upsert({
        where: { id: `seed_balance_${player.key}` },
        update: {},
        create: {
          id: `seed_balance_${player.key}`,
          userId: row.id,
          amount: opening,
          balanceAfter: opening,
          type: "ADMIN_ADJUST",
          note: "موجودی اولیه‌ی حساب نمونه",
        },
      });
    }

    ids.set(player.key, row.id);
  }

  return ids;
}

type SessionSeed = {
  id: string;
  venueId: string;
  part: "شب" | "عصر";
  startsAt: Date;
  endsAt: Date;
  description: string;
  capacity: number;
  priceToman: number;
  paymentMode: PaymentMode;
  status?: SessionStatus;
  opensDaysBefore?: number;
  /** The manager's map link (Neshan). Left empty on most demo slots on purpose. */
  mapUrl?: string;
};

async function seedSession(input: SessionSeed) {
  const data = {
    title: sessionTitle(input.startsAt, input.part),
    venueId: input.venueId,
    description: input.description,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    ...registrationWindow(input.startsAt, input.opensDaysBefore ?? 4),
    capacity: input.capacity,
    priceToman: input.priceToman,
    paymentMode: input.paymentMode,
    status: input.status ?? "PUBLISHED",
    mapUrl: input.mapUrl ?? null,
  };

  // Times refresh on every run, so the demo never drifts into the past.
  return prisma.session.upsert({
    where: { id: input.id },
    update: data,
    create: { id: input.id, ...data },
  });
}

/**
 * Never later than `ceiling`.
 *
 * Every stamp below is derived from another one (`paidAt` from `createdAt`,
 * `canceledAt` from a deadline, …) and a demo whose rows are dated in the future
 * reads as broken: the roster prints when a seat was asked for and what came of
 * it. Clamping to the honest ceiling keeps the demo's story inside the time that
 * has actually passed.
 */
function atMost(at: Date, ceiling: Date): Date {
  return at.getTime() > ceiling.getTime() ? ceiling : at;
}

/**
 * When each demo registration was asked for, in order — `createdAt` **is** the
 * queue order (the waitlist), so this array is the demo's story.
 *
 * The crowd is spread evenly through the session's own registration window, and
 * the window's ceiling is "ten minutes ago, at the latest": a row dated after
 * *now* would be a lie that the roster and `/my` both repeat. A window that has
 * not opened yet has no room to spread a queue through, so the requests land in
 * the half hour before this run instead of in the future.
 */
function registrationTimes(session: Session, count: number): Date[] {
  const opens = session.registrationOpensAt.getTime();
  const ceiling = Math.min(session.registrationClosesAt.getTime() - HOUR, Date.now() - 10 * 60 * 1000);
  const from = ceiling > opens ? opens : ceiling - 30 * 60 * 1000;
  const span = ceiling - from;

  return Array.from(
    { length: count },
    (_, index) => new Date(Math.round(count <= 1 ? ceiling : from + (span * (index + 1)) / count)),
  );
}

async function seedRegistrations(session: Session, seeds: RegistrationSeed[], players: Map<PlayerKey, string>) {
  const now = new Date();
  // One minute ago: the boundary no stamp may pass, and the slot `paidAt` falls
  // back to when its own source still lies in the future.
  const recentPast = new Date(now.getTime() - 60 * 1000);
  const times = registrationTimes(session, seeds.length);
  // A cancel can be real only before the session starts (the engine refuses one
  // after `startsAt`), so the clamp is the earlier of that and "just now".
  const cancelCeiling = new Date(Math.min(session.startsAt.getTime() - HOUR, recentPast.getTime()));

  for (const [index, seed] of seeds.entries()) {
    const userId = players.get(seed.player);
    if (!userId) throw new Error(`seed: unknown player key "${seed.player}"`);

    const createdAt = times[index];
    const payment = seed.payment ?? "UNPAID";
    const paid = payment === "PAID_ONLINE" || payment === "PAID_IN_PERSON";
    const attendance = seed.attendance ?? "PENDING";
    const marked = attendance !== "PENDING";

    const data = {
      status: seed.status ?? "CONFIRMED",
      paymentStatus: payment,
      // The seat's own price snapshot (the balance round): every money line and
      // the cancel refund read this column, never the session's live price.
      amountToman: session.priceToman,
      paidFromBalance: 0,
      paidAt: paid ? atMost(new Date(createdAt.getTime() + 5 * 60 * 1000), recentPast) : null,
      attendance,
      lateMinutes: seed.lateMinutes ?? null,
      markedAt: marked ? atMost(new Date(session.endsAt.getTime() + 30 * 60 * 1000), recentPast) : null,
      canceledAt: seed.cancelType ? atMost(new Date(createdAt.getTime() + 2 * DAY), cancelCeiling) : null,
      cancelType: seed.cancelType ?? null,
      // A promoted seat came off the waitlist a few hours before the session —
      // but a demo session may still be a day away, and then the honest stamp is
      // "recently", i.e. the clamp.
      promotedAt: seed.promoted ? atMost(new Date(session.startsAt.getTime() - 6 * HOUR), recentPast) : null,
      createdAt,
    };

    await prisma.registration.upsert({
      where: { sessionId_userId: { sessionId: session.id, userId } },
      update: data,
      create: { sessionId: session.id, userId, ...data },
    });
  }
}

type PenaltySeed = {
  id: string;
  player: PlayerKey;
  type: PenaltyType;
  days: number;
  reason: string;
  startsAt: Date;
  endsAt: Date;
  sessionId?: string;
  issuedByAdminId?: string;
};

async function seedPenalties(seeds: PenaltySeed[], players: Map<PlayerKey, string>) {
  for (const seed of seeds) {
    const userId = players.get(seed.player);
    if (!userId) throw new Error(`seed: unknown player key "${seed.player}"`);

    const data = {
      userId,
      type: seed.type,
      days: seed.days,
      reason: seed.reason,
      startsAt: seed.startsAt,
      endsAt: seed.endsAt,
      sessionId: seed.sessionId ?? null,
      issuedByAdminId: seed.issuedByAdminId ?? null,
    };

    await prisma.penalty.upsert({
      where: { id: seed.id },
      update: data,
      create: { id: seed.id, ...data },
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const now = new Date();

  await seedSettings();
  const admin = await seedAdmin();
  const venues = await seedVenues();
  const players = await seedPlayers();

  const azadi = venues.get("seed_venue_azadi")!;
  const alghadir = venues.get("seed_venue_alghadir")!;

  // 1 — open right now, half full, pay in person.
  const openInPerson = await seedSession({
    id: SESSION_IDS.openInPerson,
    venueId: azadi,
    part: "شب",
    startsAt: slot(2, 21),
    endsAt: slot(2, 22, 30),
    description: "زمین پارکت سرپوشیده. توپ و ژیلت با سالن است؛ ۱۰ دقیقه قبل از شروع حاضر باشید.",
    capacity: 12,
    priceToman: 45_000,
    paymentMode: "IN_PERSON",
    // A session-level Neshan link: it wins over the venue's own link.
    mapUrl: "https://neshan.org/maps/share/35.699779,51.337409",
  });
  await seedRegistrations(
    openInPerson,
    [
      { player: "amirhossein" },
      { player: "sina" },
      { player: "mohammadreza" },
      { player: "mehdi" },
      { player: "alireza" },
      { player: "parsa", payment: "PAID_IN_PERSON" },
      { player: "kian" },
      { player: "behrad" },
      // The manager took this one back out of the hall (an admin-canceled row, as
      // `/admin` would write it); asking again is what the register button is for.
      { player: "ramin", status: "CANCELED", cancelType: "ADMIN" },
    ],
    players,
  );

  // 2 — registration has not opened yet → the home screen shows a countdown.
  await seedSession({
    id: SESSION_IDS.soon,
    venueId: alghadir,
    part: "عصر",
    startsAt: slot(3, 18),
    endsAt: slot(3, 19, 30),
    description: "سانس عصر با ظرفیت ثابت. ثبت‌نام از فردا شب باز می‌شود.",
    capacity: 12,
    priceToman: 40_000,
    paymentMode: "IN_PERSON",
    opensDaysBefore: 2,
  });

  // 3 — capacity full + a waitlist, the promote-on-cancel scenario told honestly:
  //     one confirmed player gave their seat up inside the free window and the
  //     first person in line came off the waitlist **straight into the hall**
  //     (`CONFIRMED`, stamped `promotedAt`) — exactly where the engine puts a
  //     promotion, since the membership gate already vetted the person. Occupancy
  //     is still 12 of 12.
  const full = await seedSession({
    id: SESSION_IDS.full,
    venueId: alghadir,
    part: "شب",
    startsAt: slot(1, 20),
    endsAt: slot(1, 21, 30),
    description: "ظرفیت این سانس تکمیل شده است — ثبت‌نام در لیست انتظار باز است.",
    capacity: 12,
    priceToman: 50_000,
    paymentMode: "IN_PERSON",
  });
  await seedRegistrations(
    full,
    [
      { player: "amirhossein", status: "CANCELED", cancelType: "FREE" },
      { player: "sina" },
      { player: "mohammadreza" },
      { player: "mehdi" },
      { player: "hossein" },
      { player: "alireza" },
      { player: "parsa" },
      { player: "kian" },
      { player: "behrad", payment: "PAID_IN_PERSON" },
      { player: "saman", payment: "PAID_IN_PERSON" },
      { player: "yasin" },
      { player: "abolfazl" },
      { player: "nima", promoted: true },
      { player: "omid", status: "WAITLIST" },
      { player: "ramin", status: "WAITLIST" },
    ],
    players,
  );

  // 4 — past session with the full attendance picture (present / late / absent)
  //     and the payments the admin has not received yet.
  const past = await seedSession({
    id: SESSION_IDS.past,
    venueId: azadi,
    part: "شب",
    startsAt: slot(-10, 21),
    endsAt: slot(-10, 22, 30),
    description: "سانس برگزارشده — حضور و غیاب ثبت شده است.",
    capacity: 12,
    priceToman: 45_000,
    paymentMode: "IN_PERSON",
  });
  await seedRegistrations(
    past,
    [
      { player: "amirhossein", payment: "PAID_IN_PERSON", attendance: "PRESENT" },
      { player: "sina", payment: "PAID_IN_PERSON", attendance: "PRESENT" },
      { player: "mohammadreza", payment: "PAID_IN_PERSON", attendance: "PRESENT" },
      { player: "mehdi", payment: "PAID_IN_PERSON", attendance: "LATE", lateMinutes: 20 },
      { player: "hossein", attendance: "ABSENT" },
      { player: "alireza", payment: "PAID_IN_PERSON", attendance: "PRESENT" },
      { player: "parsa", payment: "WAIVED", attendance: "PRESENT" },
      { player: "kian", payment: "PAID_IN_PERSON", attendance: "PRESENT" },
    ],
    players,
  );

  // 5 — the mock online-gateway session: paid, abandoned, and waived. The window
  //     opens before this run (like every session that carries seeded seats), so
  //     its registrations are dated in the past instead of in the future.
  const online = await seedSession({
    id: SESSION_IDS.online,
    venueId: azadi,
    part: "شب",
    startsAt: slot(4, 21),
    endsAt: slot(4, 22, 30),
    description: "پرداخت هنگام ثبت‌نام انجام می‌شود. انصراف از درگاه، ثبت‌نام را «در انتظار پرداخت» نگه می‌دارد.",
    capacity: 10,
    priceToman: 60_000,
    paymentMode: "AT_REGISTRATION",
    opensDaysBefore: 5,
  });
  await seedRegistrations(
    online,
    [
      { player: "amirhossein", payment: "PAID_ONLINE" },
      { player: "sina", payment: "PAID_ONLINE" },
      { player: "mohammadreza" },
      { player: "parsa", payment: "WAIVED" },
    ],
    players,
  );

  // 6 — canceled by the manager: everyone is released without a penalty.
  const canceled = await seedSession({
    id: SESSION_IDS.canceled,
    venueId: alghadir,
    part: "شب",
    startsAt: slot(5, 20),
    endsAt: slot(5, 21, 30),
    description: "این سانس توسط مدیر لغو شد.",
    capacity: 12,
    priceToman: 45_000,
    paymentMode: "IN_PERSON",
    status: "CANCELED",
  });
  await seedRegistrations(
    canceled,
    [
      { player: "sina", status: "CANCELED", cancelType: "ADMIN" },
      { player: "mehdi", status: "CANCELED", cancelType: "ADMIN" },
      { player: "kian", status: "CANCELED", cancelType: "ADMIN" },
    ],
    players,
  );

  // 7 — draft: invisible to players, visible to the admin.
  await seedSession({
    id: SESSION_IDS.draft,
    venueId: azadi,
    part: "شب",
    startsAt: slot(9, 21),
    endsAt: slot(9, 22, 30),
    description: "پیش‌نویس — هنوز منتشر نشده است.",
    capacity: 12,
    priceToman: 45_000,
    paymentMode: "IN_PERSON",
    status: "DRAFT",
  });

  // 8 — a second open session, so the home tab is not a single row. `opensDaysBefore`
  //     is stretched past the slot's own distance for the same reason as above:
  //     the session must actually be open (its card would otherwise read «به‌زودی»)
  //     and its seats must be dated before this run.
  const openSecond = await seedSession({
    id: SESSION_IDS.openSecond,
    venueId: alghadir,
    part: "شب",
    startsAt: slot(6, 22),
    endsAt: slot(6, 23),
    description: "سانس پایان هفته — ظرفیت بالاتر.",
    capacity: 14,
    priceToman: 50_000,
    paymentMode: "IN_PERSON",
    opensDaysBefore: 7,
  });
  await seedRegistrations(
    openSecond,
    [
      { player: "mohammadreza" },
      { player: "hossein" },
      { player: "yasin" },
      { player: "saman" },
    ],
    players,
  );

  // 9 — an older past session, needed so the history on /profile and
  //     /admin/users is real rather than invented.
  const pastOlder = await seedSession({
    id: SESSION_IDS.pastOlder,
    venueId: azadi,
    part: "شب",
    startsAt: slot(-17, 21),
    endsAt: slot(-17, 22, 30),
    description: "سانس برگزارشده — هفته‌ی گذشته.",
    capacity: 12,
    priceToman: 45_000,
    paymentMode: "IN_PERSON",
  });
  await seedRegistrations(
    pastOlder,
    [
      { player: "amirhossein", payment: "PAID_IN_PERSON", attendance: "PRESENT" },
      { player: "sina", payment: "PAID_IN_PERSON", attendance: "PRESENT" },
      { player: "kian", payment: "PAID_IN_PERSON", attendance: "PRESENT" },
      { player: "mehdi", status: "CANCELED", cancelType: "LATE" },
    ],
    players,
  );

  await seedPenalties(
    [
      // Active manual ban: 3 days, 2 of them still to serve.
      {
        id: "seed_penalty_arash_manual",
        player: "arash",
        type: "MANUAL",
        days: 3,
        reason: "تخریب نرده‌ی سالن و بی‌احترامی به قوانین مجموعه",
        startsAt: new Date(now.getTime() - 1 * DAY),
        endsAt: new Date(now.getTime() + 2 * DAY),
        issuedByAdminId: admin.id,
      },
      // No-show → 7 days, already served (the absent mark in session 4 made it).
      {
        id: "seed_penalty_hossein_noshow",
        player: "hossein",
        type: "NO_SHOW",
        days: 7,
        reason: `غیبت بدون انصراف در ${partOfDay(past.startsAt, "شب")}`,
        startsAt: past.startsAt,
        endsAt: new Date(past.startsAt.getTime() + 7 * DAY),
        sessionId: past.id,
      },
      // Late cancel → first time inside the window, so warning only (days = 0).
      {
        id: "seed_penalty_mehdi_warning",
        player: "mehdi",
        type: "LATE_CANCEL",
        days: 0,
        reason: "انصراف دیرهنگام — اخطار اول (بدون محرومیت)",
        startsAt: new Date(pastOlder.startsAt.getTime() - 2 * DAY),
        endsAt: new Date(pastOlder.startsAt.getTime() - 2 * DAY),
        sessionId: pastOlder.id,
      },
    ],
    players,
  );

  const [
    venueCount,
    userCount,
    phoneCount,
    nameCount,
    sessionCount,
    registrationCount,
    pendingMembers,
    rejectedMembers,
    penaltyCount,
  ] = await Promise.all([
    prisma.venue.count(),
    prisma.user.count(),
    // How many accounts already have a contact number — the rest see the
    // first-run sheet, which is exactly what a demo should be able to show.
    prisma.user.count({ where: { phone: { not: null } } }),
    // Same question for the other half of the sheet (the real-name pair).
    prisma.user.count({ where: { firstName: { not: null } } }),
    prisma.session.count(),
    prisma.registration.count(),
    // The membership queue: how many accounts are waiting for the manager.
    prisma.user.count({ where: { membershipStatus: "PENDING" } }),
    // And how many were turned away — the list `/admin` keeps visible on purpose.
    prisma.user.count({ where: { membershipStatus: "REJECTED" } }),
    prisma.penalty.count(),
  ]);

  console.log("سانس‌یار — سید دمو آماده شد");
  console.log(`  مدیر: مدیر سانس (شناسه‌ی ایتا: ${admin.eitaaId})`);
  console.log(`  مکان‌ها: ${venueCount}`);
  console.log(`  کاربران: ${userCount} (۱ مدیر)`);
  console.log(`  شماره‌ی همراه ثبت‌شده: ${phoneCount} از ${userCount} حساب`);
  console.log(`  نام و نام‌خانوادگی ثبت‌شده: ${nameCount} از ${userCount} حساب`);
  console.log(`  سانس‌ها: ${sessionCount}`);
  console.log(`  ثبت‌نام‌ها: ${registrationCount}`);
  console.log(`  در انتظار تأیید عضویت: ${pendingMembers}`);
  console.log(`  عضویت ردشده: ${rejectedMembers}`);
  console.log(`  جریمه‌ها/محرومیت‌ها: ${penaltyCount}`);
  console.log("  سانس‌های بازِ دمو:");
  for (const session of [openInPerson, full, online, openSecond]) {
    console.log(`    ${session.title} — ظرفیت ${session.capacity} — ${session.priceToman.toLocaleString("en-US")} تومان`);
  }
  // Latin, greppable one-liner: the Persian lines above can lose their encoding
  // in a Windows console, so keep the numbers readable for scripts and CI.
  console.log(
    `seed: venues=${venueCount} users=${userCount} sessions=${sessionCount} registrations=${registrationCount} pendingMembers=${pendingMembers} rejectedMembers=${rejectedMembers} penalties=${penaltyCount} admin=${admin.eitaaId}`,
  );
}

void main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
