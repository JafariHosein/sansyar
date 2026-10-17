import { jalaaliMonthLength, toGregorian, toJalaali } from "jalaali-js";

import { toPersianDigits } from "./format";

/**
 * Jalali (Solar Hijri) calendar helpers for the `Asia/Tehran` time zone.
 *
 * Contract (matches `PROMPT.md` §4): **every date is stored and transported in
 * UTC**. Tehran wall-clock is only ever computed at display time, and Jalali
 * only exists in the presentation layer.
 *
 * `jalaali-js` reads the *local* Y/M/D of a `Date`, which on a UTC server would
 * be the wrong calendar day. So we never hand it a `Date`: we first resolve the
 * Tehran wall-clock components with `Intl`, then convert those numbers.
 */

export const TEHRAN_TIME_ZONE = "Asia/Tehran";

export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;

/** Saturday-first, matching the Persian week. Index 0 = شنبه. */
export const JALALI_WEEKDAYS = [
  "شنبه",
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنجشنبه",
  "جمعه",
] as const;

export type TehranWallClock = {
  /** Gregorian year/month/day as seen on a Tehran wall clock. */
  gy: number;
  gm: number;
  gd: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = شنبه … 6 = جمعه */
  weekdayIndex: number;
};

const wallClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TEHRAN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Resolves the Tehran wall-clock components of an instant. */
export function tehranWallClock(date: Date): TehranWallClock {
  const parts = wallClockFormatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  // `hourCycle` can yield "24" for midnight; normalize it.
  const hour = read("hour") % 24;
  const gy = read("year");
  const gm = read("month");
  const gd = read("day");
  const weekdayIndex = (new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay() + 1) % 7;

  return { gy, gm, gd, hour, minute: read("minute"), second: read("second"), weekdayIndex };
}

/** Offset of Asia/Tehran from UTC at a given instant, in milliseconds. */
function tehranOffsetMs(instant: Date): number {
  const { gy, gm, gd, hour, minute, second } = tehranWallClock(instant);
  const asUtc = Date.UTC(gy, gm - 1, gd, hour, minute, second);
  return asUtc - instant.getTime();
}

/**
 * Converts a Tehran wall-clock Gregorian time to the UTC instant it denotes.
 * Two passes so a DST boundary (historical dates) still lands correctly.
 */
export function tehranWallClockToUtc(
  gy: number,
  gm: number,
  gd: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const naive = Date.UTC(gy, gm - 1, gd, hour, minute, second);
  const firstPass = new Date(naive - tehranOffsetMs(new Date(naive)));
  return new Date(naive - tehranOffsetMs(firstPass));
}

export type JalaliDateTime = {
  jy: number;
  jm: number;
  jd: number;
  hour: number;
  minute: number;
  /** 0 = شنبه … 6 = جمعه */
  weekdayIndex: number;
};

/** An instant → the Jalali date/time a user in Tehran would read. */
export function toJalaliDateTime(date: Date): JalaliDateTime {
  const wall = tehranWallClock(date);
  const { jy, jm, jd } = toJalaali(wall.gy, wall.gm, wall.gd);
  return { jy, jm, jd, hour: wall.hour, minute: wall.minute, weekdayIndex: wall.weekdayIndex };
}

/**
 * The inverse: a Jalali date/time **as read in Tehran** → the UTC instant.
 * Used by admin forms (which collect Jalali input) before writing to the DB.
 */
export function jalaliDateTimeToUtc(
  jy: number,
  jm: number,
  jd: number,
  hour = 0,
  minute = 0,
): Date {
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  return tehranWallClockToUtc(gy, gm, gd, hour, minute);
}

export { isValidJalaaliDate, jalaaliMonthLength } from "jalaali-js";

const pad2 = (value: number) => String(value).padStart(2, "0");

/** `۲۱:۳۰` */
export function formatTime(date: Date): string {
  const { hour, minute } = tehranWallClock(date);
  return toPersianDigits(`${pad2(hour)}:${pad2(minute)}`);
}

/** `۱۵ مهر ۱۴۰۵` */
export function formatJalaliDate(date: Date): string {
  const { jy, jm, jd } = toJalaliDateTime(date);
  return `${toPersianDigits(jd)} ${JALALI_MONTHS[jm - 1]} ${toPersianDigits(jy)}`;
}

/** `شنبه ۱۵ مهر` — no year, for "today"/"tomorrow" style rows. */
export function formatJalaliDayMonth(date: Date): string {
  const { jm, jd, weekdayIndex } = toJalaliDateTime(date);
  return `${JALALI_WEEKDAYS[weekdayIndex]} ${toPersianDigits(jd)} ${JALALI_MONTHS[jm - 1]}`;
}

/** `شنبه ۱۵ مهر ۱۴۰۵` */
export function formatJalaliWeekdayDate(date: Date): string {
  const { weekdayIndex } = toJalaliDateTime(date);
  return `${JALALI_WEEKDAYS[weekdayIndex]} ${formatJalaliDate(date)}`;
}

/** `۱۴۰۵/۰۷/۱۵` — compact, for tables and form summaries. */
export function formatJalaliNumeric(date: Date): string {
  const { jy, jm, jd } = toJalaliDateTime(date);
  return toPersianDigits(`${jy}/${pad2(jm)}/${pad2(jd)}`);
}

/** `۱۵ مهر ۱۴۰۵ · ۲۱:۳۰` */
export function formatJalaliDateTime(date: Date): string {
  return `${formatJalaliDate(date)} · ${formatTime(date)}`;
}

/** `۲۱:۳۰ تا ۲۲:۳۰` — for a session's start/end. */
export function formatTimeRange(startsAt: Date, endsAt: Date): string {
  return `${formatTime(startsAt)} تا ${formatTime(endsAt)}`;
}

/**
 * Human-readable duration, e.g. `formatDuration(ms)` → `۲ روز و ۴ ساعت`.
 * Used by the registration-window countdown. Returns `۰ دقیقه` for `ms <= 0`.
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return `${toPersianDigits(0)} دقیقه`;
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${toPersianDigits(days)} روز`);
  if (hours > 0 && days < 3) parts.push(`${toPersianDigits(hours)} ساعت`);
  if (minutes > 0 && days === 0) parts.push(`${toPersianDigits(minutes)} دقیقه`);
  return parts.join(" و ");
}

/**
 * `۳ روز پیش` / `۲ ساعت دیگر` / `امروز، ۲۱:۳۰`.
 * Pass `now` explicitly in tests.
 */
export function formatRelativeFa(date: Date, now: Date = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const absMinutes = Math.abs(diffMs) / 60_000;
  const isFuture = diffMs > 0;
  const suffix = isFuture ? "دیگر" : "پیش";

  if (absMinutes < 1) return "همین حالا";
  if (absMinutes < 60) {
    return `${toPersianDigits(Math.round(absMinutes))} دقیقه ${suffix}`;
  }
  if (absMinutes < 1440) {
    return `${toPersianDigits(Math.round(absMinutes / 60))} ساعت ${suffix}`;
  }
  if (absMinutes < 4320) {
    return `${toPersianDigits(Math.round(absMinutes / 1440))} روز ${suffix}`;
  }
  return isFuture ? formatJalaliDate(date) : `${formatJalaliDate(date)}`;
}

export type JalaliMonthCell = {
  jy: number;
  jm: number;
  jd: number;
  /** 0 = شنبه … 6 = جمعه */
  weekdayIndex: number;
  /** Whether the cell belongs to the month being displayed. */
  inMonth: boolean;
};

/**
 * A Saturday-first month grid for the admin Jalali date picker.
 * `jalaaliToDateObject` would read the host time zone, so weekday is derived
 * from the Gregorian day number instead (time-zone independent).
 */
export function jalaliMonthGrid(jy: number, jm: number): JalaliMonthCell[][] {
  const length = jalaaliMonthLength(jy, jm);
  const { gy, gm, gd } = toGregorian(jy, jm, 1);
  const firstWeekday = (new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay() + 1) % 7;

  const cells: JalaliMonthCell[] = [];
  for (let i = firstWeekday; i > 0; i -= 1) {
    const previous = jm === 1 ? { jy: jy - 1, jm: 12 } : { jy, jm: jm - 1 };
    const previousLength = jalaaliMonthLength(previous.jy, previous.jm);
    const jd = previousLength - i + 1;
    cells.push({
      ...previous,
      jd,
      weekdayIndex: (firstWeekday - i) % 7,
      inMonth: false,
    });
  }
  for (let jd = 1; jd <= length; jd += 1) {
    cells.push({ jy, jm, jd, weekdayIndex: (firstWeekday + jd - 1) % 7, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const offset = cells.length - (firstWeekday + length);
    const next = jm === 12 ? { jy: jy + 1, jm: 1 } : { jy, jm: jm + 1 };
    cells.push({ ...next, jd: offset + 1, weekdayIndex: cells.length % 7, inMonth: false });
  }

  const weeks: JalaliMonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
