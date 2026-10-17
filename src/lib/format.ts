/**
 * Persian display formatting — the single source of truth for digits, money and
 * text normalization. Components must never inline-format these themselves.
 *
 * Rules (see `.opencode/skills/persian-rtl-ui`):
 * - User-facing numbers are always Persian digits.
 * - Never mix Latin and Persian digits on one line.
 * - Stored/transported values stay Latin; only the rendered string converts.
 */

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

/** `1405` → `۱۴۰۵`. Non-digits (separators, signs) pass through unchanged. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** `۱۴۰۵` → `1405`. Also converts Arabic-Indic digits. */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Normalizes Persian text the way a Persian keyboard would produce it:
 * Arabic `ي`/`ك`/`ة` → Persian `ی`/`ک`/`ه`, Arabic-Indic digits → Persian digits,
 * and stray tatweel removed. Use on any user-entered text before storing it.
 */
export function normalizePersianText(input: string): string {
  return input
    .replace(/\u064A/g, "\u06CC") // ي → ی
    .replace(/\u0643/g, "\u06A9") // ك → ک
    .replace(/\u0629/g, "\u0647") // ة → ه
    .replace(/\u0640/g, "") // remove tatweel
    .replace(/[٠-٩]/g, (d) => PERSIAN_DIGITS[d.charCodeAt(0) - 0x0660])
    .replace(/\s+/g, " ")
    .trim();
}

/** Persian digits are the default; pass `{ latin: true }` for `<input>` values. */
export function formatNumber(value: number, options: { latin?: boolean } = {}): string {
  const grouped = new Intl.NumberFormat("en-US").format(value);
  return options.latin ? grouped : toPersianDigits(grouped);
}

/**
 * `45000` → `۴۵٬۰۰۰ تومان`. Uses the Persian thousands separator (٫ U+066C is the
 * decimal separator in Persian, but grouping uses the Arabic thousands separator).
 */
export function formatToman(value: number, options: { withUnit?: boolean } = {}): string {
  const { withUnit = true } = options;
  const grouped = new Intl.NumberFormat("en-US").format(value).replace(/,/g, "\u066C");
  const digits = toPersianDigits(grouped);
  return withUnit ? `${digits} تومان` : digits;
}

/** Counts with a unit word: `formatCount(8, "نفر")` → `۸ نفر`. */
export function formatCount(value: number, unit?: string): string {
  const digits = toPersianDigits(formatNumber(value, { latin: true }).replace(/,/g, "\u066C"));
  return unit ? `${digits} ${unit}` : digits;
}

/** `15` → `۱۵ دقیقه`; also used for the late-attendance marker. */
export function formatMinutes(value: number): string {
  return `${toPersianDigits(value)} دقیقه`;
}

/**
 * Percentage for the capacity rail: `formatPercent(8, 12)` → `۶۷٪`
 * (returns `۰٪` instead of dividing by zero).
 */
export function formatPercent(part: number, total: number): string {
  if (total <= 0) return `${PERSIAN_DIGITS[0]}\u066A`;
  return `${toPersianDigits(Math.round((part / total) * 100))}\u066A`;
}
