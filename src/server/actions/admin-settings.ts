"use server";

/**
 * The manager's **default cancel rules** — `/admin/settings` (PROMPT.md §۶.۴:
 * «تنظیمات قوانین پیش‌فرض»).
 *
 * One row, `Setting.id = 1`, written with `upsert`: the rules exist from the first
 * save, and a missing row (a fresh database that never ran the seed) is created
 * rather than silently ignored. Every session *without* its own override reads
 * this row at cancel time, so one refused write here is a penalty that is never
 * charged — and one accepted write is a rule every future cancel obeys.
 *
 * The action is the whole gate: zod owns the ranges, `requireAdmin()` re-checks the
 * role (the proxy is never an auth boundary), and the outcome is the frozen
 * `SaveSettingsOutcome` from `./admin-results`.
 *
 * The twelve fields arrive as a `CancelRules` object — the same shape
 * `src/lib/sessions.ts` defines and the session overrides mirror, so a rename in
 * one place is a compile error in the other.
 */

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

import type { CancelRules } from "@/lib/sessions";
import type { SaveSettingsOutcome } from "./admin-results";

/** Said for a bad payload and for a missing admin session alike — one refusal either way. */
const ADMIN_REQUIRED = "دسترسی مدیر لازمه.";

/** The last-resort sentence, when zod returns an issue without a message. */
const SETTINGS_INVALID = "این تنظیمات قابل ثبت نیست — عددها رو یه بار دیگه چک کن.";

/**
 * An integer inside a range, with one Persian sentence naming the range the value
 * failed. `z.int()` rejects fractions outright (a day count of «۲.۵» is not a
 * rule), and the message is the same for a wrong type, a too-small value and a
 * too-large one — the manager needs the bound, not zod's taxonomy.
 */
function boundedInt(min: number, max: number, message: string) {
  return z.int(message).min(min, message).max(max, message);
}

/** A switch is on or off; nothing else is a decision. */
function booleanField(message: string) {
  return z.boolean(message);
}

/**
 * The 12 rules. The numbers mirror the columns' intent in `prisma/schema.prisma`
 * and the input bounds of the form:
 *
 *  - `freeCancelHours` 0..168 (a whole week is the longest honest free window);
 *  - `lateThresholdMinutes` 0..240 (a session starts at most four hours late);
 *  - `lateStrikeCount` 1..20 (zero would make the strike rule meaningless);
 *  - every day field 0..365 (a ban longer than a year is a locked account, not a
 *    rule).
 */
const SettingsSchema = z.object({
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

/** The first refusal zod produced — one sentence, the whole answer a toast can carry. */
function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? SETTINGS_INVALID;
}

/**
 * Every screen whose words the rules change: the settings form itself, the home
 * board (a live registration can open the cancel dialog from there), the player's
 * ledger and the session pages — both of which print `cancelRulesText` and resolve
 * a cancel verdict against these numbers — and the profile's «خلاصه‌ی قوانین».
 *
 * `/admin/sessions` is deliberately absent: its own rules card reads the *session*
 * overrides, and the admin session pages are not rendered from this row.
 */
function revalidateRules(): void {
  revalidatePath("/admin/settings");
  revalidatePath("/");
  revalidatePath("/my");
  revalidatePath("/profile");
  revalidatePath("/sessions/[id]", "page");
}

/** «ذخیره‌ی تنظیمات» — the twelve rules, written to the single `Setting` row. */
export async function saveSettings(rules: CancelRules): Promise<SaveSettingsOutcome> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };
  }

  const parsed = SettingsSchema.safeParse(rules);
  if (!parsed.success) {
    return { ok: false, code: "INVALID", error: firstIssueMessage(parsed.error) };
  }

  await prisma.setting.upsert({
    where: { id: 1 },
    create: { id: 1, ...parsed.data },
    update: parsed.data,
  });

  revalidateRules();

  return { ok: true };
}
