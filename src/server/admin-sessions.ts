/**
 * The manager's **sessions** — the read side of `/admin/sessions`,
 * `/admin/sessions/new` and `/admin/sessions/[id]/edit` (PROMPT.md §۶.۴).
 *
 * Three rules — the same three every admin query in this app follows:
 *
 *  - **No counts per row.** «۸ از ۱۲ نفر» on every row comes from a single
 *    `groupBy` over `Registration` for the page's ids, never one query per row —
 *    and occupancy is `CONFIRMED` alone, so a waitlisted row (which holds no seat)
 *    can never make a hall look full.
 *  - **No `getCurrentUser()` here.** The pages resolve the viewer inside their own
 *    `<Suspense>` boundary; a query never reads cookies on its own.
 *  - **One clock per call.** `when` («پیش رو» / «برگزارشده») and the rows are
 *    resolved from a single `now` handed in by the page, so a list can never mix
 *    two notions of "now".
 *
 * `server-only` on purpose: Prisma must never be reachable from a client bundle.
 * The types below are structural — the pages and the client form import them with
 * `import type`, which is erased at compile time.
 */

import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import {
  jalaaliMonthLength,
  jalaliDateTimeToUtc,
  tehranWallClock,
  tehranWallClockToUtc,
  toJalaliDateTime,
} from "@/lib/jalali";
import { clampPage, pageRange } from "@/lib/pagination";
import type {
  SessionFormValues,
  SessionStatusFilter,
  SessionWhen,
  VenueChoice,
} from "@/lib/admin-sessions";
import type { CancelRules, PaymentMode, SessionStatus } from "@/lib/sessions";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One row of the manager's session list. */
export type AdminSessionRow = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  venueName: string;
  capacity: number;
  /** Seats people hold — `CONFIRMED` only. A waitlisted row is not in the hall. */
  occupiedCount: number;
  status: SessionStatus;
  paymentMode: PaymentMode;
};

export type AdminSessionList = {
  rows: AdminSessionRow[];
  /** Rows matching the current filters — the pager's denominator. */
  total: number;
};

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

/** The list's columns: what a row prints, and nothing more. */
const SESSION_LIST_SELECT = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  paymentMode: true,
  status: true,
  venue: { select: { name: true } },
} as const satisfies Prisma.SessionSelect;

/** Everything the form edits: the slot's columns plus the twelve override columns. */
const SESSION_FORM_SELECT = {
  title: true,
  venueId: true,
  startsAt: true,
  endsAt: true,
  registrationOpensAt: true,
  registrationClosesAt: true,
  capacity: true,
  priceToman: true,
  paymentMode: true,
  status: true,
  addressOverride: true,
  mapUrl: true,
  description: true,
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

/** The row `SESSION_FORM_SELECT` returns — named so the mappers can take it. */
type SessionFormRow = {
  title: string;
  venueId: string;
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  capacity: number;
  priceToman: number;
  paymentMode: PaymentMode;
  status: SessionStatus;
  addressOverride: string | null;
  mapUrl: string | null;
  description: string | null;
  freeCancelHours: number | null;
  lateCancelEnabled: boolean | null;
  lateCancelPenaltyDays: number | null;
  lateCancelFirstWarning: boolean | null;
  lateCancelWarningWindowDays: number | null;
  noShowEnabled: boolean | null;
  noShowPenaltyDays: number | null;
  lateStrikesEnabled: boolean | null;
  lateThresholdMinutes: number | null;
  lateStrikeCount: number | null;
  lateStrikeWindowDays: number | null;
  lateStrikePenaltyDays: number | null;
};

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/**
 * The twelve override columns → a `CancelRules`, or `null`.
 *
 * The form edits the rules **all together or not at all** («قوانین اختصاصی داشته
 * باشه»), and a half-filled row cannot be resolved by `resolveCancelRules`, so a
 * row that is missing any of the twelve reads as «هیچ overrideی ندارد» — the
 * session inherits `/admin/settings`.
 *
 * The twelve are read into locals before the guard: a `!== null` chain on the
 * row's own properties would narrow the properties, not what the return object
 * reads, and the locals are what makes the compiler agree without a cast.
 */
function rulesFromRow(row: SessionFormRow): CancelRules | null {
  const {
    freeCancelHours,
    lateCancelEnabled,
    lateCancelPenaltyDays,
    lateCancelFirstWarning,
    lateCancelWarningWindowDays,
    noShowEnabled,
    noShowPenaltyDays,
    lateStrikesEnabled,
    lateThresholdMinutes,
    lateStrikeCount,
    lateStrikeWindowDays,
    lateStrikePenaltyDays,
  } = row;

  if (
    freeCancelHours === null ||
    lateCancelEnabled === null ||
    lateCancelPenaltyDays === null ||
    lateCancelFirstWarning === null ||
    lateCancelWarningWindowDays === null ||
    noShowEnabled === null ||
    noShowPenaltyDays === null ||
    lateStrikesEnabled === null ||
    lateThresholdMinutes === null ||
    lateStrikeCount === null ||
    lateStrikeWindowDays === null ||
    lateStrikePenaltyDays === null
  ) {
    return null;
  }

  return {
    freeCancelHours,
    lateCancelEnabled,
    lateCancelPenaltyDays,
    lateCancelFirstWarning,
    lateCancelWarningWindowDays,
    noShowEnabled,
    noShowPenaltyDays,
    lateStrikesEnabled,
    lateThresholdMinutes,
    lateStrikeCount,
    lateStrikeWindowDays,
    lateStrikePenaltyDays,
  };
}

/** A form row → the values the form opens with. */
function toFormValues(row: SessionFormRow): SessionFormValues {
  return {
    title: row.title,
    venueId: row.venueId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    registrationOpensAt: row.registrationOpensAt,
    registrationClosesAt: row.registrationClosesAt,
    capacity: row.capacity,
    priceToman: row.priceToman,
    paymentMode: row.paymentMode,
    // A canceled session never reaches this mapper (see `getSessionFormValues`),
    // so the two write-able states are the only ones left.
    status: row.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    addressOverride: row.addressOverride,
    mapUrl: row.mapUrl,
    description: row.description,
    rules: rulesFromRow(row),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Seats held (`CONFIRMED` only) for a whole page of sessions, in **one** query.
 *
 * The ids come from the rows the screen already loaded, so a count can never be
 * about a session that is not on screen. A waitlisted row holds no seat and a
 * canceled one holds nothing — neither is counted.
 */
async function occupancyBySession(ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;

  const rows = await prisma.registration.groupBy({
    by: ["sessionId"],
    where: { sessionId: { in: ids }, status: "CONFIRMED" },
    _count: { _all: true },
  });

  for (const row of rows) counts.set(row.sessionId, row._count._all);
  return counts;
}

/**
 * The order of one page: soonest first on «پیش رو» (the next thing the hall must
 * prepare for), latest first on «برگزارشده» and «همه» (history reads newest
 * first). The id breaks ties so two rows sharing a timestamp keep one order
 * across pages — otherwise a row could show on two pages and another on none.
 */
const PAGE_ORDER: Record<SessionWhen, Prisma.SessionOrderByWithRelationInput[]> = {
  upcoming: [{ startsAt: "asc" }, { id: "asc" }],
  past: [{ endsAt: "desc" }, { id: "desc" }],
  all: [{ startsAt: "desc" }, { id: "desc" }],
};

/**
 * One page of the manager's sessions, filtered by time and status.
 *
 * The list **pages in the database** (the owner's rule: no screen renders an
 * unbounded history): twenty sessions and twenty thousand cost the same HTML. The
 * count comes first so a stale `?page=۹` is clamped to the last real page before
 * any row is read — a link that outlived its list lands somewhere sensible
 * instead of on an empty screen that looks broken.
 */
export async function listAdminSessions(input: {
  when?: SessionWhen;
  status?: SessionStatusFilter;
  page?: number;
  /** The screen's clock — the same instant decides the filter and the rows. */
  now?: Date;
}): Promise<AdminSessionList> {
  const now = input.now ?? new Date();
  const when = input.when ?? "upcoming";
  const status = input.status ?? "ALL";
  const page = input.page ?? 1;

  const where: Prisma.SessionWhereInput = {
    // «پیش رو» is about the session not having started; «برگزارشده» is about it
    // being over. A session that is running right now is therefore neither.
    ...(status === "ALL" ? {} : { status }),
    ...(when === "upcoming" ? { startsAt: { gte: now } } : {}),
    ...(when === "past" ? { endsAt: { lt: now } } : {}),
  };

  const total = await prisma.session.count({ where });

  const rows = await prisma.session.findMany({
    where,
    orderBy: PAGE_ORDER[when],
    ...pageRange(clampPage(page, total)),
    select: SESSION_LIST_SELECT,
  });

  const occupancy = await occupancyBySession(rows.map((row) => row.id));

  return {
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      venueName: row.venue.name,
      capacity: row.capacity,
      occupiedCount: occupancy.get(row.id) ?? 0,
      status: row.status,
      paymentMode: row.paymentMode,
    })),
    total,
  };
}

/**
 * The venues the form's Select offers: the ones still in service first, then the
 * rest, each group in name order.
 *
 * Nothing is filtered out. A deactivated venue must stay selectable while editing
 * a session that already sits on it — otherwise opening such a slot and saving it
 * would silently move the session somewhere else — so the list carries
 * `isActive` and the form marks the row instead of hiding it.
 */
export async function listVenueChoices(): Promise<VenueChoice[]> {
  return prisma.venue.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, address: true, isActive: true },
  });
}

/**
 * The values the edit form opens with, or `null` when there is nothing to edit.
 *
 * `null` covers a missing session **and** a canceled one: a canceled slot takes
 * no more edits (`saveSession` refuses it with `CLOSED`), so offering a form that
 * could only fail would be a lie. The edit page tells the two apart with
 * `getAdminSessionStatus` — a missing row is a 404, a canceled one gets its own
 * sentence with a way back to the manage screen.
 */
export async function getSessionFormValues(
  id: string,
): Promise<{ sessionId: string; values: SessionFormValues } | null> {
  const row = await prisma.session.findUnique({ where: { id }, select: SESSION_FORM_SELECT });
  if (!row || row.status === "CANCELED") return null;

  return { sessionId: id, values: toFormValues(row) };
}

/**
 * One column of one session — the third answer the edit page needs.
 *
 * `getSessionFormValues` returns `null` for two different situations on purpose
 * (see above); this read names the state, so the page can answer «این سانس پیدا
 * نشد» with a 404 and «سانس لغوشده قابل ویرایش نیست.» with an alert and a link to
 * the manage screen. The two reads run in parallel, so the distinction costs no
 * extra round trip in wall-clock time.
 */
export async function getAdminSessionStatus(id: string): Promise<SessionStatus | null> {
  const row = await prisma.session.findUnique({ where: { id }, select: { status: true } });
  return row?.status ?? null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** «۲۱:۰۰» — the hour a hall's sessions start, as Tehran reads it. */
const DEFAULT_START_HOUR = 21;
/** 90 minutes — one futsal سانس. */
const DEFAULT_SESSION_MINUTES = 90;
/** Twelve seats — the hall the seed describes, and a sane first guess. */
const DEFAULT_CAPACITY = 12;
/** The default hour must be at least this far away before "today" is offered. */
const DEFAULT_LEAD_MS = 60 * 60 * 1000;

/**
 * The next ۲۱:۰۰ on the Tehran clock: today when it is still more than an hour
 * away, tomorrow otherwise.
 *
 * The day is stepped on the **Jalali calendar** (`jalaaliMonthLength`), never by
 * adding 24 hours to an instant — a DST shift would slide the hour, and the
 * manager would meet a ۲۰:۰۰ default one week a year.
 */
function nextEvening(now: Date): Date {
  const wall = tehranWallClock(now);
  const today = tehranWallClockToUtc(wall.gy, wall.gm, wall.gd, DEFAULT_START_HOUR, 0);
  if (today.getTime() - now.getTime() > DEFAULT_LEAD_MS) return today;

  const { jy, jm, jd } = toJalaliDateTime(now);
  const tomorrow =
    jd + 1 <= jalaaliMonthLength(jy, jm)
      ? { jy, jm, jd: jd + 1 }
      : jm === 12
        ? { jy: jy + 1, jm: 1, jd: 1 }
        : { jy, jm: jm + 1, jd: 1 };

  return jalaliDateTimeToUtc(tomorrow.jy, tomorrow.jm, tomorrow.jd, DEFAULT_START_HOUR, 0);
}

/**
 * The values the create form opens with: next ۲۱:۰۰, ۹۰ minutes long, twelve
 * seats, free, paid in person, unpublished, and inheriting every rule.
 *
 * The venue is the first **active** one — the hall the manager most likely means
 * — or `""`, which the form shows as «مکان رو انتخاب کن» and the schema refuses
 * on submit. The page offers the «اول یه مکان بساز» card in that case instead of
 * a form that cannot be saved.
 */
export async function defaultNewSessionValues(now: Date): Promise<SessionFormValues> {
  const venue = await prisma.venue.findFirst({
    where: { isActive: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  const startsAt = nextEvening(now);

  return {
    title: "",
    venueId: venue?.id ?? "",
    startsAt,
    endsAt: new Date(startsAt.getTime() + DEFAULT_SESSION_MINUTES * 60 * 1000),
    // The window is open from the moment the manager starts filling the form —
    // the form's «ثبت‌نام از همین حالا باز باشه» switch sends exactly this.
    registrationOpensAt: now,
    registrationClosesAt: startsAt,
    capacity: DEFAULT_CAPACITY,
    priceToman: 0,
    paymentMode: "IN_PERSON",
    status: "DRAFT",
    addressOverride: null,
    mapUrl: null,
    description: null,
    rules: null,
  };
}

/** How far a copy is pushed: one week, the hall's own rhythm. */
const COPY_SHIFT_DAYS = 7;

/**
 * The values a **copy** of an existing session opens with: everything the row
 * carries — title, venue, capacity, price, payment mode, the address overrides,
 * the rules — with all four timestamps pushed a week later and the status reset
 * to `DRAFT`, because a copy is a proposal until the manager publishes it.
 *
 * A canceled session **can** be copied: its slot is history, and repeating it next
 * week is the most natural thing a manager does after canceling one. Only a
 * session that no longer exists answers `null`.
 *
 * `now` is accepted to match the other readers and deliberately unused — the shift
 * is clock-free, so the copy lands exactly one week later whatever today is.
 */
export async function getCopyFormValues(id: string, now: Date): Promise<SessionFormValues | null> {
  void now;

  const row = await prisma.session.findUnique({ where: { id }, select: SESSION_FORM_SELECT });
  if (!row) return null;

  const shift = (value: Date) => new Date(value.getTime() + COPY_SHIFT_DAYS * DAY_MS);

  return {
    ...toFormValues(row),
    startsAt: shift(row.startsAt),
    endsAt: shift(row.endsAt),
    registrationOpensAt: shift(row.registrationOpensAt),
    registrationClosesAt: shift(row.registrationClosesAt),
    status: "DRAFT",
  };
}
