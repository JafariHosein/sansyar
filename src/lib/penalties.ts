/**
 * Penalties and bans — the vocabulary shared by the engine and the screens
 * (PROMPT.md §۵.۶).
 *
 * Deliberately pure. The *writes* live in the server actions (the cancel engine
 * now, the attendance engine in phase ۵, the admin panel in phase ۶) and the
 * *reads* in `src/server/penalties.ts`; this module only names things, so a
 * warning, an active ban and a served sentence read identically on the profile,
 * in the ban card and in a toast.
 *
 * Vocabulary (`DESIGN_SYSTEM.md` §۲): «اخطار» is a penalty with `days = 0` — a row
 * in history that never closes a door. «محرومیت» is `days > 0` and has a window
 * (`startsAt … endsAt`).
 */

import { toPersianDigits } from "./format";
import { formatJalaliDate } from "./jalali";

/** Mirror of the Prisma `PenaltyType` enum (never import generated Prisma here). */
export type PenaltyType = "LATE_CANCEL" | "NO_SHOW" | "LATE_STRIKES" | "MANUAL";

const PENALTY_TYPE_LABELS: Record<PenaltyType, string> = {
  LATE_CANCEL: "انصراف دیرهنگام",
  NO_SHOW: "غیبت بدون انصراف",
  LATE_STRIKES: "تکرار تاخیر",
  MANUAL: "محرومیت دستی",
};

export function penaltyTypeLabel(type: PenaltyType): string {
  return PENALTY_TYPE_LABELS[type];
}

/** «اخطار — بدون محرومیت» · «۳ روز محرومیت» */
export function penaltyDaysLabel(days: number): string {
  return days <= 0 ? "اخطار — بدون محرومیت" : `${toPersianDigits(days)} روز محرومیت`;
}

/** How one history row reads today. */
export type PenaltyState = "ACTIVE" | "SERVED" | "WAIVED" | "WARNING";

export function penaltyState(
  penalty: { days: number; endsAt: Date; waivedAt: Date | null },
  now: Date,
): PenaltyState {
  if (penalty.days <= 0) return "WARNING";
  if (penalty.waivedAt) return "WAIVED";
  return penalty.endsAt.getTime() > now.getTime() ? "ACTIVE" : "SERVED";
}

const PENALTY_STATE_LABELS: Record<PenaltyState, string> = {
  ACTIVE: "در جریان",
  SERVED: "تموم‌شده",
  WAIVED: "بخشیده",
  WARNING: "اخطار",
};

export function penaltyStateLabel(state: PenaltyState): string {
  return PENALTY_STATE_LABELS[state];
}

/**
 * «۲ روز دیگر» · «کمتر از یک روز دیگر» — the remaining part of a ban sentence.
 * Ceil, because "۲ روز دیگر" must not read as "۱ روز" while 25 hours are left.
 */
export function banRemainingLabel(until: Date, now: Date): string {
  const left = until.getTime() - now.getTime();
  if (left <= 0) return "به‌زودی تموم می‌شه";
  const days = Math.ceil(left / 86_400_000);
  if (days <= 1) return "کمتر از یک روز دیگر";
  return `${toPersianDigits(days)} روز دیگر`;
}

/**
 * «۲ روز دیگر» alone is not a ban sentence and a bare end date is not either;
 * every ban surface (alert, ban card, toast) composes both through this.
 */
export function banSentence(until: Date, now: Date): string {
  return `تا ${formatJalaliDate(until)} (${banRemainingLabel(until, now)})`;
}
