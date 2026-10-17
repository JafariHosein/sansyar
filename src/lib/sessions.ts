/**
 * Session presentation logic — **pure**, shared by server and client.
 *
 * Why a separate module: the "display status" of a session (upcoming / open /
 * full / closed / running / finished) is derived — never stored (PROMPT.md §۴) —
 * and the very same derivation has to agree on the server (queries, actions) and
 * on the client (countdown chips, disabled buttons). Keeping it here means the
 * cards, the detail page and the transaction can never drift apart.
 *
 * Two rules this file exists to enforce:
 *  - **every function takes `now` explicitly** instead of calling `new Date()`,
 *    so it is testable and so a cached render can never bake in a stale clock;
 *  - the enums below are **mirrors** of the Prisma ones. Client components must
 *    never import `@/generated/prisma` (it would drag the client into the bundle).
 *
 * The membership flow (the owner's newest instruction) shows up here as two facts:
 * **occupancy is CONFIRMED** — a waitlisted row holds no seat, so «ظرفیت پر» is
 * about the seats people actually have — and a waitlisted row is never something
 * the player owes money for or gets punished for giving up.
 */

import { formatCount, formatToman, toPersianDigits } from "./format";
import {
  formatDuration,
  formatJalaliDate,
  formatJalaliDayMonth,
  formatJalaliWeekdayDate,
  formatTime,
  formatTimeRange,
} from "./jalali";

// ---------------------------------------------------------------------------
// Enum mirrors (keep in sync with prisma/schema.prisma)
// ---------------------------------------------------------------------------

export type SessionStatus = "DRAFT" | "PUBLISHED" | "CANCELED";
export type PaymentMode = "AT_REGISTRATION" | "IN_PERSON";
export type RegistrationStatus = "CONFIRMED" | "WAITLIST" | "CANCELED";
/** The account-level approval (the membership gate), mirrored from `User`. */
export type MembershipStatus = "PENDING" | "APPROVED" | "REJECTED";
export type PaymentStatus = "UNPAID" | "PAID_ONLINE" | "PAID_IN_PERSON" | "WAIVED" | "PAID_BALANCE";
export type AttendanceStatus = "PENDING" | "PRESENT" | "LATE" | "ABSENT";
/** The balance-ledger row kinds, mirrored from `BalanceEntryType`. */
export type BalanceEntryType = "REGISTRATION_DEDUCT" | "CANCEL_REFUND" | "ADMIN_ADJUST";

// ---------------------------------------------------------------------------
// Types shared by the queries (server) and the screens (both sides)
// ---------------------------------------------------------------------------

/** What the card/detail should say *right now* — derived, never stored. */
export type SessionStage =
  | "draft"
  | "upcoming"
  | "open"
  | "full"
  | "closed"
  | "running"
  | "finished"
  | "canceled";

export type MyRegistration = {
  status: RegistrationStatus;
  paymentStatus: PaymentStatus;
  /**
   * What **this seat** costs — the price snapshotted when it was taken, so a
   * later edit of the session's price never re-prices it. Every money line the
   * player reads («X از موجودیات کم شد · حضوری بده Y») is built from this column,
   * never from the session's current price.
   */
  amountToman: number;
  /** How much of `amountToman` came off the account's balance. */
  paidFromBalance: number;
  attendance: AttendanceStatus;
  /**
   * The minutes a `LATE` mark recorded (§۵.۵) — `null` on every other state. The
   * manager's mark stores it, so the ledger can say «تاخیر ۱۰ دقیقه» instead of a
   * bare «تاخیر».
   */
  lateMinutes: number | null;
  /** 1 = first in line. `null` unless `status === "WAITLIST"`. */
  waitlistPosition: number | null;
  /**
   * This seat came off the waitlist because somebody released a seat (§۵.۲) —
   * promoted straight into the hall, since the membership gate already vetted the
   * person. Always `false` on a fresh registration — the row that was revived
   * clears the column — so the screens can say «جات از لیست انتظار دراومد» about
   * *this* promotion only.
   */
  promoted: boolean;
  /**
   * The cancel rule in force **right now** for this seat. Filled by the screens
   * that actually offer the «لغو ثبت‌نام» control (`/my` and the session page),
   * because resolving it costs the settings row plus one penalty count and the
   * home board would pay for a verdict it never renders (`undefined` there).
   */
  cancel?: CancelVerdict | null;
};

export type SessionCard = {
  id: string;
  title: string;
  venueName: string;
  /** `addressOverride ?? venue.address` — already resolved by the query. */
  address: string;
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  capacity: number;
  priceToman: number;
  paymentMode: PaymentMode;
  status: SessionStatus;
  /**
   * Seats that are taken: `CONFIRMED` only. Occupancy is what «۸ از ۱۲ نفر» and
   * the full/open stage are about; a waitlisted row is not in the hall.
   */
  occupiedCount: number;
  waitlistCount: number;
  stage: SessionStage;
  /** The viewer's own registration, if any (never a canceled one). */
  myRegistration: MyRegistration | null;
};

export type Registrant = {
  /** The display name (the Eitaa name, or the name the player set). */
  name: string;
  /**
   * The player's **real** name (first + last, joined), or `null` until they
   * answer the follow-up first-run sheet. The manager is the reader that
   * matters; a roster falls back to `name` while this is empty.
   */
  fullName: string | null;
  isMe: boolean;
  status: RegistrationStatus;
  paymentStatus: PaymentStatus;
  attendance: AttendanceStatus;
  /**
   * The minutes a `LATE` mark recorded (§۵.۵) — `null` on every other state. The
   * manager's attendance control reads it back (it pre-fills the minute field),
   * and the roster can say «تاخیر ۱۰ دقیقه» instead of a bare «تاخیر».
   */
  lateMinutes: number | null;
  waitlistPosition: number | null;
  /**
   * Came off the waitlist (§۵.۲) — and landed straight in the hall. The roster
   * draws nothing with it; the viewer's own seat *is* one of these rows, and the
   * session page announces the promotion from it, so the fact travels with the row
   * instead of costing a second query.
   */
  promoted: boolean;
};

export type SessionDetail = SessionCard & {
  description: string | null;
  mapUrl: string | null;
  /** The cancel rules of *this* session (settings + overrides), one sentence each. */
  rulesSentences: string[];
  /** The same rules as one paragraph — for share messages and compact spots. */
  rulesText: string;
  confirmed: Registrant[];
  waitlist: Registrant[];
  /** The viewer's active ban, if they have one (blocks registration). */
  ban: { until: Date; reason: string } | null;
  /**
   * The viewer's own **balance** (تومان), so the register area can say «موجودیت:
   * X — هنگام ثبت‌نام خودکار ازش کم می‌شه» before the tap. `0` when nobody is
   * signed in; it is the viewer's own number, never somebody else's.
   */
  viewerBalance: number;
};

/**
 * One row of the manager's **membership** queue — the account-level approval (the
 * owner's newest round).
 *
 * Declared here, next to the other read shapes, so the admin screen can name it
 * without importing a `server-only` module; built by `listMembershipQueue`.
 */
export type MembershipRequest = {
  userId: string;
  eitaaId: string;
  /** The Eitaa/display name. */
  name: string;
  /** The real name pair, joined; `null` until the follow-up sheet is answered. */
  fullName: string | null;
  /** The contact number — the manager is the only reader. */
  phone: string | null;
  /** When the account first showed up — the queue order (oldest first). */
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// Cancel rules (§۵.۴) — settings row + optional per-session overrides
// ---------------------------------------------------------------------------

export type CancelRules = {
  freeCancelHours: number;
  lateCancelEnabled: boolean;
  lateCancelPenaltyDays: number;
  lateCancelFirstWarning: boolean;
  lateCancelWarningWindowDays: number;
  noShowEnabled: boolean;
  noShowPenaltyDays: number;
  lateStrikesEnabled: boolean;
  lateThresholdMinutes: number;
  lateStrikeCount: number;
  lateStrikeWindowDays: number;
  lateStrikePenaltyDays: number;
};

/** The same keys, nullable — exactly the `Session` override columns. */
export type CancelRuleOverrides = { [K in keyof CancelRules]: CancelRules[K] | null };

/** A session inherits every rule it does not override (empty = inherit). */
export function resolveCancelRules(base: CancelRules, overrides: CancelRuleOverrides): CancelRules {
  const resolved = { ...base };
  for (const key of Object.keys(base) as (keyof CancelRules)[]) {
    const value = overrides[key];
    if (value !== null && value !== undefined) {
      // The key set is identical on both sides, so this is safe by construction.
      (resolved[key] as CancelRules[keyof CancelRules]) = value as CancelRules[keyof CancelRules];
    }
  }
  return resolved;
}

/** «Inherit everything» — the overrides of a session that overrides nothing. */
export const NO_CANCEL_OVERRIDES: CancelRuleOverrides = {
  freeCancelHours: null,
  lateCancelEnabled: null,
  lateCancelPenaltyDays: null,
  lateCancelFirstWarning: null,
  lateCancelWarningWindowDays: null,
  noShowEnabled: null,
  noShowPenaltyDays: null,
  lateStrikesEnabled: null,
  lateThresholdMinutes: null,
  lateStrikeCount: null,
  lateStrikeWindowDays: null,
  lateStrikePenaltyDays: null,
};

/**
 * Factory defaults, mirroring the `@default(...)`s of the single `Setting` row in
 * `prisma/schema.prisma`. A safety net for the (impossible-in-practice) case of a
 * missing settings row — the database stays the source of truth for everything
 * the admin can edit.
 */
export const DEFAULT_CANCEL_RULES: CancelRules = {
  freeCancelHours: 12,
  lateCancelEnabled: true,
  lateCancelPenaltyDays: 3,
  lateCancelFirstWarning: true,
  lateCancelWarningWindowDays: 14,
  noShowEnabled: true,
  noShowPenaltyDays: 7,
  lateStrikesEnabled: true,
  lateThresholdMinutes: 15,
  lateStrikeCount: 3,
  lateStrikeWindowDays: 30,
  lateStrikePenaltyDays: 7,
};

/**
 * The rules, as sentences a player reads on the session page (§۵.۴).
 * Disabled rules are stated honestly instead of being hidden.
 */
export function cancelRuleSentences(rules: CancelRules): string[] {
  const sentences: string[] = [
    `تا ${toPersianDigits(rules.freeCancelHours)} ساعت به شروع سانس: انصراف آزاده.`,
  ];

  if (rules.lateCancelEnabled) {
    const first = rules.lateCancelFirstWarning
      ? `بار اول اخطار (تو ${toPersianDigits(rules.lateCancelWarningWindowDays)} روز)، بعدش `
      : "";
    sentences.push(
      `انصراف دیرهنگام: ${first}${toPersianDigits(rules.lateCancelPenaltyDays)} روز محرومیت.`,
    );
  } else {
    sentences.push("انصراف دیرهنگام جریمه نداره.");
  }

  if (rules.noShowEnabled) {
    sentences.push(
      `بدون انصراف نیومدن: ${toPersianDigits(rules.noShowPenaltyDays)} روز محرومیت.`,
    );
  }

  if (rules.lateStrikesEnabled) {
    sentences.push(
      `${toPersianDigits(rules.lateStrikeCount)} بار تاخیر تو ${toPersianDigits(
        rules.lateStrikeWindowDays,
      )} روز: ${toPersianDigits(rules.lateStrikePenaltyDays)} روز محرومیت.`,
    );
  }

  return sentences;
}

/** One paragraph version, for cards and share messages. */
export function cancelRulesText(rules: CancelRules): string {
  return cancelRuleSentences(rules).join(" ");
}

/**
 * The cancel rule in force **at this moment** («قانون همان لحظه»).
 * `16 hours before the start` with `freeCancelHours = 12` → free.
 */
export type CancelEffect = { kind: "FREE" | "LATE"; message: string };

export function cancelEffectNow(
  session: { startsAt: Date; rules: CancelRules },
  now: Date,
): CancelEffect {
  const hoursLeft = (session.startsAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursLeft >= session.rules.freeCancelHours) {
    return {
      kind: "FREE",
      message: `لغو آزاده — تا ${toPersianDigits(
        session.rules.freeCancelHours,
      )} ساعت به شروع سانس، بدون جریمه انصراف بده.`,
    };
  }

  if (!session.rules.lateCancelEnabled) {
    return { kind: "LATE", message: "لغو دیرهنگامه، ولی جریمه‌ای ثبت نمی‌شه." };
  }

  const base = session.rules.lateCancelFirstWarning
    ? `با ${toPersianDigits(
        session.rules.lateCancelWarningWindowDays,
      )} روز مهلت: اگه اولین انصراف دیرهنگامت تو این بازه باشه، فقط اخطار می‌گیری؛ وگرنه ${toPersianDigits(
        session.rules.lateCancelPenaltyDays,
      )} روز محروم می‌شی.`
    : `${toPersianDigits(session.rules.lateCancelPenaltyDays)} روز محروم می‌شی.`;

  return { kind: "LATE", message: `لغو دیرهنگام (کمتر از ${toPersianDigits(session.rules.freeCancelHours)} ساعت به شروع): ${base}` };
}

/**
 * The verdict the «لغو ثبت‌نام» confirm dialog leads with (§۵.۴, phase ۴).
 *
 * `cancelEffectNow` above answers "free or late?" — enough for a rules list, not
 * enough for a dialog that is about to write a ban: «بار اول اخطار» is a fact
 * about the *player* (their late cancels inside the window), not about the
 * session, so it is passed in and the kind names the three honest outcomes.
 * The server action resolves the same verdict from the same helper, so what the
 * player confirmed is what the engine writes.
 */
export type CancelVerdictKind = "FREE" | "LATE_PARDONED" | "LATE_WARNING" | "LATE_PENALTY";

export type CancelVerdict = {
  kind: CancelVerdictKind;
  /** Days the engine will write for this cancel; `0` for free / warning / pardoned. */
  penaltyDays: number;
  /** One line the dialog leads with. */
  headline: string;
  /** The rule in force at this moment, spelled out. */
  detail: string;
};

export function cancelVerdictNow(input: {
  startsAt: Date;
  rules: CancelRules;
  now: Date;
  /** The player's late cancels inside `lateCancelWarningWindowDays`, right now. */
  lateCancelsInWindow: number;
}): CancelVerdict {
  const { rules, now } = input;
  const effect = cancelEffectNow({ startsAt: input.startsAt, rules }, now);

  if (effect.kind === "FREE") {
    return { kind: "FREE", penaltyDays: 0, headline: "لغو آزاده", detail: effect.message };
  }

  if (!rules.lateCancelEnabled) {
    return {
      kind: "LATE_PARDONED",
      penaltyDays: 0,
      headline: "لغو دیرهنگام — بدون جریمه",
      detail: effect.message,
    };
  }

  const hoursLeft = `کمتر از ${toPersianDigits(rules.freeCancelHours)} ساعت به شروع سانس`;

  if (rules.lateCancelFirstWarning && input.lateCancelsInWindow === 0) {
    return {
      kind: "LATE_WARNING",
      penaltyDays: 0,
      headline: "اخطار اول — بدون محرومیت",
      detail: `این انصراف دیرهنگامه (${hoursLeft}). چون اولین انصراف دیرهنگامت تو ${toPersianDigits(
        rules.lateCancelWarningWindowDays,
      )} روز گذشته بوده، فقط اخطار ثبت می‌شه — محرومیتی نداری.`,
    };
  }

  const days = rules.lateCancelPenaltyDays;
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  return {
    kind: "LATE_PENALTY",
    penaltyDays: days,
    headline: `${toPersianDigits(days)} روز محرومیت`,
    detail: `این انصراف دیرهنگامه (${hoursLeft}) و ${toPersianDigits(
      days,
    )} روز محرومیت داره — تا ${formatJalaliDate(until)} نمی‌تونی تو هیچ سانسی ثبت‌نام کنی.`,
  };
}

/**
 * Whether a live seat can still be given up. A started session has moved on to
 * attendance (the penalty engine of §۵.۵), and a manager-canceled one has already
 * released everyone — neither takes a cancel tap. A `CANCELED` row is gone.
 *
 * Takes any row that carries a `status` — the viewer's `MyRegistration` and a
 * roster `Registrant` alike — because that is the only fact the answer needs.
 */
export function canCancelNow(
  session: { status: SessionStatus; startsAt: Date },
  my: { status: RegistrationStatus } | null,
  now: Date,
): boolean {
  if (!my || my.status === "CANCELED") return false;
  if (session.status !== "PUBLISHED") return false;
  return now.getTime() < session.startsAt.getTime();
}

/**
 * The verdict for giving up a place in the **waitlist**.
 *
 * A waitlisted row never held a seat — the hall was full when it asked — so its
 * cancel frees nothing and never entered the penalty engine: the window, the
 * warning and the ban do not apply to it. `cancelSeat` returns this very
 * function's value for a `WAITLIST` row and writes no `Penalty` row at all, so
 * the sentence the dialog showed is the sentence the engine honors.
 */
export function waitlistCancelVerdict(): CancelVerdict {
  return {
    kind: "FREE",
    penaltyDays: 0,
    headline: "لغو بدون جریمه",
    detail: "تو لیست انتظار بودی و جایی نگرفته بودی — لغوت جریمه نداره.",
  };
}

/**
 * Money still owed for a live seat on the (mock) gateway (§۵.۳).
 *
 * `CONFIRMED` is the only status that pays. A **waitlisted** player owes nothing:
 * the seat is not theirs until somebody releases one and the promotion moves the
 * row into the hall — `payForRegistration` refuses a waitlisted row, so this
 * function and the engine cannot disagree.
 */
export function needsPayment(
  session: { paymentMode: PaymentMode },
  my: MyRegistration | null,
): boolean {
  return (
    session.paymentMode === "AT_REGISTRATION" &&
    my !== null &&
    my.status === "CONFIRMED" &&
    my.paymentStatus === "UNPAID"
  );
}

/** «تا جات نشه پرداختی لازم نیست» — the one sentence for an unpaid waitlist seat. */
export const NOTHING_OWED_YET = "تا جات نشه پرداختی لازم نیست";

/**
 * Whether money actually changed hands for a seat — the states that came from a
 * real settlement. `WAIVED` is *not* paid (the manager decided nothing is owed)
 * and `UNPAID` is not either, so the cancel dialog only promises a refund when
 * there is something to send back to the balance. `PAID_BALANCE` **is** paid: it
 * came off the account's own balance at registration time.
 */
export function isPaidSeat(status: PaymentStatus): boolean {
  return status === "PAID_ONLINE" || status === "PAID_IN_PERSON" || status === "PAID_BALANCE";
}

// ---------------------------------------------------------------------------
// Derived stage & labels
// ---------------------------------------------------------------------------

/**
 * The derived stage of a slot.
 *
 * `occupiedCount` decides «ظرفیت پر»: it is the seats people hold (`CONFIRMED`)
 * — a waitlisted row is not in the hall, and the caller counts after the session
 * lock.
 */
export function sessionStage(
  input: {
    status: SessionStatus;
    startsAt: Date;
    endsAt: Date;
    registrationOpensAt: Date;
    registrationClosesAt: Date;
    capacity: number;
    occupiedCount: number;
  },
  now: Date,
): SessionStage {
  if (input.status === "CANCELED") return "canceled";
  if (input.status === "DRAFT") return "draft";

  const t = now.getTime();
  if (t >= input.endsAt.getTime()) return "finished";
  if (t >= input.startsAt.getTime()) return "running";
  if (t < input.registrationOpensAt.getTime()) return "upcoming";
  if (t >= input.registrationClosesAt.getTime()) return "closed";
  return input.occupiedCount >= input.capacity ? "full" : "open";
}

/** Whether the player may tap «ثبت‌نام» right now. */
export function stageAllowsRegistration(stage: SessionStage): boolean {
  return stage === "open" || stage === "full";
}

/**
 * The wording is fixed by `DESIGN_SYSTEM.md` («وضعیت واژگان ثابت») — never invent
 * a synonym for a stage, or the same state will read differently on two screens.
 */
const STAGE_LABELS: Record<SessionStage, string> = {
  draft: "پیش‌نویس",
  upcoming: "به‌زودی",
  open: "در حال ثبت‌نام",
  full: "ظرفیت پر — لیست انتظار",
  closed: "ثبت‌نام بسته شده",
  running: "در حال برگزاری",
  finished: "برگزار شده",
  canceled: "لغو شده",
};

export function stageLabel(stage: SessionStage): string {
  return STAGE_LABELS[stage];
}

/**
 * The `Badge` variant for a stage — the same vocabulary as the badge table in
 * `DESIGN_SYSTEM.md` §6: «در حال ثبت‌نام» green, «به‌زودی» brand, «ظرفیت پر»
 * sunken, «لغو شده» red, quiet states on `outline`.
 * Colour is never the only cue: the badge always carries this label too.
 */
export type StageBadgeVariant = "default" | "success" | "secondary" | "destructive" | "outline";

export function stageBadgeVariant(stage: SessionStage): StageBadgeVariant {
  switch (stage) {
    case "open":
      return "success";
    case "upcoming":
    case "running":
      return "default";
    case "full":
    case "closed":
      return "secondary";
    case "canceled":
      return "destructive";
    default:
      return "outline";
  }
}

/** `۸ از ۱۲ نفر` — occupied seats (`CONFIRMED`) against the capacity. */
export function capacityLabel(occupiedCount: number, capacity: number): string {
  return `${toPersianDigits(occupiedCount)} از ${toPersianDigits(capacity)} نفر`;
}

/** `۲ نفر در لیست انتظار` */
export function waitlistLabel(count: number): string {
  return `${formatCount(count, "نفر")} در لیست انتظار`;
}

/** `جای تو در لیست انتظار: ۳` */
export function waitlistPositionLabel(position: number): string {
  return `جای تو در لیست انتظار: ${toPersianDigits(position)}`;
}

/** `شنبه ۲۵ مهر · ۲۰:۰۰ تا ۲۱:۳۰` */
export function sessionTimeLabel(startsAt: Date, endsAt: Date): string {
  return `${formatJalaliDayMonth(startsAt)} · ${formatTimeRange(startsAt, endsAt)}`;
}

/** `شنبه ۲۵ مهر ۱۴۰۵ · ۲۰:۰۰ تا ۲۱:۳۰` */
export function sessionFullTimeLabel(startsAt: Date, endsAt: Date): string {
  return `${formatJalaliWeekdayDate(startsAt)} · ${formatTimeRange(startsAt, endsAt)}`;
}

/** «ثبت‌نام از پنجشنبه ۲۳ مهر ۲۱:۰۰ شروع می‌شه — ۱ روز و ۴ ساعت دیگر» */
export function registrationOpensLabel(registrationOpensAt: Date, now: Date): string {
  const left = registrationOpensAt.getTime() - now.getTime();
  const when = `${formatJalaliDayMonth(registrationOpensAt)} ساعت ${formatTime(registrationOpensAt)}`;
  return `ثبت‌نام از ${when} شروع می‌شه — ${formatDuration(left)} دیگر`;
}

/** «ثبت‌نام تا پنجشنبه ۲۳ مهر ساعت ۲۱:۰۰ باز است — ۱ روز و ۴ ساعت دیگر» */
export function registrationClosesLabel(registrationClosesAt: Date, now: Date): string {
  const left = registrationClosesAt.getTime() - now.getTime();
  if (left <= 0) return "ثبت‌نام بسته شده.";
  const when = `${formatJalaliDayMonth(registrationClosesAt)} ساعت ${formatTime(registrationClosesAt)}`;
  return `ثبت‌نام تا ${when} باز است — ${formatDuration(left)} دیگر`;
}

/** How the viewer should read a price + its payment state (§۵.۳). */
export function paymentLabel(
  priceToman: number,
  mode: PaymentMode,
  status: PaymentStatus,
): string {
  const money = formatToman(priceToman);
  switch (status) {
    case "PAID_ONLINE":
      return `${money} آنلاین پرداخت شده`;
    case "PAID_IN_PERSON":
      return `${money} حضوری — دریافت شده`;
    case "PAID_BALANCE":
      return `${money} از موجودی پرداخت شده`;
    case "WAIVED":
      return `${money} — پرداخت لازم نیست`;
    default:
      return mode === "AT_REGISTRATION"
        ? `${money} — در انتظار پرداخت`
        : `${money} حضوری — دریافت نشده`;
  }
}

/**
 * The player's **real** name, joined from the pair the first-run sheet collected
 * (`User.firstName` / `User.lastName`), or `null` while they have not answered.
 *
 * One-part-only names are real (a person may have typed only a first name), so an
 * empty half is dropped rather than rendered as a stray space; `null` means "ask
 * them", not "they have no name", which is why the rosters fall back to the
 * display name instead of printing nothing.
 */
export function fullNameOf(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const parts = [firstName, lastName]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0);

  return parts.length > 0 ? parts.join(" ") : null;
}

/** Short form for the session card: how one pays. */
export function paymentModeLabel(mode: PaymentMode): string {
  return mode === "AT_REGISTRATION" ? "پرداخت آنلاین هنگام ثبت‌نام" : "پرداخت حضوری";
}
