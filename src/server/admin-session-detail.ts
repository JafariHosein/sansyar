/**
 * The read side of «مدیریت سانس» — `/admin/sessions/[id]` (PROMPT.md §۶.۴).
 *
 * One call, one clock, one shape: the manager's board for a single سانس. The
 * screen owns no query of its own, so the capacity rail, the payment line and
 * the roster's row count can never describe three different moments.
 *
 * Three rules mirror `src/server/sessions/queries.ts` (the player's side of the
 * same session) on purpose, because a manager and a player must never read the
 * same slot differently:
 *
 *  - **no stored counters** — every number here is a `length` of a list this call
 *    already has, or a single `count()`;
 *  - **occupancy is `CONFIRMED`** — a waitlisted row holds no seat and owes
 *    nothing, so it is counted in its own line only;
 *  - **the roster carries the contact number** — this is the manager's payload
 *    and the query itself is the guard (`getSessionDetail` makes the same choice
 *    with `REGISTRANT_SELECT_ADMIN`), so a player's payload never contains one.
 *
 * Two deliberate differences from the player's read:
 *
 *  - a **`DRAFT` is visible** here (the manager has to publish it), while a
 *    player's read answers `null` for one;
 *  - **canceled rows are not listed** — they are history, not seats — but the
 *    count travels (`canceledCount`) so the screen can say how many people gave
 *    a seat up instead of silently shrinking the roster.
 */

import "server-only";

import { seatOutstanding } from "@/lib/balance";
import { prisma } from "@/lib/db";
import {
  DEFAULT_CANCEL_RULES,
  fullNameOf,
  isPaidSeat,
  resolveCancelRules,
  sessionStage,
  type AttendanceStatus,
  type CancelRules,
  type PaymentMode,
  type PaymentStatus,
  type RegistrationStatus,
  type SessionStage,
  type SessionStatus,
} from "@/lib/sessions";

/**
 * One live seat of a session, as the manager's roster row reads it.
 *
 * `waitlistPosition` is the 1-based place in the queue, computed from the list
 * order (`createdAt asc, id asc` — the same order the promotion engine uses), so
 * «نوبت ۳» on the screen and the next promotion can never disagree.
 *
 * `paid` is `isPaidSeat(paymentStatus)` — the one fact the screen needs beyond
 * the raw column, and the same predicate the cancel dialog and the dashboard's
 * «دریافت‌نشده» use.
 *
 * The two money columns are the seat's **own snapshot** (`amountToman`) and the
 * part the account's balance covered (`paidFromBalance`), so the payment cell and
 * the «دریافت‌نشده» line state what *this* seat still owes — never what the
 * session's price happens to be today.
 */
export type AdminSeatRow = {
  registrationId: string;
  userId: string;
  /** The display name (the Eitaa name, or the one the player set). */
  name: string;
  /** The real name pair, joined; `null` until the first-run sheet is answered. */
  fullName: string | null;
  /** The contact number — manager-only data. */
  phone: string | null;
  status: Extract<RegistrationStatus, "CONFIRMED" | "WAITLIST">;
  paymentStatus: PaymentStatus;
  paid: boolean;
  /** The price this seat was registered at (the snapshot), in Toman. */
  amountToman: number;
  /** How much of `amountToman` came off the player's balance. */
  paidFromBalance: number;
  attendance: AttendanceStatus;
  lateMinutes: number | null;
  /** Came off the waitlist into the hall (§۵.۲) — *this* promotion, not an old one. */
  promoted: boolean;
  /** When the attempt was made — the roster order, and the waitlist order with it. */
  createdAt: Date;
  /** 1 = first in line. `null` on a held seat. */
  waitlistPosition: number | null;
};

/** Everything `/admin/sessions/[id]` renders, for one instant. */
export type AdminSessionDetail = {
  id: string;
  title: string;
  description: string | null;
  venueName: string;
  /** `addressOverride ?? venue.address` — already resolved. */
  address: string;
  /** The manager's link for this slot, falling back to the venue's (`mapUrl`). */
  mapUrl: string | null;
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  capacity: number;
  priceToman: number;
  paymentMode: PaymentMode;
  status: SessionStatus;
  /** Derived, never stored: upcoming / open / full / closed / running / finished … */
  stage: SessionStage;
  /** Seats people hold (`CONFIRMED`). */
  occupiedCount: number;
  waitlistCount: number;
  /**
   * Held seats that still owe money — the very predicate the dashboard's
   * «دریافت‌نشده» tile counts (`CONFIRMED` + `paymentStatus = UNPAID`).
   */
  unpaidCount: number;
  /**
   * What those seats still owe, added up seat by seat: each row's snapshot minus
   * the part its balance covered. One session rarely has one price any more — a
   * seat taken before a price edit keeps its own — so the total is never
   * `count × price`.
   */
  unpaidToman: number;
  /** Held seats nobody has marked yet: what «بستن حضور و غیاب» would sweep. */
  pendingAttendanceCount: number;
  /** Rows that were canceled (by the player or by the manager) — not listed, counted. */
  canceledCount: number;
  /** Held seats, in registration order. */
  confirmed: AdminSeatRow[];
  /** The queue behind a full hall, in promotion order. */
  waitlist: AdminSeatRow[];
  /**
   * The rules in force for *this* session (the settings row, then the session's
   * own overrides) — the copy that explains a mark, a no-show charge and the
   * strike ladder, resolved once here so no screen re-derives them.
   */
  rules: CancelRules;
};

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
} as const;

/**
 * One session, end to end, for the manager's board — or `null` when the id
 * matches nothing (the page answers with `notFound()`).
 *
 * `now` is the screen's clock and is passed in, exactly like every other admin
 * read: the stage badge, the live countdown's starting point and the row chips
 * then describe one moment instead of three.
 */
export async function getAdminSessionDetail(
  sessionId: string,
  now: Date = new Date(),
): Promise<AdminSessionDetail | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      description: true,
      addressOverride: true,
      mapUrl: true,
      startsAt: true,
      endsAt: true,
      registrationOpensAt: true,
      registrationClosesAt: true,
      capacity: true,
      priceToman: true,
      paymentMode: true,
      status: true,
      // The venue's own link rides along as the fallback for «مسیریابی» — the
      // same resolution the session page makes (`session.mapUrl ?? venue.mapUrl`).
      venue: { select: { name: true, address: true, mapUrl: true } },
      ...CANCEL_OVERRIDE_SELECT,
      // Live rows only, in the order the promotion engine uses: `createdAt`, with
      // the id breaking ties between rows that share a millisecond.
      registrations: {
        where: { status: { in: ["CONFIRMED", "WAITLIST"] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
          status: true,
          paymentStatus: true,
          amountToman: true,
          paidFromBalance: true,
          attendance: true,
          lateMinutes: true,
          promotedAt: true,
          createdAt: true,
          user: { select: { name: true, firstName: true, lastName: true, phone: true } },
        },
      },
    },
  });

  if (!session) return null;

  // Two facts the row list cannot answer: how many people gave a seat up, and the
  // rules of this session. Both are cheap and independent — one round trip.
  const [canceledCount, setting] = await Promise.all([
    prisma.registration.count({ where: { sessionId, status: "CANCELED" } }),
    prisma.setting.findUnique({ where: { id: 1 } }),
  ]);

  const confirmed: AdminSeatRow[] = [];
  const waitlist: AdminSeatRow[] = [];

  for (const row of session.registrations) {
    // `waitlistPosition` is the index among the rows seen so far, +1 — the queue
    // is already in promotion order, so this is the place in line and not a guess.
    const seat: AdminSeatRow = {
      registrationId: row.id,
      userId: row.userId,
      name: row.user.name,
      fullName: fullNameOf(row.user.firstName, row.user.lastName),
      phone: row.user.phone,
      status: row.status === "WAITLIST" ? "WAITLIST" : "CONFIRMED",
      paymentStatus: row.paymentStatus,
      paid: isPaidSeat(row.paymentStatus),
      amountToman: row.amountToman,
      paidFromBalance: row.paidFromBalance,
      attendance: row.attendance,
      lateMinutes: row.lateMinutes,
      promoted: row.promotedAt !== null,
      createdAt: row.createdAt,
      waitlistPosition: row.status === "WAITLIST" ? waitlist.length + 1 : null,
    };

    if (row.status === "WAITLIST") waitlist.push(seat);
    else confirmed.push(seat);
  }

  const unpaid = confirmed.filter((seat) => seat.paymentStatus === "UNPAID");

  return {
    id: session.id,
    title: session.title,
    description: session.description,
    venueName: session.venue.name,
    address: session.addressOverride ?? session.venue.address,
    mapUrl: session.mapUrl ?? session.venue.mapUrl,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    registrationOpensAt: session.registrationOpensAt,
    registrationClosesAt: session.registrationClosesAt,
    capacity: session.capacity,
    priceToman: session.priceToman,
    paymentMode: session.paymentMode,
    status: session.status,
    stage: sessionStage(
      {
        status: session.status,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        registrationOpensAt: session.registrationOpensAt,
        registrationClosesAt: session.registrationClosesAt,
        capacity: session.capacity,
        occupiedCount: confirmed.length,
      },
      now,
    ),
    occupiedCount: confirmed.length,
    waitlistCount: waitlist.length,
    unpaidCount: unpaid.length,
    unpaidToman: unpaid.reduce((sum, seat) => sum + seatOutstanding(seat), 0),
    pendingAttendanceCount: confirmed.filter((seat) => seat.attendance === "PENDING").length,
    canceledCount,
    confirmed,
    waitlist,
    rules: resolveCancelRules(setting ?? DEFAULT_CANCEL_RULES, session),
  };
}
