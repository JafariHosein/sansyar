/**
 * Verification for `src/lib/format.ts` and `src/lib/jalali.ts`.
 *
 * Run with `npm run check:dates`. A `tsx` runner is used so the script imports
 * the real source files (no duplicated logic, no build step).
 */
import {
  formatCount,
  formatPercent,
  formatToman,
  normalizePersianText,
  toLatinDigits,
  toPersianDigits,
} from "../src/lib/format";
import {
  formatDuration,
  formatJalaliDate,
  formatJalaliDateTime,
  formatJalaliNumeric,
  formatJalaliDayMonth,
  formatJalaliWeekdayDate,
  formatRelativeFa,
  formatTime,
  formatTimeRange,
  jalaliDateTimeToUtc,
  jalaliMonthGrid,
  tehranWallClock,
  toJalaliDateTime,
} from "../src/lib/jalali";

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
  }
}

function group(name: string): void {
  console.log(`\n${name}`);
}

group("digits & money");
check("toPersianDigits(1405)", toPersianDigits(1405), "۱۴۰۵");
check("toPersianDigits keeps separators", toPersianDigits("12:30"), "۱۲:۳۰");
check("toLatinDigits round-trips", toLatinDigits(toPersianDigits(987654)), "987654");
check("normalizePersianText arabic ye/kaf", normalizePersianText("يك ك"), "یک ک");
check("normalizePersianText collapses spaces", normalizePersianText("مهدی   هاشمی "), "مهدی هاشمی");
check("formatToman(45000)", formatToman(45000), "۴۵٬۰۰۰ تومان");
check("formatToman(0)", formatToman(0), "۰ تومان");
check("formatCount(8, نفر)", formatCount(8, "نفر"), "۸ نفر");
check("formatPercent(8, 12)", formatPercent(8, 12), "۶۷٪");
check("formatPercent(1, 0) is safe", formatPercent(1, 0), "۰٪");

group("Tehran wall clock");
// 2026-10-16T18:00:00Z is 21:30 on Friday 2026-10-16 in Tehran (+03:30).
const evening = new Date("2026-10-16T18:00:00.000Z");
const eveningWall = tehranWallClock(evening);
check("wall date", [eveningWall.gy, eveningWall.gm, eveningWall.gd], [2026, 10, 16]);
check("wall time", [eveningWall.hour, eveningWall.minute], [21, 30]);
check("weekday index (Friday = 6)", eveningWall.weekdayIndex, 6);

group("Jalali conversion");
// Hand-computed: 1405/01/01 = 2026-03-21, so 2026-10-16 = 1405/07/24.
const jalali = toJalaliDateTime(evening);
check("2026-10-16 → 1405/07/24", [jalali.jy, jalali.jm, jalali.jd], [1405, 7, 24]);
check("time preserved", [jalali.hour, jalali.minute], [21, 30]);
// Nowruz 1405 = Saturday 2026-03-21 ⇒ weekdayIndex 0 (شنبه).
check("nowruz anchor", JSON.stringify(toJalaliDateTime(new Date("2026-03-21T09:00:00.000Z"))), JSON.stringify({ jy: 1405, jm: 1, jd: 1, hour: 12, minute: 30, weekdayIndex: 0 }));

group("Jalali → UTC (admin form input)");
check(
  "21:30 Tehran → 18:00Z",
  jalaliDateTimeToUtc(1405, 7, 24, 21, 30).toISOString(),
  "2026-10-16T18:00:00.000Z",
);
check(
  "midnight Tehran is the previous UTC day",
  jalaliDateTimeToUtc(1405, 7, 24, 0, 0).toISOString(),
  "2026-10-15T20:30:00.000Z",
);
// Round-trip across a full Jalali year, hour by hour (catches DST/offset drift).
let roundTripOk = true;
for (let day = 0; day < 365; day += 1) {
  const source = new Date(Date.UTC(2026, 2, 21, 12, 0) + day * 86_400_000);
  const value = toJalaliDateTime(source);
  const back = jalaliDateTimeToUtc(value.jy, value.jm, value.jd, value.hour, value.minute);
  if (back.getTime() !== source.getTime()) roundTripOk = false;
}
check("365-day UTC↔Jalali round-trip", roundTripOk, true);

group("formatting");
check("formatTime", formatTime(evening), "۲۱:۳۰");
check("formatTimeRange", formatTimeRange(evening, new Date("2026-10-16T19:00:00.000Z")), "۲۱:۳۰ تا ۲۲:۳۰");
check("formatJalaliDate", formatJalaliDate(evening), "۲۴ مهر ۱۴۰۵");
check("formatJalaliNumeric", formatJalaliNumeric(evening), "۱۴۰۵/۰۷/۲۴");
check("formatJalaliDayMonth", formatJalaliDayMonth(evening), "جمعه ۲۴ مهر");
check("formatJalaliWeekdayDate", formatJalaliWeekdayDate(evening), "جمعه ۲۴ مهر ۱۴۰۵");
check("formatJalaliDateTime", formatJalaliDateTime(evening), "۲۴ مهر ۱۴۰۵ · ۲۱:۳۰");
check("formatDuration(2d 4h)", formatDuration((2 * 24 + 4) * 3_600_000), "۲ روز و ۴ ساعت");
check("formatDuration(90m)", formatDuration(90 * 60_000), "۱ ساعت و ۳۰ دقیقه");
check("formatDuration(0)", formatDuration(0), "۰ دقیقه");
check("formatRelativeFa(+3h)", formatRelativeFa(new Date("2026-10-16T21:00:00.000Z"), evening), "۳ ساعت دیگر");
check("formatRelativeFa(-2d)", formatRelativeFa(new Date("2026-10-14T18:00:00.000Z"), evening), "۲ روز پیش");

group("month grid");
const grid = jalaliMonthGrid(1405, 7);
check("7 columns", grid.every((week) => week.length === 7), true);
check("Mehr has 30 days", grid.flat().filter((cell) => cell.inMonth).length, 30);
check("grid starts on شنبه", grid[0][0].weekdayIndex, 0);
check("first in-month cell is 1 Mehr", grid.flat().filter((c) => c.inMonth)[0].jd, 1);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
