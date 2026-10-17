/**
 * The player's contact number — the one thing Eitaa's `initData` cannot give us.
 *
 * Pure and importable from **both** sides of the wire on purpose: the first-run
 * sheet, the profile dialog and the server action all use these functions, so
 * the field can never restate a rule the action checks differently.
 *
 * This is **not** an identity. There is still no SMS panel, no OTP and no
 * number-based login anywhere in the product (`AGENTS.md` §What this is): the
 * number is a contact detail, stored on the account, editable from the profile
 * and rendered **to the manager only**.
 */

import { z } from "zod";

import { toLatinDigits, toPersianDigits } from "@/lib/format";

/** What a stored number looks like: 11 Latin digits, `09…` — nothing else. */
const STORED_PATTERN = /^09\d{9}$/;

/**
 * The single sentence a bad number gets: the input prints it under itself and
 * the server action returns it as-is, so the wording exists exactly once.
 */
export const PHONE_ERROR = "شماره‌ی همراهت رو کامل بنویس — مثل ۰۹۱۲۳۴۵۶۷۸۹";

/** What the profile shows while the account has not answered yet. */
export const PHONE_EMPTY_LABEL = "ثبت نشده";

/**
 * `۰۹۱۲ ۳۴۵-۶۷۸۹`, `+98 912 345 6789`, `0098912…`, `9123456789` →
 * `09123456789`.
 *
 * Returns `null` for anything that is not a complete mobile number, so every
 * caller tests one shape (`=== null`) instead of keeping a regex of its own.
 * Persian and Arabic-Indic digits are accepted because that is what a Persian
 * keyboard produces, and separators are stripped because people paste numbers
 * out of their contacts.
 */
export function normalizePhone(input: string): string | null {
  // Digits first: every rule below works on Latin digits only. `\u200c` is the
  // نیم‌فاصله, which sneaks in when a number is copy-pasted out of Persian text.
  let digits = toLatinDigits(input).replace(/[\s\-.()+\u200c]/g, "");

  // The four shapes the same Iranian mobile number is written in, in the order
  // that keeps them from overlapping: `0098…` → `09…`, `+98…`/`98…` → `09…`,
  // and a bare `9…` gets the leading zero it is missing.
  if (digits.startsWith("0098")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("98") && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.startsWith("9") && digits.length === 10) digits = `0${digits}`;

  return STORED_PATTERN.test(digits) ? digits : null;
}

/**
 * `09123456789` → `۰۹۱۲۳۴۵۶۷۸۹`; an empty account → «ثبت نشده».
 *
 * One unbroken run of Persian digits: the font's **proportional** figures
 * (`globals.css` §Numerals — never `tabular-nums`), which is also why the
 * number is not grouped into blocks here.
 */
export function formatPhoneForDisplay(value: string | null): string {
  if (!value) return PHONE_EMPTY_LABEL;
  // A stored value is already normalized; `?? value` keeps a hand-edited row
  // readable instead of turning it into the empty label.
  return toPersianDigits(normalizePhone(value) ?? value);
}

/**
 * The one phone rule. Input is accepted in every shape above; what leaves it is
 * always `09XXXXXXXXX`, or an issue carrying `PHONE_ERROR`.
 */
export const PhoneSchema = z.string().transform((value, ctx) => {
  const normalized = normalizePhone(value);
  if (!normalized) {
    ctx.addIssue({ code: "custom", message: PHONE_ERROR });
    return z.NEVER;
  }
  return normalized;
});
