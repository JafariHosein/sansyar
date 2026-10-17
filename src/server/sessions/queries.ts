/**
 * Read side of the session domain: the home list («سانس‌های باز»), the session
 * page (`/sessions/[id]`), «ثبت‌نام‌های من» (`/my`) and the manager's **membership
 * queue**.
 *
 * Three rules hold for everything below:
 *
 *  - **No stored counters.** `Session` carries no `occupiedCount` column; the
 *    number of taken seats is always the number of `CONFIRMED` rows, read with a
 *    single `groupBy` per screen — never one query per card.
 *  - **One clock per call.** `stage` is derived through the shared
 *    `sessionStage()` from a single `new Date()` at the top, so a list can never
 *    mix two notions of "now" — or two notions of «در حال ثبت‌نام» vs «ظرفیت پر».
 *  - **No `getCurrentUser()` here.** The page resolves the viewer inside its own
 *    Suspense boundary and passes the id in, so a query never reads cookies on
 *    its own (Cache Components: request state must stay where the page put it).
 *  - **The cancel verdict is resolved where it is rendered.** `cancelVerdictNow`
 *    answers "what does cancelling cost *right now*" (§۵.۴) from the rules of the
 *    row's own session plus the player's late cancels inside the warning window;
 *    a **waitlisted** row takes the other branch — `waitlistCancelVerdict()`,
 *    free wherever the clock is, exactly what the engine returns. `/my` and the
 *    session page fill `myRegistration.cancel` with it; the home board leaves it
 *    `undefined` and pays for no query it never renders.
 *  - **The money columns travel with a seat.** `MY_REGISTRATION_SELECT` carries
 *    `amountToman`/`paidFromBalance`, because every money line a player reads is
 *    built from the seat's own snapshot (`src/lib/balance.ts`). The roster rows
 *    deliberately do **not** carry them — another player's balance split is
 *    nobody's business — so the viewer's own seat is fetched separately on the
 *    session page.
 *
 * All of them run outside any transaction: they are plain read-only functions and
 * the pages call them after `await connection()`.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import { isAdminEitaaId } from "@/lib/env";
import { clampPage, pageRange } from "@/lib/pagination";
import {
  canCancelNow,
  cancelRuleSentences,
  cancelRulesText,
  cancelVerdictNow,
  DEFAULT_CANCEL_RULES,
  fullNameOf,
  NO_CANCEL_OVERRIDES,
  resolveCancelRules,
  sessionStage,
  waitlistCancelVerdict,
  type AttendanceStatus,
  type CancelRules,
  type CancelVerdict,
  type MembershipRequest,
  type MyRegistration,
  type PaymentMode,
  type PaymentStatus,
  type Registrant,
  type RegistrationStatus,
  type SessionCard,
  type SessionDetail,
  type SessionStatus,
} from "@/lib/sessions";
import { getActiveBan } from "@/server/penalties";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back the home screen looks. The owner's rule: a player sees **two
 * weeks** of finished سانس‌ها at most — the full archive lives in the manager's
 * panel (`/admin/sessions`), which pages. Keeping the bound in the query means
 * the board never even loads the old rows, not just never renders them.
 */
const HOME_LOOKBACK_DAYS = 14;

/**
 * The admin-editable rules of the single `Setting` row, with the factory defaults
 * as a safety net for a missing row. A session page resolves the same row against
 * that session's overrides; `/profile` shows these as «خلاصهی قوانین».
 */
export async function getDefaultCancelRules(): Promise<CancelRules> {
  const setting = await prisma.setting.findUnique({ where: { id: 1 } });
  return resolveCancelRules(setting ?? DEFAULT_CANCEL_RULES, NO_CANCEL_OVERRIDES);
}

// ---------------------------------------------------------------------------
// Shapes — structural on purpose
// ---------------------------------------------------------------------------

/**
 * The session columns a card is built from, plus the venue part of its address.
 *
 * Declared structurally rather than as a Prisma payload type: a query that
 * forgets a column then fails the `toCard()` call below instead of shipping a
 * card with `undefined` in it.
 */
type SessionCore = {
  id: string;
  title: string;
  addressOverride: string | null;
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  capacity: number;
  priceToman: number;
  paymentMode: PaymentMode;
  status: SessionStatus;
  venue: { name: string; address: string };
};

/** The columns that describe one seat (the viewer's own, or a registrant's). */
type RegistrationState = {
  status: RegistrationStatus;
  paymentStatus: PaymentStatus;
  attendance: AttendanceStatus;
  /**
   * The minutes a `LATE` mark recorded (§۵.۵); `null` on every other state. It
   * travels with the seat because both readers need the number, not just the
   * word: the ledger writes «تاخیر ۱۰ دقیقه» and the manager's control
   * pre-fills the minute field from it.
   */
  lateMinutes: number | null;
  /**
   * When the seat came off the waitlist (§۵.۲); `null` for a fresh one. Carried as
   * the raw column and mapped to the boolean the screens read, because the
   * display rule is "was *this* seat promoted", not "when".
   */
  promotedAt: Date | null;
};

/**
 * The money columns of one seat, selected only where a money line is rendered
 * (the viewer's own seat and the manager's side) — never on a player's roster
 * rows, where another player's split would ride along.
 */
type SeatMoneyState = {
  /** The price snapshot taken when the seat was registered. */
  amountToman: number;
  /** How much of it came off the account's balance. */
  paidFromBalance: number;
};

/** A row of the session page's player list: their seat plus the name to show. */
type RegistrantRow = RegistrationState & {
  userId: string;
  /**
   * `phone` is selected for the manager only — see `REGISTRANT_SELECT_ADMIN`.
   * The real name pair travels with every roster row: the manager needs it, and
   * it is the player's own stated name, not a contact detail.
   */
  user: {
    name: string;
    firstName: string | null;
    lastName: string | null;
    phone?: string | null;
  };
};

/**
 * A roster row as it leaves this module: the shared `Registrant` shape plus the
 * contact number — **present only in the manager's payload** (`getSessionDetail`).
 * `src/lib/sessions.ts` owns `Registrant` and deliberately knows nothing about
 * numbers, so a screen handed a plain `Registrant[]` cannot render one even by
 * accident.
 */
type RosterRegistrant = Registrant & { phone?: string | null };

/** How many seats one session holds, split by what each row is doing there. */
type RegistrationCounts = { confirmed: number; waitlist: number };

/** Shared fallback for sessions nobody has registered for yet — never mutated. */
const NO_COUNTS: RegistrationCounts = { confirmed: 0, waitlist: 0 };

// ---------------------------------------------------------------------------
// Selects — the same columns on every screen, so the numbers agree
// ---------------------------------------------------------------------------

/** Venue columns a card shows; the session page also needs the map link. */
const VENUE_SUMMARY = { name: true, address: true } as const satisfies Prisma.VenueSelect;
const VENUE_DETAIL = {
  name: true,
  address: true,
  mapUrl: true,
} as const satisfies Prisma.VenueSelect;

/**
 * Everything a `SessionCard` needs. `/`, `/my` and the session page all select
 * these exact columns, so one slot can never read differently on two screens.
 */
const SESSION_CARD_SELECT = {
  id: true,
  title: true,
  addressOverride: true,
  startsAt: true,
  endsAt: true,
  registrationOpensAt: true,
  registrationClosesAt: true,
  capacity: true,
  priceToman: true,
  paymentMode: true,
  status: true,
  venue: { select: VENUE_SUMMARY },
} as const satisfies Prisma.SessionSelect;

/** The viewer's own seat inside a session (used by the home list). */
const MY_REGISTRATION_SELECT = {
  status: true,
  paymentStatus: true,
  amountToman: true,
  paidFromBalance: true,
  attendance: true,
  lateMinutes: true,
  promotedAt: true,
} as const satisfies Prisma.RegistrationSelect;

/**
 * The roster columns: the seat, the display name and the **real** name pair. The
 * manager's roster adds the player's contact number (`REGISTRANT_SELECT_ADMIN`) —
 * a **separate select** on purpose, so a player's payload never even contains the
 * column and the guard is the query itself, not a component's `if`.
 */
const REGISTRANT_SELECT = {
  userId: true,
  status: true,
  paymentStatus: true,
  attendance: true,
  lateMinutes: true,
  promotedAt: true,
  user: { select: { name: true, firstName: true, lastName: true } },
} as const satisfies Prisma.RegistrationSelect;

/** The same roster, with the number that only the manager may read. */
const REGISTRANT_SELECT_ADMIN = {
  userId: true,
  status: true,
  paymentStatus: true,
  attendance: true,
  lateMinutes: true,
  promotedAt: true,
  user: { select: { name: true, firstName: true, lastName: true, phone: true } },
} as const satisfies Prisma.RegistrationSelect;

/** The twelve nullable override columns of a session — the `CancelRules` keys. */
const CANCEL_OVERRIDE_SELECT = {
  freeCancelHours: true,
  lateCancelEnabled: true,
  lateCancelPenaltyDays: true,
  lateCancelFirstWarning: true,
  lateCancelWarningWindowDays: true,
  noShowEnabled: true,
  noShowPenaltyDays: true,
  lateStrikesEnabled: true,
  lateThresholdMinutes: true,
  lateStrikeCount: true,
  lateStrikeWindowDays: true,
  lateStrikePenaltyDays: true,
} as const satisfies Prisma.SessionSelect;

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/**
 * The one card mapper, shared by all three screens, so «۸ از ۱۲ نفر» can never
 * be computed twice in two different ways.
 */
function toCard(
  session: SessionCore,
  counts: RegistrationCounts,
  myRegistration: MyRegistration | null,
  now: Date,
): SessionCard {
  return {
    id: session.id,
    title: session.title,
    venueName: session.venue.name,
    // The override wins because it is the part the player must actually read
    // («درب شماره‌ی ۳»); resolving it here means no screen has to remember to.
    address: session.addressOverride ?? session.venue.address,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    registrationOpensAt: session.registrationOpensAt,
    registrationClosesAt: session.registrationClosesAt,
    capacity: session.capacity,
    priceToman: session.priceToman,
    paymentMode: session.paymentMode,
    status: session.status,
    // Occupied = the seats people hold. A waitlisted row is not in the hall, so
    // it is not counted here — only in `waitlistCount`, its own line.
    occupiedCount: counts.confirmed,
    waitlistCount: counts.waitlist,
    stage: sessionStage(
      {
        status: session.status,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        registrationOpensAt: session.registrationOpensAt,
        registrationClosesAt: session.registrationClosesAt,
        capacity: session.capacity,
        occupiedCount: counts.confirmed,
      },
      now,
    ),
    myRegistration,
  };
}

/**
 * A registration row → the shape a card carries for the viewer.
 *
 * `waitlistPosition` stays `null` here on purpose: the exact place in the queue
 * is only known where the whole queue is loaded — the session page, whose
 * registrants get their 1-based index. Guessing it from one row would be wrong
 * the moment two people share a timestamp.
 *
 * `cancel` is passed in by the screens that render the «لغو ثبت‌نام» control:
 * `undefined` on the home board (no verdict, no query), a real verdict — or an
 * explicit `null` when this seat may not be canceled right now — elsewhere.
 */
function toMyRegistration(
  row: (RegistrationState & SeatMoneyState) | null | undefined,
  cancel: CancelVerdict | null | undefined = undefined,
): MyRegistration | null {
  if (!row) return null;

  return {
    status: row.status,
    paymentStatus: row.paymentStatus,
    amountToman: row.amountToman,
    paidFromBalance: row.paidFromBalance,
    attendance: row.attendance,
    lateMinutes: row.lateMinutes,
    // See above: the queue order lives on the session page.
    waitlistPosition: null,
    // §۵.۲: the row knows whether *this* seat was promoted; the screens decide
    // what to say about it (a chip on `/my`, «جات از لیست انتظار دراومد» on the
    // session page).
    promoted: row.promotedAt !== null,
    cancel,
  };
}

/**
 * `CONFIRMED` / `WAITLIST` counts for a whole screen in **one** query. The
 * `sessionId` list comes from the rows the screen already loaded, so a card and
 * its count can never be about two different sessions. `CANCELED` rows are not
 * counted at all: they hold nothing.
 */
async function countBySession(ids: string[]): Promise<Map<string, RegistrationCounts>> {
  const counts = new Map<string, RegistrationCounts>();
  if (ids.length === 0) return counts;

  const rows = await prisma.registration.groupBy({
    by: ["sessionId", "status"],
    where: {
      sessionId: { in: ids },
      status: { in: ["CONFIRMED", "WAITLIST"] },
    },
    _count: { _all: true },
  });

  for (const row of rows) {
    const entry = counts.get(row.sessionId) ?? { confirmed: 0, waitlist: 0 };
    if (row.status === "CONFIRMED") entry.confirmed = row._count._all;
    if (row.status === "WAITLIST") entry.waitlist = row._count._all;
    counts.set(row.sessionId, entry);
  }

  return counts;
}

/**
 * The player's late-cancel *event* timestamps.
 *
 * One read serves a whole screen: `/my` resolves a **different** warning window
 * per row (a session may override `lateCancelWarningWindowDays`), so the events
 * are fetched once and every row counts them against its own window. Waived rows
 * are events too and are deliberately not filtered out — §۵.۴ forgives the first
 * late cancel, and a manager lifting a ban later must not hand that forgiveness
 * back.
 */
async function listLateCancelEvents(userId: string): Promise<number[]> {
  const rows = await prisma.penalty.findMany({
    where: { userId, type: "LATE_CANCEL" },
    select: { createdAt: true },
  });

  return rows.map((row) => row.createdAt.getTime());
}

/** How many events above fall inside `windowDays` before `now`. */
function countLateCancelsInWindow(eventTimes: number[], windowDays: number, now: Date): number {
  const from = now.getTime() - windowDays * DAY_MS;
  return eventTimes.filter((createdAt) => createdAt >= from).length;
}

/**
 * The player list split into its two groups — held seats and the queue — each
 * keeping the order the query returned (`createdAt asc, id asc`), which is what
 * makes the queue fair: the first row pushed to the waitlist is position ۱.
 *
 * `withPhone` is true only for the manager's payload: a player's rows then carry
 * no phone at all (see `getSessionDetail`).
 */
function splitRegistrants(
  rows: RegistrantRow[],
  viewerId: string | null,
  withPhone: boolean,
): {
  confirmed: RosterRegistrant[];
  waitlist: RosterRegistrant[];
} {
  const confirmed: RosterRegistrant[] = [];
  const waitlist: RosterRegistrant[] = [];

  for (const row of rows) {
    const registrant = toRegistrant(row, viewerId, withPhone, waitlist.length);

    if (row.status === "WAITLIST") waitlist.push(registrant);
    else confirmed.push(registrant);
  }

  return { confirmed, waitlist };
}

/**
 * One registration row → the shape the screens read, plus the manager-only extra
 * (`phone`) — **added only when the query selected it**, so a player's payload
 * never even carries the column.
 */
function toRegistrant(
  row: RegistrantRow,
  viewerId: string | null,
  withPhone: boolean,
  waitlistLength: number,
): RosterRegistrant {
  return {
    name: row.user.name,
    // The real name pair, joined — `null` while the first-run sheet is
    // unanswered, so a roster falls back to the display name instead of
    // printing a blank.
    fullName: fullNameOf(row.user.firstName, row.user.lastName),
    isMe: viewerId !== null && row.userId === viewerId,
    status: row.status,
    paymentStatus: row.paymentStatus,
    attendance: row.attendance,
    lateMinutes: row.lateMinutes,
    // `waitlistLength` is the number of earlier waiters → 1-based position.
    waitlistPosition: row.status === "WAITLIST" ? waitlistLength + 1 : null,
    // The roster ignores it; the viewer's own seat (which is one of these rows)
    // reads it to announce the promotion.
    promoted: row.promotedAt !== null,
    // Absent — not `null` — for a player: a payload that never selected the
    // column cannot leak it later, whatever a component decides to render.
    ...(withPhone ? { phone: row.user.phone ?? null } : {}),
  };
}

/**
 * Is the viewer the manager? A number is manager-only data, and the answer is
 * never taken from the client: the role comes from the viewer's own row, plus
 * `ADMIN_EITAA_ID`, exactly like `getCurrentUser` resolves it.
 *
 * This lives here because the query is the guard (the roster component only
 * decides how to *draw* what it was given) — a player's payload must not contain
 * the column at all.
 */
async function isAdminViewer(viewerId: string | null): Promise<boolean> {
  if (!viewerId) return false;

  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { role: true, eitaaId: true },
  });

  return viewer !== null && (viewer.role === "ADMIN" || isAdminEitaaId(viewer.eitaaId));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Cards for the home screen: every `PUBLISHED` session that has not been over
 * for two weeks, soonest first. Drafts and canceled sessions never appear; a
 * session the player has canceled their seat in still does (they may re-register).
 */
export async function listHomeSessions(viewerId: string | null): Promise<SessionCard[]> {
  const now = new Date();

  const sessions = await prisma.session.findMany({
    where: {
      status: "PUBLISHED",
      endsAt: { gte: new Date(now.getTime() - HOME_LOOKBACK_DAYS * DAY_MS) },
    },
    orderBy: { startsAt: "asc" },
    select: {
      ...SESSION_CARD_SELECT,
      // Only the viewer's own seat — filtered by `userId` and `take: 1` because
      // `@@unique([sessionId, userId])` allows exactly one such row. With no
      // viewer there is nothing to fetch, so the join is left out entirely.
      registrations: viewerId
        ? { where: { userId: viewerId }, take: 1, select: MY_REGISTRATION_SELECT }
        : undefined,
    },
  });

  const counts = await countBySession(sessions.map((session) => session.id));

  return sessions.map((session) => {
    const own = session.registrations?.[0];
    // A canceled registration is history, not a seat: the home card claims none.
    return toCard(
      session,
      counts.get(session.id) ?? NO_COUNTS,
      own && own.status !== "CANCELED" ? toMyRegistration(own) : null,
      now,
    );
  });
}

/**
 * The viewer's ledger for `/my`, in the two groups the screen renders.
 *
 * The split is the **same rule the screen used to derive** (the old
 * `splitRegistrations`: a canceled session or a finished one is history, and a
 * `DRAFT` is nobody's business) — but resolved **in the database** now, because
 * the owner's rule is that history must page: «گذشته» reads one page at a time
 * (newest first) and the screen never loads a whole playing career to show
 * twenty rows of it.
 *
 * «پیش رو» has no page on purpose: live seats are bounded by life (the sessions a
 * player actually holds), while history grows forever — the bound that matters
 * belongs in the query; the other would only cost a count.
 *
 * Each live row also carries the cancel rule in force *now*
 * (`myRegistration.cancel`), because this screen owns the «لغو ثبت‌نام» control.
 * The cost is one settings read and one penalty read per whole screen: the
 * player's late cancels are fetched once and every row counts them against the
 * window of its own session — and a waitlisted row skips both, because its cancel
 * is free by definition. Past rows carry no verdict (their control is never
 * rendered), so only the live group pays for the computation.
 */
export type MyRegistrationsLedger = {
  /** Live seats, next session first. */
  ahead: SessionCard[];
  /** One page of history, newest session first. */
  past: SessionCard[];
  /** How many past rows exist across all pages — the pager's denominator. */
  pastTotal: number;
  /** The page that was actually served (a stale link is clamped, never 404). */
  pastPage: number;
};

export async function listMyRegistrations(
  userId: string,
  options: {
    // The screen owns the clock when it has one (so its ban card and these
    // verdicts cannot disagree).
    now?: Date;
    /** 1-based «گذشته» page, from `?page=`. */
    pastPage?: number;
  } = {},
): Promise<MyRegistrationsLedger> {
  const now = options.now ?? new Date();
  const requestedPage = options.pastPage ?? 1;

  // The past predicate, verbatim the screen's old rule: a canceled session, or
  // one that is over. The complement is every live seat — and a `DRAFT` session
  // matches neither, so it stays invisible here like everywhere else.
  const pastWhere: Prisma.RegistrationWhereInput = {
    userId,
    OR: [
      { session: { status: "CANCELED" } },
      { session: { status: "PUBLISHED", endsAt: { lte: now } } },
    ],
  };

  // Four independent reads in one round trip: the live seats, the history count,
  // the rules row and the late-cancel events.
  const [aheadRows, pastTotal, setting, lateCancelEvents] = await Promise.all([
    prisma.registration.findMany({
      where: { userId, session: { status: "PUBLISHED", endsAt: { gt: now } } },
      include: {
        session: { include: { venue: { select: VENUE_SUMMARY } } },
      },
      orderBy: { session: { startsAt: "asc" } },
    }),
    prisma.registration.count({ where: pastWhere }),
    prisma.setting.findUnique({ where: { id: 1 } }),
    listLateCancelEvents(userId),
  ]);

  // A stale `?page=` (rows were canceled, the window moved) serves the last real
  // page instead of an empty screen that looks broken.
  const pastPage = clampPage(requestedPage, pastTotal);

  const pastRows = await prisma.registration.findMany({
    where: pastWhere,
    include: {
      session: { include: { venue: { select: VENUE_SUMMARY } } },
    },
    // `id` breaks ties so two rows sharing one timestamp keep one order across
    // pages — otherwise a row could show on two pages and another on none.
    orderBy: [{ session: { startsAt: "desc" } }, { id: "desc" }],
    ...pageRange(pastPage),
  });

  const counts = await countBySession([
    ...aheadRows.map((row) => row.session.id),
    ...pastRows.map((row) => row.session.id),
  ]);
  const baseRules = setting ?? DEFAULT_CANCEL_RULES;

  const toLedgerCard = (row: (typeof aheadRows)[number], withVerdict: boolean): SessionCard => {
    const seat = toMyRegistration(row);
    // The rules of *this* row's session (settings + its own overrides): two
    // sessions may declare two different windows, so the warning count is
    // resolved per row.
    const rules = resolveCancelRules(baseRules, row.session);

    // `canCancelNow` answers `false` for a canceled seat, an unpublished session
    // and one that has already started — those rows carry `null`, not a verdict.
    // A **waitlisted** row takes the other branch: its cancel is free wherever
    // the clock is, and `waitlistCancelVerdict()` is the very value the engine
    // will honor — the dialog and the engine cannot disagree about it.
    const cancel =
      !withVerdict || !canCancelNow(row.session, seat, now)
        ? null
        : row.status === "WAITLIST"
          ? waitlistCancelVerdict()
          : cancelVerdictNow({
              startsAt: row.session.startsAt,
              rules,
              now,
              lateCancelsInWindow: countLateCancelsInWindow(
                lateCancelEvents,
                rules.lateCancelWarningWindowDays,
                now,
              ),
            });

    return toCard(
      row.session,
      counts.get(row.session.id) ?? NO_COUNTS,
      // Here the canceled row *is* the answer — it renders as the «لغو شده» chip.
      toMyRegistration(row, cancel),
      now,
    );
  };

  return {
    ahead: aheadRows.map((row) => toLedgerCard(row, true)),
    past: pastRows.map((row) => toLedgerCard(row, false)),
    pastTotal,
    pastPage,
  };
}

/**
 * Everything the session page needs, or `null` when the viewer may not see it.
 *
 * `null` covers a missing id and a `DRAFT` — as far as a player is concerned a
 * draft does not exist, and the page renders «سانس پیدا نشد» for both. A
 * canceled session *is* visible: it has to say «لغو شده» instead of 404-ing the
 * link that was already shared.
 */
export async function getSessionDetail(
  sessionId: string,
  viewerId: string | null,
  // Same contract as `listMyRegistrations`: the caller may hand in the one clock
  // it already reads `serverNowIso` from.
  now: Date = new Date(),
): Promise<SessionDetail | null> {
  // Manager or player? The roster's contact numbers hang on this one answer, and
  // it is resolved here — from `viewerId` — so the caller cannot pass a role it
  // was told, and a player's payload can never contain somebody else's number.
  const viewerIsAdmin = await isAdminViewer(viewerId);

  // The roster holds only live rows (`CONFIRMED` / `WAITLIST`). A canceled row
  // stays out on purpose: its seat may be asked for again, and the register
  // button is exactly how — so it never rides along, and the page offers the tap.
  const rosterWhere: Prisma.RegistrationWhereInput = {
    status: { in: ["CONFIRMED", "WAITLIST"] },
  };

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      ...SESSION_CARD_SELECT,
      venue: { select: VENUE_DETAIL },
      description: true,
      // The manager's Neshan link for this slot (nullable) — `mapUrl` is a detail:
      // the list screens only need the card columns.
      mapUrl: true,
      // The twelve nullable override columns — the `CancelRules` keys, so
      // `resolveCancelRules` can receive the session row as-is.
      ...CANCEL_OVERRIDE_SELECT,
      // The lists are the *same* queue in registration order: the waitlist
      // position is an index in it, never a stored number.
      registrations: {
        where: rosterWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: viewerIsAdmin ? REGISTRANT_SELECT_ADMIN : REGISTRANT_SELECT,
      },
    },
  });

  if (!session || session.status === "DRAFT") return null;

  const { confirmed, waitlist } = splitRegistrants(
    session.registrations,
    viewerId,
    viewerIsAdmin,
  );

  // The lists are complete, so the counts are just their lengths — no second
  // capacity query that could disagree with what is on screen.
  const counts: RegistrationCounts = {
    confirmed: confirmed.length,
    waitlist: waitlist.length,
  };

  // The rules of *this* session: the settings row, then the session's overrides.
  const setting = await prisma.setting.findUnique({ where: { id: 1 } });
  const rules = resolveCancelRules(setting ?? DEFAULT_CANCEL_RULES, session);

  // The viewer's own seat in the two live groups — its real queue position lives
  // right here, because the roster is the whole queue.
  const myRegistrant = waitlist.find((row) => row.isMe) ?? confirmed.find((row) => row.isMe) ?? null;

  // The same seat, re-read with its **money columns**: the roster selects carry
  // none (another player's balance split is nobody's business), while the
  // viewer's own row feeds every money line on this page. A canceled row is not
  // a seat — the register button is how it comes back.
  const mySeatRow = viewerId
    ? await prisma.registration.findUnique({
        where: { sessionId_userId: { sessionId, userId: viewerId } },
        select: MY_REGISTRATION_SELECT,
      })
    : null;
  const mySeat = mySeatRow && mySeatRow.status !== "CANCELED" ? mySeatRow : null;

  // The «لغو ثبت‌نام» control on this page states the rule in force right now, so
  // the seat carries its verdict — resolved here, with the same helper the engine
  // uses, from the same rules already read above (the rules card renders them).
  // Only a live seat pays for the extra read, and a waitlisted seat pays for none:
  // its cancel is free wherever the clock is.
  let cancel: CancelVerdict | null = null;
  if (viewerId && canCancelNow(session, myRegistrant, now)) {
    cancel =
      myRegistrant?.status === "WAITLIST"
        ? waitlistCancelVerdict()
        : cancelVerdictNow({
            startsAt: session.startsAt,
            rules,
            now,
            lateCancelsInWindow: countLateCancelsInWindow(
              await listLateCancelEvents(viewerId),
              rules.lateCancelWarningWindowDays,
              now,
            ),
          });
  }

  // The viewer's ban and their **balance** (for the «موجودیت: …» hint above the
  // register button) — two reads for one viewer, over before the render.
  const [ban, balanceRow] = await Promise.all([
    viewerId ? getActiveBan(viewerId, now) : Promise.resolve(null),
    viewerId
      ? prisma.user.findUnique({ where: { id: viewerId }, select: { balance: true } })
      : Promise.resolve(null),
  ]);

  // The viewer's seat as the screens read it: the queue position the roster knows
  // (the list is right here) and the verdict resolved above.
  const myBase = toMyRegistration(mySeat, cancel);
  const myRegistration: MyRegistration | null = myBase
    ? { ...myBase, waitlistPosition: myRegistrant?.waitlistPosition ?? null }
    : null;

  return {
    // A copy of the viewer's own seat — and only that seat carries the verdict.
    ...toCard(session, counts, myRegistration, now),
    description: session.description,
    // The manager's own link for this slot wins; the venue carries a link as the
    // fallback, and the session page builds a Neshan search when both are empty
    // (`src/lib/neshan.ts`).
    mapUrl: session.mapUrl ?? session.venue.mapUrl,
    rulesSentences: cancelRuleSentences(rules),
    rulesText: cancelRulesText(rules),
    confirmed,
    waitlist,
    ban,
    viewerBalance: balanceRow?.balance ?? 0,
  };
}

/**
 * The manager's membership queue (the owner's newest round): every account the
 * manager has not approved — the waiting list, oldest first — plus the rejected
 * ones, kept visible on purpose: a rejection is **not final**, and the
 * re-approval tap must have a home.
 *
 * Both lists are ordered by `createdAt` asc: the waiting list is a queue (first
 * asked, first decided), and the rejected list is a review list — the oldest
 * grudge must not sink to the bottom.
 *
 * This is the one read whose rows carry the players' **contact numbers** and
 * Eitaa ids: the caller is the admin screen, and the query itself is the guard.
 */
export async function listMembershipQueue(): Promise<{
  pending: MembershipRequest[];
  rejected: MembershipRequest[];
}> {
  const rows = await prisma.user.findMany({
    where: { membershipStatus: { in: ["PENDING", "REJECTED"] } },
    // `createdAt` is the queue order; the id breaks the tie between rows that
    // share a millisecond.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      eitaaId: true,
      name: true,
      firstName: true,
      lastName: true,
      phone: true,
      createdAt: true,
      membershipStatus: true,
    },
  });

  const toRequest = (row: (typeof rows)[number]): MembershipRequest => ({
    userId: row.id,
    eitaaId: row.eitaaId,
    name: row.name,
    fullName: fullNameOf(row.firstName, row.lastName),
    phone: row.phone,
    createdAt: row.createdAt,
  });

  return {
    pending: rows.filter((row) => row.membershipStatus === "PENDING").map(toRequest),
    rejected: rows.filter((row) => row.membershipStatus === "REJECTED").map(toRequest),
  };
}
