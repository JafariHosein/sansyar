/**
 * «پیام آماده‌ی اشتراک سانس» (PROMPT.md §۱۳.۶) — the text the manager drops into
 * an Eitaa group, plus the deep link that travels under it.
 *
 * Pure on purpose: no `server-only`, no env, no clock. The manager's session
 * screen builds the message on the server and hands it to a client dialog, and a
 * check script can exercise the template without a request.
 *
 * The six lines are §۱۳.۶'s template **verbatim** — emoji included, because the
 * «no emoji as an icon» rule is about our own UI, never about a chat message the
 * manager sends. The decorative symbols are the only place they are allowed.
 *
 * Two facts about the shapes below:
 *
 *  - `<قیمت> تومان` is already the whole amount: `formatToman` appends the unit
 *    itself, so the template's own «تومان» is never written twice;
 *  - the link is a **line of its own** (`buildSessionShareMessage`) — Eitaa turns
 *    the bare URL into a tappable link, and tapping it opens the mini app on that
 *    session. On **Android** a button also appears under the message (labelled
 *    «ثبت‌نام») because the link carries Eitaa's `btn` param; web and desktop show
 *    no button, so the call-to-action names both and rides only when a link
 *    exists. The «دکمه» the EitaaYar panel configures is a different thing: the
 *    program's card inside its own chat; see `src/lib/eitaa-link.ts`.
 */

import { formatToman, toPersianDigits } from "@/lib/format";
import { formatJalaliDayMonth, formatJalaliWeekdayDate, formatTime, formatTimeRange } from "@/lib/jalali";
import type { PaymentMode } from "@/lib/sessions";

/**
 * How one pays, in the words of the message (§۱۳.۶ writes the two options as
 * «آنلاین هنگام ثبت‌نام | حضوری»). «حضوری به مدیر» names the person who takes
 * the money, which is what a player in a group chat actually needs to know.
 */
const PAYMENT_MODE_WORDS: Record<PaymentMode, string> = {
  AT_REGISTRATION: "آنلاین هنگام ثبت‌نام",
  IN_PERSON: "حضوری به مدیر",
};

export type SessionShareMessageInput = {
  title: string;
  /** The hall's name. */
  venueName: string;
  /** `addressOverride ?? venue.address` — already resolved by the caller. */
  address: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  priceToman: number;
  paymentMode: PaymentMode;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  /**
   * The session's Eitaa deep link (`src/lib/eitaa-link.ts`), or `null` when the
   * app link is not configured — the message is then sent without a link.
   */
  link: string | null;
};

/**
 * §۱۳.۶'s five info lines, plus the call-to-action line **only when a link
 * exists** — this is what «کپی متن» copies.
 *
 * Every number and date goes through the app's own Persian formatters, so the
 * message a player reads in Eitaa reads exactly like the screen they open from
 * it: Jalali in `Asia/Tehran`, Persian digits, «تومان».
 *
 * The CTA names «دکمه یا لینک»: Android draws a button under the message (from the
 * link's `btn` param), the other clients only the link — the sentence is true on
 * both. Without a link there is nothing to tap, so the line is dropped.
 */
export function sessionShareText(input: SessionShareMessageInput): string {
  const window = `${formatJalaliDayMonth(input.registrationOpensAt)} ساعت ${formatTime(
    input.registrationOpensAt,
  )} تا ${formatJalaliDayMonth(input.registrationClosesAt)} ساعت ${formatTime(
    input.registrationClosesAt,
  )}`;

  const lines = [
    `⚽ سانس فوتسال — ${input.title}`,
    `📍 ${input.venueName} — ${input.address}`,
    `🗓 ${formatJalaliWeekdayDate(input.startsAt)} · ساعت ${formatTimeRange(
      input.startsAt,
      input.endsAt,
    )}`,
    `👥 ظرفیت ${toPersianDigits(input.capacity)} نفر · ${formatToman(input.priceToman)} (${
      PAYMENT_MODE_WORDS[input.paymentMode]
    })`,
    `⏰ ثبت‌نام: از ${window}`,
  ];

  if (input.link) lines.push("برای ثبت‌نام روی دکمه یا لینک زیر بزن 👇");

  return lines.join("\n");
}

/**
 * The ready-to-paste message: the info lines (plus the CTA when a link exists),
 * then the link on its own line — this is what «کپی متن + لینک» copies.
 *
 * With no link configured the two copy buttons hand out the same text, which is
 * the honest answer: the message is still sendable, it just cannot deep-link.
 */
export function buildSessionShareMessage(input: SessionShareMessageInput): string {
  const text = sessionShareText(input);
  return input.link ? `${text}\n${input.link}` : text;
}
