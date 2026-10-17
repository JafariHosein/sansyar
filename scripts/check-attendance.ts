/**
 * `npm.cmd run check:attendance` — the attendance engine's proof (§۵.۵ + §۵.۶).
 *
 * The owner's rule, verbatim: a manager marks every seat of a سانس — «حاضر» /
 * «تاخیر (دقیقه)» / «غایب» — and the mark lands immediately in the player's
 * record and in the penalty engine. This script drives the **real** transaction
 * bodies — `markAttendance` and `closeAttendance`
 * (`src/server/attendance-core.ts`), the very functions the server actions call
 * — against a throwaway fixture, so every claim below is the database's answer,
 * never the engine's own word:
 *
 *   1. present and late marks: the row is written with the mark's own clock, a
 *      late below the threshold is recorded but never counts as a strike, one
 *      above it counts — and a re-mark never counts twice;
 *   2. the strike ladder: 3 qualifying lates inside the window write exactly one
 *      `LATE_STRIKES` row (7 days, from the session's own override), the 6th
 *      writes the second, a late on a session that started before the window is
 *      recorded but never counted, and waiving a row does not hand the strike
 *      back;
 *   3. the no-show charge: `ABSENT` writes one `NO_SHOW` row per event, a
 *      re-mark writes nothing, and a session with the rule switched off records
 *      the absence without charging anybody;
 *   4. the guards: a session that has not started, a canceled one, a draft, a
 *      waitlist row, an unknown id, and late minutes outside 1..720;
 *   5. «بستن حضور و غیاب»: the PENDING seats of a started سانس are swept to
 *      ABSENT and charged once, the waitlist row and the already-marked seats are
 *      untouched, and a second close sweeps nothing;
 *   6. the integration: a no-show ban really closes the seat engine
 *      (`registerSeat` answers `BANNED` and writes no row), and a pardon really
 *      reopens it.
 *
 * It is safe to re-run and it **never touches seeded rows**: every row it creates
 * lives under its own reserved ids (`attcheck_*`, `eitaaId` 980000001…) and
 * cleanup refuses to delete anything outside that reservation.
 *
 * Exit code 0 = every assertion held («PASS»), 1 = something broke («FAIL»).
 *
 * Run from the project root (`npm.cmd run check:attendance`), with MySQL/MariaDB up.
 */
import { loadEnvConfig } from "@next/env";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../src/generated/prisma/client";
import { toPersianDigits } from "../src/lib/format";
import { formatJalaliDayMonth } from "../src/lib/jalali";
import {
  ATTENDANCE_INVALID_LATE_MINUTES,
  ATTENDANCE_NOT_CONFIRMED,
  ATTENDANCE_NOT_FOUND,
  ATTENDANCE_NOT_STARTED,
  ATTENDANCE_SESSION_CANCELED,
  ATTENDANCE_SESSION_NOT_FOUND,
  ATTENDANCE_SESSION_NOT_PUBLISHED,
  closeAttendance,
  markAttendance,
  type AttendanceMark,
  type CloseAttendanceEngineOutcome,
  type MarkAttendanceEngineOutcome,
} from "../src/server/attendance-core";
import { registerSeat } from "../src/server/registration-core";

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

/** `980000001` … — seeded players live at `100000000`/`2000000xx`. */
const RESERVED_EITAA_PREFIX = "9800000";
/** Every id this script invents starts with this. Seeded ids start with `seed_`. */
const RESERVED_ID_PREFIX = "attcheck_";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * The fixture's one price (the balance round): every seat written directly by
 * this script carries this snapshot, exactly like the sessions it creates.
 * Attendance is the subject here — money never moves in this harness.
 */
const FIXTURE_PRICE_TOMAN = 70_000;

// ---------------------------------------------------------------------------
// The pinned rules — the whole point of the per-session overrides
// ---------------------------------------------------------------------------

// Every session this script marks on carries its own copies of the rules the
// engine reads, so the numbers below are the session's own and never the
// admin-editable `Setting` row's. (`resolveCancelRules` gives a non-null
// override the last word.)
const LATE_THRESHOLD_MINUTES = 15;
const STRIKE_COUNT = 3;
const STRIKE_WINDOW_DAYS = 30;
const STRIKE_PENALTY_DAYS = 7;
const NO_SHOW_PENALTY_DAYS = 7;

const ATTENDANCE_OVERRIDES = {
  lateThresholdMinutes: LATE_THRESHOLD_MINUTES,
  lateStrikesEnabled: true,
  lateStrikeCount: STRIKE_COUNT,
  lateStrikeWindowDays: STRIKE_WINDOW_DAYS,
  lateStrikePenaltyDays: STRIKE_PENALTY_DAYS,
  noShowEnabled: true,
  noShowPenaltyDays: NO_SHOW_PENALTY_DAYS,
} as const;

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

/** One refusal/answer, printed as the failure's own sentence. */
function describeMark(outcome: MarkAttendanceEngineOutcome): string {
  return outcome.ok
    ? `ok — ${outcome.attendance}${outcome.lateMinutes === null ? "" : ` (${toPersianDigits(outcome.lateMinutes)} دقیقه)`}`
    : `${outcome.code}: ${outcome.error}`;
}

function describeClose(outcome: CloseAttendanceEngineOutcome): string {
  return outcome.ok
    ? `ok — جارو ${toPersianDigits(outcome.closed)}، جریمه ${toPersianDigits(outcome.penalties.length)}`
    : `${outcome.code}: ${outcome.error}`;
}

/**
 * The engine is the last line of defence: it must also survive a payload that
 * never went through the action shell's zod check (the spec's missing minutes,
 * a string, a fraction). The cast is deliberate — this helper *is* the hostile
 * caller.
 */
function hostileMark(value: unknown): AttendanceMark {
  return value as AttendanceMark;
}

// ---------------------------------------------------------------------------
// Fixture — one hall, sixteen reserved سانس‌ها and eight reserved players
// ---------------------------------------------------------------------------

type SessionKey =
  | "alpha"
  | "beta"
  | "gamma"
  | "old"
  | "delta"
  | "epsilon"
  | "zeta"
  | "noshow"
  | "pardon"
  | "close"
  | "future"
  | "canceled"
  | "draft"
  | "integrationMark"
  | "integrationTarget"
  | "empty";

type Fixture = {
  venueId: string;
  /** The manager whose id every penalty carries (`issuedByAdminId`). */
  adminId: string;
  /** Eight player ids: ۱ the late story, ۲ the no-show story, ۳ the integration … */
  players: string[];
  /** Reserved session ids, by story key. */
  sessions: Record<SessionKey, string>;
  /** The same sessions' start, for the reason strings the engine writes. */
  startsAt: Record<SessionKey, Date>;
};

/** A session that has already begun: thirty minutes in, an hour and a half long. */
const STARTED_AGO_MS = 30 * MINUTE_MS;
const SESSION_LENGTH_MS = 90 * MINUTE_MS;

type SessionInput = {
  key: SessionKey;
  title: string;
  status?: "DRAFT" | "PUBLISHED" | "CANCELED";
  startsAt: Date;
  capacity?: number;
  /** The one override a story flips: «غیبت بدون انصراف» switched off. */
  noShowEnabled?: boolean;
};

async function createSession(venueId: string, input: SessionInput): Promise<{ id: string; startsAt: Date }> {
  const session = await client.session.create({
    data: {
      id: `${RESERVED_ID_PREFIX}session_${input.key}`,
      venueId,
      title: input.title,
      startsAt: input.startsAt,
      endsAt: new Date(input.startsAt.getTime() + SESSION_LENGTH_MS),
      registrationOpensAt: new Date(input.startsAt.getTime() - 2 * DAY_MS),
      registrationClosesAt: new Date(input.startsAt.getTime() - MINUTE_MS),
      capacity: input.capacity ?? 10,
      priceToman: FIXTURE_PRICE_TOMAN,
      paymentMode: "IN_PERSON",
      status: input.status ?? "PUBLISHED",
      ...ATTENDANCE_OVERRIDES,
      ...(input.noShowEnabled === undefined ? {} : { noShowEnabled: input.noShowEnabled }),
    },
    select: { id: true },
  });

  return { id: session.id, startsAt: input.startsAt };
}

async function setup(): Promise<Fixture> {
  const now = new Date();

  const venue = await client.venue.create({
    data: {
      id: `${RESERVED_ID_PREFIX}venue`,
      name: "سالن تست حضور و غیاب سانس‌یار",
      address: "تهران، تست — فقط برای اسکریپت check:attendance",
    },
    select: { id: true },
  });

  // The manager whose id lands on every penalty this script writes. The engine
  // takes the id, not the role — the shell's `requireAdmin` is what decides who
  // may call it, and that guard is not this harness's business.
  const admin = await client.user.create({
    data: {
      eitaaId: `${RESERVED_EITAA_PREFIX}99`,
      name: "مدیر تست حضور",
      membershipStatus: "APPROVED",
      role: "ADMIN",
    },
    select: { id: true },
  });

  const players: string[] = [];
  for (let index = 1; index <= 8; index += 1) {
    const user = await client.user.create({
      data: {
        eitaaId: `${RESERVED_EITAA_PREFIX}${String(index).padStart(2, "0")}`,
        name: `بازیکن تست ${toPersianDigits(index)}`,
        // Every fixture player is past the membership gate: this harness is about
        // attendance, and `registerSeat` (wave ۶) must be refused for the ban
        // alone — never for an approval that never happened.
        membershipStatus: "APPROVED",
        role: "USER",
      },
      select: { id: true },
    });
    players.push(user.id);
  }

  const started = (offsetMs = STARTED_AGO_MS) => new Date(now.getTime() - offsetMs);
  const future = new Date(now.getTime() + DAY_MS);

  const specs: SessionInput[] = [
    // The late story's halls — all started, all with the same pinned rules.
    { key: "alpha", title: "سانس تست حضور الف", startsAt: started() },
    { key: "beta", title: "سانس تست تاخیر ب", startsAt: started() },
    { key: "gamma", title: "سانس تست تاخیر پ", startsAt: started() },
    // Started forty days ago: inside everybody's past, outside the 30-day strike
    // window — the one late that must be recorded and never counted.
    { key: "old", title: "سانس تست کهنه", startsAt: started(40 * DAY_MS + STARTED_AGO_MS) },
    { key: "delta", title: "سانس تست تاخیر ت", startsAt: started() },
    { key: "epsilon", title: "سانس تست تاخیر ث", startsAt: started() },
    { key: "zeta", title: "سانس تست تاخیر ج", startsAt: started() },
    // The no-show story: one charging hall and one that switched the rule off.
    { key: "noshow", title: "سانس تست غیبت", startsAt: started() },
    { key: "pardon", title: "سانس تست بدون جریمه‌ی غیبت", startsAt: started(), noShowEnabled: false },
    // The close story: one marked seat, two untouched seats, one queue row.
    { key: "close", title: "سانس تست بستن حضور", startsAt: started() },
    // The guards' own sessions.
    { key: "future", title: "سانس تست شروع‌نشده", startsAt: future },
    { key: "canceled", title: "سانس تست لغوشده", startsAt: started(), status: "CANCELED" },
    { key: "draft", title: "سانس تست پیش‌نویس", startsAt: started(), status: "DRAFT" },
    // The integration: a started hall for the no-show, and an open one that the
    // seat engine must refuse while the ban is on.
    { key: "integrationMark", title: "سانس تست غیبت یکپارچه", startsAt: started() },
    { key: "integrationTarget", title: "سانس تست ثبت‌نام یکپارچه", startsAt: future, capacity: 4 },
    // A started hall nobody ever registered for.
    { key: "empty", title: "سانس تست خالی", startsAt: started() },
  ];

  const sessions = {} as Record<SessionKey, string>;
  const startsAt = {} as Record<SessionKey, Date>;
  for (const spec of specs) {
    const created = await createSession(venue.id, spec);
    sessions[spec.key] = created.id;
    startsAt[spec.key] = created.startsAt;
  }

  console.log(
    `  سانس‌های ساختگی ساخته شد: ${toPersianDigits(specs.length)} سانس، ${toPersianDigits(
      players.length,
    )} بازیکن تست و یک مدیر تست`,
  );

  return { venueId: venue.id, adminId: admin.id, players, sessions, startsAt };
}

/** Player `index` (1-based) — the stories above are told on fixed seats. */
function player(fx: Fixture, index: number): string {
  return fx.players[index - 1];
}

/** One seat, created directly: attendance is the subject, not the seat engine. */
async function seat(
  sessionId: string,
  userId: string,
  status: "CONFIRMED" | "WAITLIST" = "CONFIRMED",
): Promise<string> {
  const row = await client.registration.create({
    data: {
      sessionId,
      userId,
      status,
      attendance: "PENDING",
      // Every seat carries its own price snapshot (the balance round); the
      // fixture's sessions all cost the same, so the constant is the snapshot.
      amountToman: FIXTURE_PRICE_TOMAN,
      paidFromBalance: 0,
    },
    select: { id: true },
  });
  return row.id;
}

// ---------------------------------------------------------------------------
// Reads — the harness always asks the database, never the engine's own answer
// ---------------------------------------------------------------------------

/** One seat row, by id — every stamp a mark writes. */
async function registrationOf(registrationId: string) {
  return client.registration.findUnique({
    where: { id: registrationId },
    select: {
      id: true,
      status: true,
      attendance: true,
      lateMinutes: true,
      markedAt: true,
      userId: true,
      sessionId: true,
    },
  });
}

/** The row of one player in one session, or `null` — the "nothing was written" read. */
async function seatOf(sessionId: string, userId: string) {
  return client.registration.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
    select: { id: true, status: true, attendance: true },
  });
}

/** Every penalty row of the given players, oldest first. */
async function penaltyRows(userIds: string[]) {
  return client.penalty.findMany({
    where: { userId: { in: userIds } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      type: true,
      days: true,
      reason: true,
      startsAt: true,
      endsAt: true,
      sessionId: true,
      issuedByAdminId: true,
      waivedAt: true,
    },
  });
}

// ---------------------------------------------------------------------------
// موج ۱ — present and late, and what a re-mark does
// ---------------------------------------------------------------------------

async function markWave(fx: Fixture): Promise<void> {
  group("موج ۱ — حاضر و تاخیر: یک صندلی، سه جواب، و آستانه‌ی ۱۵ دقیقه");

  const userId = player(fx, 1);
  const registrationId = await seat(fx.sessions.alpha, userId);
  const now = new Date();

  const present = await markAttendance(client, {
    registrationId,
    mark: { status: "PRESENT" },
    adminId: fx.adminId,
    now,
  });
  check(
    "«حاضر» می‌نشیند: attendance=PRESENT، دقیقه‌ی تاخیر خالی و هیچ جریمه‌ای",
    present.ok &&
      present.attendance === "PRESENT" &&
      present.lateMinutes === null &&
      present.lateStrikes === null &&
      present.penalty === null,
    describeMark(present),
  );

  const presentRow = await registrationOf(registrationId);
  check(
    "و در دیتابیس: همان ردیف با مهر همین لحظه",
    presentRow?.attendance === "PRESENT" &&
      presentRow.markedAt?.getTime() === now.getTime() &&
      presentRow.lateMinutes === null,
    `attendance=${presentRow?.attendance ?? "?"} markedAt=${String(presentRow?.markedAt)}`,
  );
  check("«حاضر» هیچ ردیف جریمه‌ای نمی‌نویسد", (await penaltyRows([userId])).length === 0);

  // ۱۰ دقیقه با آستانه‌ی ۱۵: یک تاخیر واقعی که «تاخیر محسوب‌شده» نیست.
  const smallLate = await markAttendance(client, {
    registrationId,
    mark: { status: "LATE", lateMinutes: 10 },
    adminId: fx.adminId,
    now,
  });
  check(
    "تاخیر ۱۰ دقیقه (زیر آستانه): ثبت می‌شود و شمارش تاخیر صفر است",
    smallLate.ok &&
      smallLate.attendance === "LATE" &&
      smallLate.lateMinutes === 10 &&
      smallLate.lateStrikes === 0 &&
      smallLate.penalty === null,
    describeMark(smallLate),
  );
  const smallRow = await registrationOf(registrationId);
  check(
    "دقیقه‌ی تاخیر روی ردیف نوشته شد",
    smallRow?.attendance === "LATE" && smallRow.lateMinutes === 10,
    `lateMinutes=${String(smallRow?.lateMinutes)}`,
  );
  check("و هنوز هیچ جریمه‌ای نیست", (await penaltyRows([userId])).length === 0);

  // ۲۰ دقیقه با آستانه‌ی ۱۵: اولین تاخیرِ محسوب‌شده.
  const bigLate = await markAttendance(client, {
    registrationId,
    mark: { status: "LATE", lateMinutes: 20 },
    adminId: fx.adminId,
    now,
  });
  check(
    "تاخیر ۲۰ دقیقه (بالای آستانه): اولین تاخیر پنجره شمرده شد (۱) و هنوز بدون محرومیت",
    bigLate.ok && bigLate.lateStrikes === 1 && bigLate.penalty === null,
    describeMark(bigLate),
  );

  const reMark = await markAttendance(client, {
    registrationId,
    mark: { status: "LATE", lateMinutes: 20 },
    adminId: fx.adminId,
    now,
  });
  check(
    "ثبت دوباره‌ی همان تاخیر: نه شمارش دوباره (همان ۱)، نه ردیف جریمه‌ی دوم",
    reMark.ok && reMark.lateStrikes === 1 && reMark.penalty === null,
    describeMark(reMark),
  );
  check(
    "و تعداد ردیف‌های جریمه هنوز صفر است",
    (await penaltyRows([userId])).length === 0,
  );
}

// ---------------------------------------------------------------------------
// موج ۲ — the strike ladder
// ---------------------------------------------------------------------------

async function strikeWave(fx: Fixture): Promise<void> {
  group(
    `موج ۲ — نردبان تاخیر: ${toPersianDigits(STRIKE_COUNT)} تاخیر در ${toPersianDigits(
      STRIKE_WINDOW_DAYS,
    )} روز، یک محرومیت ${toPersianDigits(STRIKE_PENALTY_DAYS)} روزه`,
  );

  const userId = player(fx, 1);
  const now = new Date();

  const secondSeat = await seat(fx.sessions.beta, userId);
  const second = await markAttendance(client, {
    registrationId: secondSeat,
    mark: { status: "LATE", lateMinutes: 20 },
    adminId: fx.adminId,
    now,
  });
  check(
    "دومین تاخیر در پنجره: شمرده شد (۲)، هنوز بدون محرومیت",
    second.ok && second.lateStrikes === 2 && second.penalty === null,
    describeMark(second),
  );

  const thirdSeat = await seat(fx.sessions.gamma, userId);
  const third = await markAttendance(client, {
    registrationId: thirdSeat,
    mark: { status: "LATE", lateMinutes: 20 },
    adminId: fx.adminId,
    now,
  });
  check(
    `سومین تاخیر: نردبان پر شد → یک محرومیت ${toPersianDigits(STRIKE_PENALTY_DAYS)} روزه از قوانین پین‌شده‌ی همین سانس`,
    third.ok &&
      third.lateStrikes === 3 &&
      third.penalty?.type === "LATE_STRIKES" &&
      third.penalty.days === STRIKE_PENALTY_DAYS,
    describeMark(third),
  );

  const strikeRows = await penaltyRows([userId]);
  check(
    "دقیقاً یک ردیف LATE_STRIKES با دلیل «تکرار تاخیر — ۳ تاخیر در ۳۰ روز»",
    strikeRows.length === 1 &&
      strikeRows[0].type === "LATE_STRIKES" &&
      strikeRows[0].reason ===
        `تکرار تاخیر — ${toPersianDigits(3)} تاخیر در ${toPersianDigits(STRIKE_WINDOW_DAYS)} روز`,
    strikeRows.map((row) => `${row.type}: ${row.reason}`).join(" | "),
  );
  check(
    "پنجره‌ی محرومیت از همین لحظه تا ۷ روز، روی همان سانس، با مهر مدیر",
    strikeRows.length === 1 &&
      strikeRows[0].startsAt.getTime() === now.getTime() &&
      strikeRows[0].endsAt.getTime() === now.getTime() + STRIKE_PENALTY_DAYS * DAY_MS &&
      strikeRows[0].sessionId === fx.sessions.gamma &&
      strikeRows[0].issuedByAdminId === fx.adminId,
    `starts=${String(strikeRows[0]?.startsAt)} ends=${String(strikeRows[0]?.endsAt)}`,
  );

  const reThird = await markAttendance(client, {
    registrationId: thirdSeat,
    mark: { status: "LATE", lateMinutes: 20 },
    adminId: fx.adminId,
    now,
  });
  check(
    "ثبت دوباره‌ی همان تاخیر سوم: نه ردیف دوم، همان شمارش ۳",
    reThird.ok && reThird.lateStrikes === 3 && reThird.penalty === null && (await penaltyRows([userId])).length === 1,
    describeMark(reThird),
  );

  // سانسی که پیش از پنجره شروع شده: ثبت می‌شود، شمرده نمی‌شود.
  const oldSeat = await seat(fx.sessions.old, userId);
  const ancient = await markAttendance(client, {
    registrationId: oldSeat,
    mark: { status: "LATE", lateMinutes: 20 },
    adminId: fx.adminId,
    now,
  });
  check(
    "تاخیر سانسی که پیش از پنجره شروع شده: ثبت می‌شود ولی در نردبان شمرده نمی‌شود (همان ۳)",
    ancient.ok && ancient.lateStrikes === 3 && ancient.penalty === null,
    describeMark(ancient),
  );
  check(
    "و ردیف کهنه هم تاخیرش را گرفت — بی‌آنکه جریمه‌ی تازه‌ای بنویسد",
    (await registrationOf(oldSeat))?.attendance === "LATE" && (await penaltyRows([userId])).length === 1,
  );

  // بخشش: نردبان عقب نمی‌رود.
  await client.penalty.update({ where: { id: strikeRows[0].id }, data: { waivedAt: now } });
  const afterWaive = await markAttendance(client, {
    registrationId: secondSeat,
    mark: { status: "LATE", lateMinutes: 20 },
    adminId: fx.adminId,
    now,
  });
  check(
    "بخشیدن محرومیت، تاخیر بخشیده‌شده را پس نمی‌گیرد: ثبت دوباره در همان شمارش هیچ ردیف تازه‌ای نمی‌نویسد",
    afterWaive.ok && afterWaive.lateStrikes === 3 && afterWaive.penalty === null && (await penaltyRows([userId])).length === 1,
    describeMark(afterWaive),
  );

  // ششمین تاخیر: کف تقسیم، ردیف دوم.
  const fourthSeat = await seat(fx.sessions.delta, userId);
  const fifthSeat = await seat(fx.sessions.epsilon, userId);
  const sixthSeat = await seat(fx.sessions.zeta, userId);

  const fourth = await markAttendance(client, {
    registrationId: fourthSeat,
    mark: { status: "LATE", lateMinutes: 20 },
    adminId: fx.adminId,
    now,
  });
  const fifth = await markAttendance(client, {
    registrationId: fifthSeat,
    mark: { status: "LATE", lateMinutes: 20 },
    adminId: fx.adminId,
    now,
  });
  check(
    "چهارمین و پنجمین تاخیر: کف تقسیم هنوز ۱ است → هیچ ردیف تازه‌ای",
    fourth.ok && fourth.lateStrikes === 4 && fourth.penalty === null && fifth.ok && fifth.lateStrikes === 5 && fifth.penalty === null,
    `${describeMark(fourth)} | ${describeMark(fifth)}`,
  );

  const sixth = await markAttendance(client, {
    registrationId: sixthSeat,
    mark: { status: "LATE", lateMinutes: 20 },
    adminId: fx.adminId,
    now,
  });
  check(
    "ششمین تاخیر: کف (۶ ÷ ۳) ردیف دوم را می‌نویسد",
    sixth.ok &&
      sixth.lateStrikes === 6 &&
      sixth.penalty?.type === "LATE_STRIKES" &&
      sixth.penalty.days === STRIKE_PENALTY_DAYS,
    describeMark(sixth),
  );
  check(
    "در کل دو ردیف LATE_STRIKES برای این بازیکن — نه یکی، نه سه‌تا",
    (await penaltyRows([userId])).filter((row) => row.type === "LATE_STRIKES").length === 2,
  );
}

// ---------------------------------------------------------------------------
// موج ۳ — the no-show charge
// ---------------------------------------------------------------------------

async function noShowWave(fx: Fixture): Promise<void> {
  group("موج ۳ — غیبت: یک ردیف برای هر رویداد، و سانسی که غیبت در آن خاموش است");

  const userId = player(fx, 2);
  const now = new Date();
  const noShowSeat = await seat(fx.sessions.noshow, userId);

  const absent = await markAttendance(client, {
    registrationId: noShowSeat,
    mark: { status: "ABSENT" },
    adminId: fx.adminId,
    now,
  });
  check(
    `«غایب» → یک محرومیت ${toPersianDigits(NO_SHOW_PENALTY_DAYS)} روزه‌ی NO_SHOW`,
    absent.ok &&
      absent.attendance === "ABSENT" &&
      absent.lateMinutes === null &&
      absent.penalty?.type === "NO_SHOW" &&
      absent.penalty.days === NO_SHOW_PENALTY_DAYS,
    describeMark(absent),
  );

  const rows = await penaltyRows([userId]);
  check(
    "ردیف جریمه: نوع NO_SHOW، دلیل با روز سانس، مهر مدیر و پنجره‌ی ۷ روز",
    rows.length === 1 &&
      rows[0].type === "NO_SHOW" &&
      rows[0].days === NO_SHOW_PENALTY_DAYS &&
      rows[0].reason === `غیبت بدون انصراف در ${formatJalaliDayMonth(fx.startsAt.noshow)}` &&
      rows[0].issuedByAdminId === fx.adminId &&
      rows[0].sessionId === fx.sessions.noshow &&
      rows[0].startsAt.getTime() === now.getTime() &&
      rows[0].endsAt.getTime() === now.getTime() + NO_SHOW_PENALTY_DAYS * DAY_MS,
    rows.map((row) => `${row.type}: ${row.reason}`).join(" | "),
  );

  const again = await markAttendance(client, {
    registrationId: noShowSeat,
    mark: { status: "ABSENT" },
    adminId: fx.adminId,
    now,
  });
  check(
    "ثبت دوباره‌ی همان غیبت: نه ردیف دوم، نه جریمه‌ی تازه",
    again.ok && again.penalty === null && (await penaltyRows([userId])).length === 1,
    describeMark(again),
  );

  const noShowRow = await registrationOf(noShowSeat);
  check(
    "غیبت روی خود صندلی نشسته: ABSENT با مهر همین لحظه",
    noShowRow?.attendance === "ABSENT" && noShowRow.markedAt?.getTime() === now.getTime(),
    `attendance=${noShowRow?.attendance ?? "?"}`,
  );

  const pardonSeat = await seat(fx.sessions.pardon, userId);
  const pardoned = await markAttendance(client, {
    registrationId: pardonSeat,
    mark: { status: "ABSENT" },
    adminId: fx.adminId,
    now,
  });
  check(
    "سانسی که «غیبت بدون انصراف» در آن خاموش است: غیبت ثبت می‌شود، هیچ جریمه‌ای نوشته نمی‌شود",
    pardoned.ok && pardoned.attendance === "ABSENT" && pardoned.penalty === null,
    describeMark(pardoned),
  );
  check(
    "و برای همان سانس صفر ردیف NO_SHOW ساخته شد",
    (await penaltyRows([userId])).filter((row) => row.sessionId === fx.sessions.pardon).length === 0,
  );
}

// ---------------------------------------------------------------------------
// موج ۴ — the guards
// ---------------------------------------------------------------------------

async function guardWave(fx: Fixture): Promise<void> {
  group("موج ۴ — نگهبان‌ها: شروع‌نشده، لغوشده، پیش‌نویس، ردیف انتظار و ورودی خراب");

  const now = new Date();
  const guardUserId = player(fx, 8);

  const futureSeat = await seat(fx.sessions.future, guardUserId);
  const future = await markAttendance(client, {
    registrationId: futureSeat,
    mark: { status: "PRESENT" },
    adminId: fx.adminId,
    now,
  });
  check(
    "ثبت حضور برای سانسِ شروع‌نشده → NOT_STARTED با جمله‌ی «هنوز شروع نشده»",
    !future.ok && future.code === "NOT_STARTED" && future.error === ATTENDANCE_NOT_STARTED,
    describeMark(future),
  );
  const futureRow = await registrationOf(futureSeat);
  check(
    "و ردیف دست‌نخورده ماند (بدون مهر، بدون وضعیت)",
    futureRow?.attendance === "PENDING" && futureRow.markedAt === null,
    `attendance=${futureRow?.attendance ?? "?"}`,
  );

  const canceledSeat = await seat(fx.sessions.canceled, guardUserId);
  const canceled = await markAttendance(client, {
    registrationId: canceledSeat,
    mark: { status: "ABSENT" },
    adminId: fx.adminId,
    now,
  });
  check(
    "سانسِ لغوشده → SESSION_CANCELED با جمله‌ی «حضور و غیاب نداره»",
    !canceled.ok && canceled.code === "SESSION_CANCELED" && canceled.error === ATTENDANCE_SESSION_CANCELED,
    describeMark(canceled),
  );

  const draftSeat = await seat(fx.sessions.draft, guardUserId);
  const draft = await markAttendance(client, {
    registrationId: draftSeat,
    mark: { status: "PRESENT" },
    adminId: fx.adminId,
    now,
  });
  check(
    "سانسِ پیش‌نویس → SESSION_NOT_PUBLISHED با جمله‌ی «اول منتشرش کن»",
    !draft.ok && draft.code === "SESSION_NOT_PUBLISHED" && draft.error === ATTENDANCE_SESSION_NOT_PUBLISHED,
    describeMark(draft),
  );

  const waitlistSeat = await seat(fx.sessions.alpha, player(fx, 7), "WAITLIST");
  const waitlist = await markAttendance(client, {
    registrationId: waitlistSeat,
    mark: { status: "PRESENT" },
    adminId: fx.adminId,
    now,
  });
  check(
    "ردیف لیست انتظار → NOT_CONFIRMED با جمله‌ی «حضور و غیاب فقط برای ثبت‌نام‌شده‌های سالنه»",
    !waitlist.ok && waitlist.code === "NOT_CONFIRMED" && waitlist.error === ATTENDANCE_NOT_CONFIRMED,
    describeMark(waitlist),
  );

  const missing = await markAttendance(client, {
    registrationId: `${RESERVED_ID_PREFIX}missing_registration`,
    mark: { status: "PRESENT" },
    adminId: fx.adminId,
    now,
  });
  check(
    "شناسه‌ی ناشناس → NOT_FOUND با جمله‌ی «این ثبت‌نام پیدا نشد»",
    !missing.ok && missing.code === "NOT_FOUND" && missing.error === ATTENDANCE_NOT_FOUND,
    describeMark(missing),
  );

  // ورودی خراب: دقیقه بیرون از ۱ تا ۷۲۰، کسری، و حتی بدون دقیقه (پیلود دستی).
  const invalidSeat = await seat(fx.sessions.alpha, guardUserId);
  const invalidCases: Array<[string, unknown]> = [
    ["صفر", { status: "LATE", lateMinutes: 0 }],
    ["۷۲۱", { status: "LATE", lateMinutes: 721 }],
    ["کسری ۱٫۵", { status: "LATE", lateMinutes: 1.5 }],
    ["بدون دقیقه", { status: "LATE" }],
  ];
  const invalidOutcomes: MarkAttendanceEngineOutcome[] = [];
  for (const [, payload] of invalidCases) {
    invalidOutcomes.push(
      await markAttendance(client, {
        registrationId: invalidSeat,
        mark: hostileMark(payload),
        adminId: fx.adminId,
        now,
      }),
    );
  }
  check(
    "دقیقه‌ی تاخیر بیرون از ۱ تا ۷۲۰ (شامل کسری و پیلود بدون دقیقه) → INVALID با همان جمله",
    invalidOutcomes.every(
      (outcome) => !outcome.ok && outcome.code === "INVALID" && outcome.error === ATTENDANCE_INVALID_LATE_MINUTES,
    ),
    invalidOutcomes.map(describeMark).join(" | "),
  );
  const invalidRow = await registrationOf(invalidSeat);
  check(
    "و هیچ‌کدام از آن‌ها ردیف را دست نزد",
    invalidRow?.attendance === "PENDING" && invalidRow.markedAt === null && invalidRow.lateMinutes === null,
    `attendance=${invalidRow?.attendance ?? "?"}`,
  );

  // نگهبان‌های «بستن» هم از همان جنس‌اند.
  const closeMissing = await closeAttendance(client, {
    sessionId: `${RESERVED_ID_PREFIX}missing_session`,
    adminId: fx.adminId,
    now,
  });
  check(
    "بستن سانس ناشناس → NOT_FOUND با جمله‌ی «این سانس پیدا نشد»",
    !closeMissing.ok && closeMissing.code === "NOT_FOUND" && closeMissing.error === ATTENDANCE_SESSION_NOT_FOUND,
    describeClose(closeMissing),
  );

  const closeFuture = await closeAttendance(client, { sessionId: fx.sessions.future, adminId: fx.adminId, now });
  check(
    "بستن سانسِ شروع‌نشده → NOT_STARTED",
    !closeFuture.ok && closeFuture.code === "NOT_STARTED" && closeFuture.error === ATTENDANCE_NOT_STARTED,
    describeClose(closeFuture),
  );

  const closeDraft = await closeAttendance(client, { sessionId: fx.sessions.draft, adminId: fx.adminId, now });
  check(
    "بستن پیش‌نویس → SESSION_NOT_PUBLISHED",
    !closeDraft.ok && closeDraft.code === "SESSION_NOT_PUBLISHED" && closeDraft.error === ATTENDANCE_SESSION_NOT_PUBLISHED,
    describeClose(closeDraft),
  );

  const closeCanceled = await closeAttendance(client, { sessionId: fx.sessions.canceled, adminId: fx.adminId, now });
  check(
    "بستن سانسِ لغوشده → SESSION_CANCELED",
    !closeCanceled.ok && closeCanceled.code === "SESSION_CANCELED" && closeCanceled.error === ATTENDANCE_SESSION_CANCELED,
    describeClose(closeCanceled),
  );
}

// ---------------------------------------------------------------------------
// موج ۵ — «بستن حضور و غیاب»
// ---------------------------------------------------------------------------

async function closeWave(fx: Fixture): Promise<void> {
  group("موج ۵ — بستن حضور و غیاب: باقی‌مانده‌ها غایب می‌شوند، لیست انتظار دست‌نخورده می‌ماند");

  const now = new Date();
  const presentUser = player(fx, 4);
  const firstSwept = player(fx, 5);
  const secondSwept = player(fx, 6);
  const waitingUser = player(fx, 7);

  const presentSeat = await seat(fx.sessions.close, presentUser);
  await seat(fx.sessions.close, firstSwept);
  await seat(fx.sessions.close, secondSwept);
  const waitlistSeat = await seat(fx.sessions.close, waitingUser, "WAITLIST");

  const presentMark = await markAttendance(client, {
    registrationId: presentSeat,
    mark: { status: "PRESENT" },
    adminId: fx.adminId,
    now,
  });
  check(
    "مدیر یک نفر را حاضر زد — بستن فقط باقی‌مانده‌ها را می‌گیرد",
    presentMark.ok && presentMark.attendance === "PRESENT",
    describeMark(presentMark),
  );

  const first = await closeAttendance(client, { sessionId: fx.sessions.close, adminId: fx.adminId, now });
  check(
    "بستن → دو صندلی PENDING غایب شدند و همان دو نفر جریمه گرفتند",
    first.ok && first.closed === 2 && first.penalties.length === 2,
    describeClose(first),
  );
  check(
    "جریمه‌شده‌ها دقیقاً همان دو نفرند — نه صندلی حاضر، نه ردیف انتظار",
    first.ok &&
      [...first.penalties.map((row) => row.userId)].sort().join(",") ===
        [firstSwept, secondSwept].sort().join(","),
    first.ok ? first.penalties.map((row) => `${row.name} (${row.eitaaId})`).join(" | ") : describeClose(first),
  );
  check(
    "هر دو جریمه ۷ روزه‌اند، با مهر مدیر و نام بازیکن برای پیام",
    first.ok &&
      first.penalties.every(
        (row) =>
          row.days === NO_SHOW_PENALTY_DAYS &&
          row.until.getTime() === now.getTime() + NO_SHOW_PENALTY_DAYS * DAY_MS &&
          row.name.length > 0,
      ),
    first.ok ? first.penalties.map((row) => `days=${row.days}`).join(" | ") : describeClose(first),
  );

  const closeRows = await client.registration.findMany({
    where: { sessionId: fx.sessions.close },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, userId: true, status: true, attendance: true, markedAt: true },
  });
  check(
    "در دیتابیس: دو ردیف ABSENT با مهر همین لحظه",
    closeRows.filter((row) => row.attendance === "ABSENT" && row.markedAt?.getTime() === now.getTime()).length === 2,
    closeRows.map((row) => `${row.attendance}@${String(row.markedAt)}`).join(" | "),
  );
  check(
    "ردیف حاضر دست‌نخورده ماند",
    closeRows.find((row) => row.userId === presentUser)?.attendance === "PRESENT",
  );
  check(
    "ردیف لیست انتظار دست‌نخورده ماند: همچنان WAITLIST، بدون حضور و بدون مهر",
    closeRows.find((row) => row.id === waitlistSeat)?.status === "WAITLIST" &&
      closeRows.find((row) => row.id === waitlistSeat)?.attendance === "PENDING" &&
      closeRows.find((row) => row.id === waitlistSeat)?.markedAt === null,
  );

  const sweepPenalties = (await penaltyRows([presentUser, firstSwept, secondSwept, waitingUser])).filter(
    (row) => row.sessionId === fx.sessions.close,
  );
  check(
    "دقیقاً دو ردیف NO_SHOW برای این سانس — نه برای حاضر، نه برای ردیف انتظار",
    sweepPenalties.length === 2 && sweepPenalties.every((row) => row.type === "NO_SHOW" && row.days === NO_SHOW_PENALTY_DAYS),
    `ردیف‌ها: ${toPersianDigits(sweepPenalties.length)}`,
  );

  const second = await closeAttendance(client, { sessionId: fx.sessions.close, adminId: fx.adminId, now });
  const afterSecond = (await penaltyRows([presentUser, firstSwept, secondSwept, waitingUser])).filter(
    (row) => row.sessionId === fx.sessions.close,
  );
  check(
    "بستن دوباره: صفر ردیف جارو می‌شود، هیچ جریمه‌ی تازه‌ای نوشته نمی‌شود",
    second.ok && second.closed === 0 && second.penalties.length === 0 && afterSecond.length === 2,
    describeClose(second),
  );

  const emptyClose = await closeAttendance(client, { sessionId: fx.sessions.empty, adminId: fx.adminId, now });
  check(
    "سانس بی‌صندلی: بستن صفر می‌شمارد و به کسی دست نمی‌زند",
    emptyClose.ok && emptyClose.closed === 0 && emptyClose.penalties.length === 0,
    describeClose(emptyClose),
  );
}

// ---------------------------------------------------------------------------
// موج ۶ — integration with the seat engine
// ---------------------------------------------------------------------------

async function integrationWave(fx: Fixture): Promise<void> {
  group("موج ۶ — یکپارچگی: محرومیتِ غیبت جلوی ثبت‌نام را می‌گیرد و بخشیدنش بازش می‌کند");

  const userId = player(fx, 3);
  const now = new Date();

  const markSeat = await seat(fx.sessions.integrationMark, userId);
  const absent = await markAttendance(client, {
    registrationId: markSeat,
    mark: { status: "ABSENT" },
    adminId: fx.adminId,
    now,
  });
  // The ban the mark wrote — read from the answer once, so the two assertions
  // below compare against the same fact.
  const noShowPenalty = absent.ok ? absent.penalty : null;
  check(
    "غیبت ثبت شد و محرومیتش نوشته شد",
    noShowPenalty?.type === "NO_SHOW" && noShowPenalty.days === NO_SHOW_PENALTY_DAYS,
    describeMark(absent),
  );

  const refused = await registerSeat(client, { sessionId: fx.sessions.integrationTarget, userId, now });
  check(
    "ثبت‌نام در سانس دیگر → BANNED، با همان تاریخ پایانِ محرومیت غیبت",
    !refused.ok &&
      refused.code === "BANNED" &&
      noShowPenalty !== null &&
      refused.bannedUntil === noShowPenalty.until.toISOString(),
    refused.ok ? `ok برگشت (${refused.status})` : `${refused.code}: ${refused.error}`,
  );
  check(
    "و برای او در آن سانس هیچ ردیفی نوشته نشد",
    (await seatOf(fx.sessions.integrationTarget, userId)) === null,
  );

  const bans = (await penaltyRows([userId])).filter((row) => row.type === "NO_SHOW");
  await client.penalty.update({ where: { id: bans[0].id }, data: { waivedAt: now } });

  const allowed = await registerSeat(client, { sessionId: fx.sessions.integrationTarget, userId, now });
  check(
    "بعد از بخشش: ثبت‌نام همان بازیکن → CONFIRMED",
    allowed.ok && allowed.status === "CONFIRMED",
    allowed.ok ? `status=${allowed.status}` : `${allowed.code}: ${allowed.error}`,
  );
}

// ---------------------------------------------------------------------------
// بررسی نهایی — the invariants that hold whatever the waves did
// ---------------------------------------------------------------------------

async function invariants(fx: Fixture): Promise<void> {
  group("بررسی نهایی — قاعده‌های مشترکِ همه‌ی موج‌ها");

  const rows = await penaltyRows(fx.players);
  const attendanceRows = rows.filter((row) => row.type === "NO_SHOW" || row.type === "LATE_STRIKES");

  check(
    "هر جریمه‌ی حضوری به یک سانس و به مهر همین مدیر گره خورده است",
    attendanceRows.length > 0 &&
      attendanceRows.every((row) => row.sessionId !== null && row.issuedByAdminId === fx.adminId),
    `ردیف‌ها: ${toPersianDigits(attendanceRows.length)}`,
  );
  check(
    "و هیچ‌کدام پنجره‌ی منفی یا روز صفر ندارند (غیبت و تکرار تاخیر همیشه محرومیت‌اند)",
    attendanceRows.every((row) => row.days > 0 && row.endsAt.getTime() === row.startsAt.getTime() + row.days * DAY_MS),
    attendanceRows.map((row) => `days=${row.days}`).join(", "),
  );
  check(
    "در کل اجرا دقیقاً ۲ ردیف LATE_STRIKES و ۴ ردیف NO_SHOW نوشته شد",
    attendanceRows.filter((row) => row.type === "LATE_STRIKES").length === 2 &&
      attendanceRows.filter((row) => row.type === "NO_SHOW").length === 4,
    attendanceRows.map((row) => row.type).join(", "),
  );

  const waitlistRows = await client.registration.findMany({
    where: { sessionId: { in: Object.values(fx.sessions) }, status: "WAITLIST" },
    select: { attendance: true, markedAt: true, lateMinutes: true },
  });
  check(
    "هیچ ردیف لیست انتظاری در این اجرا حضور و غیاب نگرفت",
    waitlistRows.length === 2 &&
      waitlistRows.every((row) => row.attendance === "PENDING" && row.markedAt === null && row.lateMinutes === null),
    `ردیف‌ها: ${toPersianDigits(waitlistRows.length)}`,
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
    client.registration.count({ where: { user: { is: { eitaaId: eitaa } } } }),
    client.penalty.count({ where: { user: { is: { eitaaId: eitaa } } } }),
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
  console.log("check:attendance — حضور، غیبت، نردبان تاخیر و بستن حضور و غیاب");
  console.log(`دیتابیس: ${describeDatabase(databaseUrl)}`);

  await cleanup();

  const fixture = await setup();
  try {
    await markWave(fixture);
    await strikeWave(fixture);
    await noShowWave(fixture);
    await guardWave(fixture);
    await closeWave(fixture);
    await integrationWave(fixture);
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


