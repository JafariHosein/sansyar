"use server";

/**
 * Profile writes: «تغییر نام», the contact number and the real name pair — the
 * three things the first-run sheet and the profile collect.
 *
 * The display name is what other players read in a session's roster, so it is
 * normalized the same way every other human string in this app is (Persian ی/ک,
 * whitespace collapsed) and length-checked on the server — the input's
 * `maxLength` is only a hint for the keyboard.
 *
 * The number follows the same shape: one shared rule (`src/lib/phone.ts`),
 * normalized to `09XXXXXXXXX` before it touches the database, and the sentence
 * the player sees is the sentence this module returns. There is exactly one
 * source for it: **Eitaa itself** (`savePhoneFromEitaa`, the signed contact
 * payload of `WebApp.requestContact`). Typed entry was removed by the owner's
 * rule, so the first-run sheet cannot be sidestepped — a player who does not
 * send the number cannot use the app. It is not a login step: the number is a
 * contact detail for the manager, and identity stays `initData`-only.
 *
 * **The number and the real name pair are asked once and immutable** (the
 * owner's rule). This module is where that is enforced, not just painted: the same
 * value again is a no-op (a retry after a flaky connection must not be punished),
 * and a *different* one is refused with the sentence that sends the player to the
 * manager — the manager is the only one who may rewrite a name or a number the
 * roster already carries. `updateDisplayName` («تغییر نام») is deliberately
 * unaffected: the display name is a nickname, and nicknames may change.
 */

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { getCurrentUser, requireUser, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyContact } from "@/lib/eitaa-contact";
import { eitaaConfigured, EITAA_BOT_TOKEN } from "@/lib/env";
import { normalizePersianText } from "@/lib/format";

import type { PhoneOutcome, RealNameOutcome, RenameOutcome } from "./results";

/** The two sentences a payload Eitaa did not vouch for gets. */
const CONTACT_REJECTED = "این شماره از ایتا تأیید نشد — یکبار دیگه امتحان کن.";
const CONTACT_EMPTY = "ایتا شماره‌ای نفرستاد — یکبار دیگه امتحان کن.";

/** Asked once, and that was the ask: the roster is a list people act on. */
const PHONE_LOCKED = "شماره‌ات قبلاً ثبت شده و تغییرش ممکن نیست — اگه عوض شده، با مدیر هماهنگ کن.";

/** Same rule for the pair the manager reads at the door. */
const NAME_LOCKED = "نام و نام‌خانوادگی‌ات قبلاً ثبت شده و تغییرش با مدیره.";

/** Same ceiling as `eitaaLogin`: a few hundred bytes is what such a payload is. */
const ContactPayloadSchema = z.string().max(8192);

const NameSchema = z
  .string()
  .transform((value) => normalizePersianText(value).replace(/\s+/g, " ").trim())
  .refine((value) => value.length >= 2, { message: "نامت باید حداقل ۲ حرف باشه." })
  .refine((value) => value.length <= 40, { message: "نامت می‌تونه حداکثر ۴۰ حرف باشه." });

/**
 * The two halves of the real name, each normalized like every other human string
 * and each capped by its own column (`User.firstName` VarChar(30),
 * `User.lastName` VarChar(40)) — the limit is a schema fact, so the sentence the
 * field shows and the column the value lands in never disagree.
 */
const FirstNameSchema = z
  .string()
  .transform((value) => normalizePersianText(value).replace(/\s+/g, " ").trim())
  .refine((value) => value.length >= 2, { message: "اسمت باید حداقل ۲ حرف باشه." })
  .refine((value) => value.length <= 30, { message: "اسمت می‌تونه حداکثر ۳۰ حرف باشه." });

const LastNameSchema = z
  .string()
  .transform((value) => normalizePersianText(value).replace(/\s+/g, " ").trim())
  .refine((value) => value.length >= 2, { message: "فامیلی‌ات باید حداقل ۲ حرف باشه." })
  .refine((value) => value.length <= 40, { message: "فامیلی‌ات می‌تونه حداکثر ۴۰ حرف باشه." });

export async function updateDisplayName(name: string): Promise<RenameOutcome> {
  const parsed = NameSchema.safeParse(name);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID",
      error: parsed.error.issues[0]?.message ?? "این نام قابل ثبت نیست.",
    };
  }

  const viewer = await getCurrentUser();
  if (!viewer) {
    return { ok: false, code: "AUTH", error: "نشستت منقضی شده — برنامک رو دوباره باز کن." };
  }

  const next = parsed.data;
  if (next !== viewer.name) {
    await prisma.user.update({ where: { id: viewer.id }, data: { name: next } });
  }

  // The name is printed on every surface that lists this player: the profile,
  // the ledger and the rosters that stream into the session pages.
  revalidatePath("/profile");
  revalidatePath("/my");
  revalidatePath("/");

  return { ok: true, name: next };
}

/**
 * Save the player's **real name** pair — the second answer of the same first-run
 * sheet the number comes from.
 *
 * Asked **once** and immutable afterwards, exactly like the number, and for a
 * stronger reason: this is the name the manager reads on the roster and checks
 * against the person at the door, so a later edit would silently rewrite a list
 * somebody already acted on. The same pair again is a no-op (a retry after a
 * flaky connection must not be punished); a different one sends the player to the
 * manager.
 *
 * `updateDisplayName` above is deliberately *not* this: the display name is a
 * nickname the player may change, and this pair is the fact underneath it.
 */
export async function saveRealName(firstName: string, lastName: string): Promise<RealNameOutcome> {
  const parsedFirst = FirstNameSchema.safeParse(firstName);
  if (!parsedFirst.success) {
    return {
      ok: false,
      code: "INVALID",
      error: parsedFirst.error.issues[0]?.message ?? "این اسم قابل ثبت نیست.",
    };
  }

  const parsedLast = LastNameSchema.safeParse(lastName);
  if (!parsedLast.success) {
    return {
      ok: false,
      code: "INVALID",
      error: parsedLast.error.issues[0]?.message ?? "این فامیلی قابل ثبت نیست.",
    };
  }

  const viewer = await getCurrentUser();
  if (!viewer) {
    return { ok: false, code: "AUTH", error: "نشستت منقضی شده — برنامک رو دوباره باز کن." };
  }

  const next = { firstName: parsedFirst.data, lastName: parsedLast.data };
  const already = viewer.firstName !== null || viewer.lastName !== null;

  if (already && (next.firstName !== viewer.firstName || next.lastName !== viewer.lastName)) {
    return { ok: false, code: "LOCKED", error: NAME_LOCKED };
  }
  if (!already) {
    await prisma.user.update({ where: { id: viewer.id }, data: next });
  }

  // The pair shows on the profile and in every roster: the manager's own queue
  // and the session pages, which the manager reads while deciding.
  revalidatePath("/profile");
  revalidatePath("/my");
  revalidatePath("/");
  revalidatePath("/sessions/[id]", "page");

  return { ok: true, ...next };
}

/**
 * The payload's own **key names**, never its values — the one thing that is safe
 * to log about a contact payload (the number in it is personal data, and the raw
 * string carries it alongside the account it belongs to). Capped so a hostile
 * payload cannot flood the log with one line.
 */
function payloadKeys(raw: string): string {
  try {
    const keys = [...new Set(new URLSearchParams(raw).keys())]
      // A raw string without a single `=` parses as one "key" that *is* the whole
      // string — and a client that posts a bare phone number would see it logged
      // verbatim. Real payload keys are short ASCII names; anything else is not
      // worth a log line. (Newlines cannot survive the charset, so this cannot
      // forge a log line either.)
      .filter((key) => /^(?=.*[A-Za-z])[A-Za-z0-9_.-]{1,32}$/.test(key))
      .sort();

    if (keys.length === 0) return "(unreadable)";
    return keys.length > 20 ? `${keys.slice(0, 20).join(", ")} …` : keys.join(", ");
  } catch {
    return "(unreadable)";
  }
}

/**
 * Save the contact number **as sent by Eitaa itself** (`WebApp.requestContact`).
 *
 * The client hands over the raw signed string the SDK gave it; everything after
 * that is the server's business, because only the server holds the bot token:
 *
 *   `verifyContact` (exported `hash` + `auth_date` + a normalizable number)
 *     → the requester's id, when the payload carries one, must be *this* account
 *     → one `User.phone` write, revalidated like every other profile write.
 *
 * It is still not a login step — Eitaa's rules forbid login by contact data, and
 * a payload that fails verification stores nothing. There is no manual fallback:
 * the number is asked once, from Eitaa, or not at all (Eitaa may also simply have
 * no number to send) — which is what makes the mandatory sheet mandatory.
 */
export async function savePhoneFromEitaa(rawContact: string): Promise<PhoneOutcome> {
  // `requireUser` throws for a missing session; this module answers every
  // refusal as a typed result.
  let viewer: SessionUser;
  try {
    viewer = await requireUser();
  } catch {
    return { ok: false, code: "AUTH", error: "نشستت منقضی شده — برنامک رو دوباره باز کن." };
  }

  if (!eitaaConfigured()) {
    return { ok: false, code: "UNAVAILABLE", error: "برنامک ایتا فعال نیست — یکبار دیگه امتحان کن." };
  }

  const parsed = ContactPayloadSchema.safeParse(rawContact);
  if (!parsed.success) {
    console.warn("[contact] rejected before parsing — not a well-formed payload");
    return { ok: false, code: "MISSING", error: CONTACT_EMPTY };
  }

  const verified = verifyContact(parsed.data, EITAA_BOT_TOKEN);

  if (!verified.ok) {
    // Keys only, never values — the payload carries a personal number, and the
    // whole point of one line here is to be able to answer "which shape did
    // Eitaa actually send?" without logging anybody's phone.
    if (verified.reason === "MISSING") {
      console.warn("[contact] verify failed (MISSING) — no payload");
    } else {
      console.warn(`[contact] verify failed (${verified.reason}) keys: ${payloadKeys(parsed.data)}`);
    }

    return {
      ok: false,
      code: verified.reason,
      // "Nothing arrived" and "nothing usable inside" are the same fact for the
      // player: ask Eitaa again — there is no manual field to fall back on.
      // Everything else is a payload we refuse to trust, and a retry is the ask.
      error: verified.reason === "NO_PHONE" || verified.reason === "MISSING" ? CONTACT_EMPTY : CONTACT_REJECTED,
    };
  }

  if (verified.senderEitaaId !== null && verified.senderEitaaId !== viewer.eitaaId) {
    // Signed by Eitaa, but about somebody else: never store another account's
    // number on this one (a shared screenshot, a replayed payload, a bug).
    console.warn(`[contact] verify failed (MISMATCH) keys: ${payloadKeys(parsed.data)}`);
    return { ok: false, code: "MISMATCH", error: CONTACT_REJECTED };
  }

  const next = verified.phone;
  // The ask-once rule: a number the account already carries is this account's
  // number, and a *different* one — however well it is signed — is refused. The
  // manager is still the only way to change what the roster reads.
  if (next !== viewer.phone && viewer.phone !== null) {
    return { ok: false, code: "LOCKED", error: PHONE_LOCKED };
  }
  if (next !== viewer.phone) {
    await prisma.user.update({ where: { id: viewer.id }, data: { phone: next } });
  }

  // The two surfaces every number write reaches: the profile row and the
  // manager's roster inside the session pages.
  revalidatePath("/profile");
  revalidatePath("/sessions/[id]", "page");

  return { ok: true, phone: next };
}
