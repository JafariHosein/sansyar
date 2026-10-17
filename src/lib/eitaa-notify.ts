/**
 * Eitaa program → player messages («ارسال پیام به کاربر از طریق برنامه»).
 *
 * The channel is the program itself: `POST https://eitaayar.ir/api/app/sendMessage`
 * with the program token, the player's Eitaa id and the text. Two facts shape
 * this module:
 *
 *  - **It may fail, and that is fine.** Eitaa only delivers to a player who gave
 *    the program the send permission (pressing «شروع», or opening it from a
 *    message), and the program only receives a **daily message credit** based on
 *    user engagement — each message spends one. So every call is
 *    fire-and-forget: it never throws, never blocks a write, and reports the
 *    refusal to the server log instead.
 *  - **The token never leaves the server.** Hence `server-only`: an accidental
 *    client import is a compile error, not a token in the bundle.
 *
 * In development nothing is sent — the text is logged instead — so a dev server
 * or the race harness can never message a real person. `next start`
 * (production) sends for real, which is what the owner's device tests exercise.
 */

import "server-only";

import { eitaaSessionLink } from "@/lib/eitaa";
import { EITAA_BOT_TOKEN, IS_PRODUCTION } from "@/lib/env";
import { formatToman, toPersianDigits } from "@/lib/format";
import { formatJalaliDayMonth, formatTime } from "@/lib/jalali";

const SEND_URL = "https://eitaayar.ir/api/app/sendMessage";

/** Never let a dead API hold a request open. */
const SEND_TIMEOUT_MS = 5_000;

/**
 * Eitaa ids are numeric and fit 52 bits (exact in a JS number), and the API
 * documents `chat_id` as a number. Anything non-numeric passes through as-is;
 * the API refuses it and the log says so.
 */
function chatIdOf(eitaaId: string): number | string {
  return /^\d{1,15}$/.test(eitaaId) ? Number(eitaaId) : eitaaId;
}

/**
 * Send one message to one player. Resolves `true` when Eitaa accepted it and
 * `false` for every refusal — logging the reason, never the token.
 */
export async function notifyPlayer(eitaaId: string, text: string): Promise<boolean> {
  if (!EITAA_BOT_TOKEN) {
    console.warn("[notify] skipped — EITAA_BOT_TOKEN is not set");
    return false;
  }
  if (!IS_PRODUCTION) {
    // The dev server and the harness must never message a real person.
    console.log(`[notify] (dev, not sent) → ${eitaaId}: ${text.replace(/\s*\n\s*/g, " ⏎ ")}`);
    return true;
  }

  try {
    const response = await fetch(SEND_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: EITAA_BOT_TOKEN, chat_id: chatIdOf(eitaaId), text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; result?: string; description?: string }
      | null;

    if (!response.ok || !data?.ok) {
      console.warn(
        `[notify] refused (${response.status}) → ${eitaaId}: ${data?.description ?? "no description"}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[notify] failed → ${eitaaId}: ${(error as Error).message}`);
    return false;
  }
}

/** ««فوتسال پنجشنبهها» — ۲۵ مهر ساعت ۲۰:۰۰» — the one way a message names a سانس. */
export function notifySessionLabel(title: string, startsAt: Date): string {
  return `«${title}» — ${formatJalaliDayMonth(startsAt)} ساعت ${formatTime(startsAt)}`;
}

/**
 * The mini-app deep link for a سانس, or `null` when the app link is not
 * configured. A raw URL on its own line — Eitaa links it, and there is no
 * markdown marker to break on a stray character in a title.
 */
export function notifySessionLink(sessionId: string): string | null {
  return eitaaSessionLink(sessionId);
}

// ---------------------------------------------------------------------------
// Message builders — every program → player sentence, in one home
// ---------------------------------------------------------------------------
//
// The two callers (`src/server/actions/membership.ts` and
// `src/server/actions/cancel.ts`) share these, so the same event can never be
// worded two ways. They are pure on purpose: a builder takes the facts and
// returns the text, and nothing here touches the network or the clock.
//
// Register is semi-formal, second person singular («ثبت‌نامت»، «می‌گیری») — a
// message is a chat line, not a notice board.

/** The app's own signature: every message opens with it, so the sender is never a stranger. */
const PREFIX = "سانسیار: ";

/** A single-line message, or two lines when there is a link — it belongs on its own. */
function withLink(text: string, link: string | null): string {
  return link ? `${text}\n${link}` : text;
}

/**
 * «عضویتت تأیید شد» — the membership gate opened. The link is the app itself:
 * the player's next move is to open سانس‌یار and pick a سانس.
 */
export function membershipApprovedMessage(input: { link: string | null }): string {
  return withLink(
    `${PREFIX}عضویتت تأیید شد — از الآن می‌تونی تو سانس‌ها ثبت‌نام کنی.`,
    input.link,
  );
}

/**
 * «درخواستت تأیید نشد» — the manager said no to the **account**. No link: there
 * is nothing to open, and the way out of a disagreement is a person, not the app.
 * The rejection is not final — an approval later arrives as a fresh message.
 */
export function membershipRejectedMessage(): string {
  return `${PREFIX}درخواست عضویتت تأیید نشد.\nاگه فکر می‌کنی اشتباه شده، با مدیر سالن هماهنگ کن.`;
}

/**
 * «یه جا آزاد شد» — the player's turn came off the waitlist, and the seat is
 * theirs (the membership gate already vetted them). The link opens the session,
 * where the payment line and the roster state the rest.
 */
export function promotedMessage(input: { label: string; link: string | null }): string {
  return withLink(
    `${PREFIX}یه جا تو ${input.label} آزاد شد — از لیست انتظار دراومدی و ثبت‌نامت قطعی شد.`,
    input.link,
  );
}

/**
 * «اخطار اول» — the first late cancel inside the window (`days = 0`). It says
 * both facts: the warning was recorded, and it cost nothing this time.
 */
export function lateCancelWarningMessage(input: { label: string }): string {
  return `${PREFIX}برای انصراف دیرهنگام از ${input.label} اخطار اول گرفتی — این‌بار محرومیت نداری.`;
}

/**
 * «محروم شدی» — the late cancel that costs a ban. The window is spelled out in
 * «سابقه‌ی من» and the ban card; the message states the days, nothing more.
 */
export function lateCancelPenaltyMessage(input: { label: string; days: number }): string {
  return `${PREFIX}برای انصراف دیرهنگام از ${input.label} ${toPersianDigits(
    input.days,
  )} روز از ثبت‌نام محروم شدی.`;
}

/**
 * «غایب ثبت شدی» — the attendance engine marked a no-show (§۵.۵). The ban is the
 * news when the rules charge one; a pass with `days = 0` never happens from the
 * engine (a no-show either writes `noShowPenaltyDays` or is administratively
 * disabled), so this message always names the days.
 */
export function noShowMessage(input: { label: string; days: number }): string {
  return input.days > 0
    ? `${PREFIX}تو ${input.label} غایب ثبت شدی — ${toPersianDigits(
        input.days,
      )} روز از ثبت‌نام محروم شدی.`
    : `${PREFIX}تو ${input.label} غایب ثبت شدی.`;
}

/**
 * «تکرار تاخیر» — the strike threshold was reached (§۵.۶). The sentence names no
 * single session on purpose: the count spans a window, and the history page
 * carries which سانس‌ها they were.
 */
export function lateStrikesMessage(input: { days: number }): string {
  return `${PREFIX}تاخیرهات به حد نصاب رسید — ${toPersianDigits(
    input.days,
  )} روز از ثبت‌نام محروم شدی.`;
}

/**
 * «محرومیت دستی» — the manager banned the account by hand (§۵.۶). The reason is
 * the manager's own words: it is passed through exactly as typed.
 */
export function manualBanMessage(input: { days: number; reason: string }): string {
  return `${PREFIX}مدیر تو رو ${toPersianDigits(input.days)} روز از ثبت‌نام محروم کرد — دلیل: ${
    input.reason
  }.`;
}

/** «محرومیتت لغو شد» — a pardon lands as its own message, so the door reopens out loud. */
export function banWaivedMessage(): string {
  return `${PREFIX}محرومیتت لغو شد — از الآن می‌تونی دوباره تو سانس‌ها ثبت‌نام کنی.`;
}

/**
 * «سانس لغو شد» — the manager canceled a whole session (§۶.۴). A player whose
 * money was in the seat is told **where it went**: the balance, automatically —
 * the cancel's own transaction sends it back — so the message states a fact
 * instead of asking for a conversation about a refund.
 */
export function sessionCanceledMessage(input: { label: string; refundedToman: number }): string {
  return input.refundedToman > 0
    ? `${PREFIX}سانس ${input.label} لغو شد — ${formatToman(
        input.refundedToman,
      )} به موجودی حسابت برگشت و توی ثبت‌نام بعدی خودکار حساب می‌شه.`
    : `${PREFIX}سانس ${input.label} لغو شد — ثبت‌نامت خودکار لغو شد و جریمه‌ای هم نداره.`;
}

/**
 * «موجودیت تغییر کرد» — the manager moved the balance by hand (§۶.۴). Money
 * changing without a word is the one thing a wallet must never do, so the player
 * hears about it; the manager's own note rides along when they wrote one.
 */
export function balanceAdjustedMessage(input: { delta: number; note?: string | null }): string {
  const direction = input.delta > 0 ? "زیاد" : "کم";
  const reason = input.note ? ` — دلیل: ${input.note}` : "";
  return `${PREFIX}مدیر موجودیت رو ${formatToman(
    Math.abs(input.delta),
  )} ${direction} کرد${reason}.`;
}
