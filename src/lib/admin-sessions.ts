/**
 * The manager's **session form** — one contract for three readers (PROMPT.md §۶.۴).
 *
 * A سانس is edited in one place: the form the manager fills on
 * `/admin/sessions/new` and `/admin/sessions/[id]/edit`. It carries the slot's
 * title and venue, its four timestamps, capacity and price, an optional address
 * override / map link / description, and the twelve cancel rules a single session
 * may override.
 *
 * This module is **pure**, and that is the point — both sides of the wire read
 * it:
 *
 *  - the client form (`src/components/admin/session-form.tsx`) validates what it
 *    is about to send with `sessionFormSchema`, so a typo is refused before a
 *    round trip *and* the sentence the manager reads comes from the rules the
 *    server will apply;
 *  - the server action (`src/server/actions/admin-sessions.ts`) re-parses the
 *    very same payload — the client is never trusted, and one schema means the
 *    two can never disagree about what "a valid session" is.
 *
 * The twelve rule fields are the same twelve fields `/admin/settings` edits
 * (`sessionRulesSchema`), with the same sentences: one bound must read one way
 * wherever the manager meets it. A session that overrides nothing stores twelve
 * `NULL`s (`NO_CANCEL_OVERRIDES` from `src/lib/sessions.ts`) and inherits the
 * `Setting` row at cancel time (`resolveCancelRules`).
 */

import { z } from "zod";

import { normalizePersianText } from "./format";
import type { CancelRules, PaymentMode, SessionStatus } from "./sessions";

// ---------------------------------------------------------------------------
// The value a form submits — and the value the action writes
// ---------------------------------------------------------------------------

/**
 * Everything the manager edits about one سانس, as it crosses the wire.
 *
 * The dates are **UTC instants** (`Date`), never Jalali text: the picker
 * (`jalali-date-time-field.tsx`) converts a Tehran wall-clock choice into the
 * instant it denotes, and storage stays UTC everywhere (PROMPT.md §۴). Next's
 * server actions serialize a `Date` natively, so no string spelling of a moment
 * ever exists in this flow.
 *
 * The three text fields are `string | null` — the **stored** shape, not the
 * input's: an empty input is `null` by the time a value exists, so nothing
 * downstream has to treat `""` and `NULL` as two different facts.
 */
export type SessionFormValues = {
  title: string;
  venueId: string;
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  capacity: number;
  priceToman: number;
  paymentMode: PaymentMode;
  /** The form only ever writes these two; «لغو» is the manage screen's own tap. */
  status: Extract<SessionStatus, "DRAFT" | "PUBLISHED">;
  addressOverride: string | null;
  mapUrl: string | null;
  description: string | null;
  /** `null` = inherit every rule from `/admin/settings`. */
  rules: CancelRules | null;
};

/** The venue choices the form's Select offers — the read shape, no Prisma types. */
export type VenueChoice = {
  id: string;
  name: string;
  address: string;
  /**
   * The venue is out of service. It stays selectable while editing a session
   * that already sits on it (deactivating a venue must not strand its history),
   * but the form says so instead of pretending it is a normal choice.
   */
  isActive: boolean;
};

// ---------------------------------------------------------------------------
// The twelve per-session rules
// ---------------------------------------------------------------------------

/**
 * An integer inside a range, with one Persian sentence naming the range the
 * value failed. The twin of the helper in `src/server/actions/admin-settings.ts`
 * — copied verbatim, messages included, so the default rules and a session's
 * overrides are described with the same words.
 */
function boundedInt(min: number, max: number, message: string) {
  return z.int(message).min(min, message).max(max, message);
}

/** A switch is on or off; nothing else is a decision. */
function booleanField(message: string) {
  return z.boolean(message);
}

/**
 * The twelve rules, exactly the columns `Session` carries as nullable overrides.
 *
 * The ranges mirror the settings form and the columns' intent:
 * `freeCancelHours` 0..168 (a whole week is the longest honest free window),
 * `lateThresholdMinutes` 0..240 (a session starts at most four hours late),
 * `lateStrikeCount` 1..20 (zero would make the strike rule meaningless), every
 * day field 0..365 (a ban longer than a year is a locked account, not a rule).
 */
export const sessionRulesSchema = z.object({
  freeCancelHours: boundedInt(0, 168, "ساعت انصراف آزاد باید عددی بین ۰ و ۱۶۸ باشه."),
  lateCancelEnabled: booleanField("جریمه‌ی انصراف دیرهنگام باید روشن یا خاموش باشه."),
  lateCancelPenaltyDays: boundedInt(
    0,
    365,
    "روزهای محرومیت انصراف دیرهنگام باید عددی بین ۰ و ۳۶۵ باشه.",
  ),
  lateCancelFirstWarning: booleanField("اخطار بار اول باید روشن یا خاموش باشه."),
  lateCancelWarningWindowDays: boundedInt(
    0,
    365,
    "بازه‌ی اخطار بار اول باید عددی بین ۰ و ۳۶۵ روز باشه.",
  ),
  noShowEnabled: booleanField("جریمه‌ی غیبت باید روشن یا خاموش باشه."),
  noShowPenaltyDays: boundedInt(0, 365, "روزهای محرومیت غیبت باید عددی بین ۰ و ۳۶۵ باشه."),
  lateStrikesEnabled: booleanField("جریمه‌ی تاخیر باید روشن یا خاموش باشه."),
  lateThresholdMinutes: boundedInt(0, 240, "آستانه‌ی تاخیر باید عددی بین ۰ و ۲۴۰ دقیقه باشه."),
  lateStrikeCount: boundedInt(1, 20, "تعداد تاخیر تا محرومیت باید عددی بین ۱ و ۲۰ باشه."),
  lateStrikeWindowDays: boundedInt(0, 365, "بازه‌ی شمردن تاخیرها باید عددی بین ۰ و ۳۶۵ روز باشه."),
  lateStrikePenaltyDays: boundedInt(0, 365, "روزهای محرومیت تاخیرها باید عددی بین ۰ و ۳۶۵ باشه."),
});

// ---------------------------------------------------------------------------
// Optional text fields
// ---------------------------------------------------------------------------

/**
 * An optional human-entered string: trimmed, Persian-normalized (ی/ک, collapsed
 * whitespace — the same rule every other human string in this app follows),
 * capped, or `null` when the manager left it empty.
 */
function optionalText(max: number, message: string) {
  return z
    .string()
    .transform((value) => normalizePersianText(value))
    .refine((value) => value.length <= max, { message })
    .nullable();
}

/**
 * `http(s)` only: the field is pasted from Neshan, and a `javascript:` payload
 * inside an anchor's `href` is not a map link. Empty stays empty — the venue's
 * own link, then a Neshan search on the address, are the fallbacks
 * (`src/lib/neshan.ts`).
 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** The map link is Latin text: trimmed, never Persian-normalized. */
const optionalMapUrl = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length <= 500, { message: "لینک نقشه می‌تونه حداکثر ۵۰۰ حرف باشه." })
  .refine((value) => value.length === 0 || isHttpUrl(value), {
    message: "لینک نقشه باید با http یا https شروع بشه.",
  })
  .nullable();

// ---------------------------------------------------------------------------
// The form schema
// ---------------------------------------------------------------------------

/** The longest a session may run — a booking, not an overnight camp. */
const MAX_SESSION_HOURS = 12;

/**
 * The whole form, in one schema.
 *
 * The shape rules (ranges, lengths, enums) live on the fields; the **relations
 * between the four timestamps** — which no single field can see — are checked in
 * the `superRefine`: end after start, at most twelve hours long, the registration
 * window opens before it closes, and it closes by the time the session starts. A
 * draft may sit in the past (the manager staging a slot), so the clock is
 * deliberately not consulted here — this module owns no "now".
 */
export const sessionFormSchema = z
  .object({
    title: z
      .string("عنوان سانس رو بنویس.")
      .transform((value) => normalizePersianText(value))
      .refine((value) => value.length >= 2, { message: "عنوان سانس باید حداقل ۲ حرف باشه." })
      .refine((value) => value.length <= 80, { message: "عنوان سانس می‌تونه حداکثر ۸۰ حرف باشه." }),
    venueId: z
      .string("مکان سانس رو انتخاب کن.")
      .transform((value) => value.trim())
      .refine((value) => value.length >= 1, { message: "مکان سانس رو انتخاب کن." })
      .refine((value) => value.length <= 64, { message: "مکان انتخابی معتبر نیست." }),
    startsAt: z.date("زمان شروع سانس رو انتخاب کن."),
    endsAt: z.date("زمان پایان سانس رو انتخاب کن."),
    registrationOpensAt: z.date("زمان باز شدن ثبت‌نام رو انتخاب کن."),
    registrationClosesAt: z.date("زمان بسته شدن ثبت‌نام رو انتخاب کن."),
    capacity: z
      .int("ظرفیت سانس باید یه عدد باشه.")
      .min(1, "ظرفیت سانس باید حداقل ۱ نفر باشه.")
      .max(60, "ظرفیت سانس می‌تونه حداکثر ۶۰ نفر باشه."),
    priceToman: z
      .int("قیمت سانس باید یه عدد باشه.")
      .min(0, "قیمت نمی‌تونه منفی باشه.")
      .max(50_000_000, "قیمت سانس می‌تونه حداکثر ۵۰٬۰۰۰٬۰۰۰ تومان باشه."),
    paymentMode: z.enum(["AT_REGISTRATION", "IN_PERSON"], "روش پرداخت رو انتخاب کن."),
    status: z.enum(["DRAFT", "PUBLISHED"], "وضعیت سانس رو انتخاب کن."),
    addressOverride: optionalText(
      255,
      "آدرس این سانس می‌تونه حداکثر ۲۵۵ حرف باشه.",
    ),
    mapUrl: optionalMapUrl,
    description: optionalText(2000, "توضیح می‌تونه حداکثر ۲۰۰۰ حرف باشه."),
    rules: sessionRulesSchema.nullable(),
  })
  .superRefine((values, ctx) => {
    const start = values.startsAt.getTime();
    const end = values.endsAt.getTime();
    const opens = values.registrationOpensAt.getTime();
    const closes = values.registrationClosesAt.getTime();

    if (end <= start) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "پایان سانس باید بعد از شروعش باشه.",
      });
    } else if (end - start > MAX_SESSION_HOURS * 60 * 60 * 1000) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: `طول سانس می‌تونه حداکثر ${MAX_SESSION_HOURS} ساعت باشه.`,
      });
    }

    if (closes <= opens) {
      ctx.addIssue({
        code: "custom",
        path: ["registrationClosesAt"],
        message: "بسته شدن ثبت‌نام باید بعد از باز شدنش باشه.",
      });
    } else if (closes > start) {
      ctx.addIssue({
        code: "custom",
        path: ["registrationClosesAt"],
        message: "ثبت‌نام باید تا شروع سانس بسته بشه.",
      });
    }
  });

/** The parsed payload — what the action writes, normalization included. */
export type SessionFormParsed = z.infer<typeof sessionFormSchema>;

/**
 * The first refusal zod produced — one sentence, the whole answer a toast can
 * carry. Same shape as the venue and settings actions.
 */
export function firstSessionIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "این اطلاعات قابل ثبت نیست — فیلدها رو یه بار دیگه چک کن.";
}

// ---------------------------------------------------------------------------
// List filters (the URL is the state)
// ---------------------------------------------------------------------------

/** The list's time filter. «پیش رو» is the screen the manager lands on. */
export type SessionWhen = "upcoming" | "past" | "all";

/** The list's status filter: «همه» — the un-narrowed list — or one real status. */
export type SessionStatusFilter = "ALL" | SessionStatus;

/** `?when=` → a real filter. Anything unknown falls back to «پیش رو». */
export function parseSessionWhen(value: string | string[] | undefined): SessionWhen {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "past" || raw === "all" ? raw : "upcoming";
}

/** `?status=` → a real filter. Anything unknown falls back to «همه». */
export function parseSessionStatusFilter(value: string | string[] | undefined): SessionStatusFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "DRAFT" || raw === "PUBLISHED" || raw === "CANCELED" ? raw : "ALL";
}
