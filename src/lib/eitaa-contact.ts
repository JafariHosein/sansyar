/**
 * Eitaa's **contact payload** — the signed string `WebApp.requestContact(...)`
 * hands back to the mini app.
 *
 * Eitaa's own docs describe it as «یک رشته از داده‌های تماس کاربر به همراه یک هش»
 * and say it is verified **like `initData`**: `key=value&…&hash=<hex64>`, mac over
 * the remaining `key=value` lines (sorted, `\n`-joined) with
 * `secret = HMAC-SHA256(key="WebAppData", message=bot_token)` used as **raw bytes**.
 * That whole recipe lives in `src/lib/eitaa-signature.ts` and is *reused* here —
 * never re-implemented.
 *
 * ⚠️ What Eitaa does **not** document is the exact parameter names inside that
 * string (there is no contact-payload test vector to check against either), so
 * extraction is tolerant by design: the known keys first, then any value in the
 * *verified* payload that normalizes to an Iranian mobile. Tolerance stops at the
 * signature: nothing is read before the hash matches.
 *
 * Pure and importable from **both** sides of the wire — same rule as
 * `src/lib/phone.ts`, so the sheet, the dialog and the server action can never
 * disagree about what "a number from Eitaa" means. The bot token never enters
 * this module: it is passed in by the server action.
 */

import {
  DEFAULT_MAX_AGE_HOURS,
  parseSignedPayload,
  verifySignedPayload,
} from "@/lib/eitaa-signature";
import { normalizePhone } from "@/lib/phone";

/**
 * The keys we try, in order. `phone_number` is what the SDK's own docs' sample
 * implies and what our dev simulator writes; `phone` and `contact` are the two
 * other plausible spellings (the last one may hold the whole contact object).
 */
const PHONE_KEYS = ["phone_number", "phone", "contact"] as const;

/**
 * The keys that could name the account that asked — compared with the session.
 *
 * A bare top-level `id` is deliberately **not** one of them: Eitaa does not
 * document the payload's keys, and reading an ambiguous `id` as "the account"
 * would turn any other meaning of that key into «تأیید نشد» on the happy path —
 * a valid, signed number refused. The unambiguous shapes (`user_id`,
 * `sender_user_id`, and the ids inside `user` / `contact`) are read instead.
 */
const SENDER_KEYS = ["user_id", "sender_user_id"] as const;

/**
 * Keys that are **known** not to be the number (metadata and identifiers), so the
 * last-resort scan below cannot mistake one of them for a phone. An Eitaa id may
 * well be ten digits starting with `9` — which `normalizePhone` accepts as a
 * number — and storing an id as somebody's phone would be worse than refusing.
 * The bare `id` belongs here even though `SENDER_KEYS` refuses to read it: it is
 * an identifier, whatever it identifies.
 */
const NON_PHONE_KEYS = new Set<string>([
  "auth_date",
  "chat_type",
  "status",
  "user",
  "id",
  ...SENDER_KEYS,
]);

/** Why a contact payload was refused. Distinct per cause, so the copy can differ. */
export type ContactFailureReason = "MISSING" | "BAD_HASH" | "STALE" | "NO_PHONE";

export type VerifiedContact = {
  ok: true;
  /** Already normalized to `09XXXXXXXXX` by `src/lib/phone.ts`. */
  phone: string;
  /**
   * The requester's Eitaa id when the payload names one, else `null`. The caller
   * compares it with the signed-in account before storing anything.
   */
  senderEitaaId: string | null;
  /** Unix seconds from the signed payload. */
  authDate: number;
};

export type ContactRefusal = { ok: false; reason: ContactFailureReason };

export type ContactVerification = VerifiedContact | ContactRefusal;

/**
 * The payload's parameters, in the same shape `initData` is parsed into — or
 * `null` when there is no `hash=…` to check.
 */
export function parseContactPayload(raw: string): URLSearchParams | null {
  return parseSignedPayload(raw)?.params ?? null;
}

/**
 * Read `phone_number` / `phone` out of a JSON value (`{"phone_number":"0912…"}`),
 * the way a `contact` object would arrive. `null` when the value is not JSON or
 * carries no number.
 */
function phoneFromJson(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  for (const key of PHONE_KEYS) {
    const candidate = (parsed as Record<string, unknown>)[key];
    if (typeof candidate === "string" || typeof candidate === "number") {
      const found = normalizePhone(String(candidate));
      if (found) return found;
    }
    // One level deeper: `{"contact":{"phone_number":…}}`.
    if (typeof candidate === "object" && candidate !== null) {
      const nested = (candidate as Record<string, unknown>)["phone_number"];
      if (typeof nested === "string" || typeof nested === "number") {
        const found = normalizePhone(String(nested));
        if (found) return found;
      }
    }
  }
  return null;
}

/** `null` unless the value normalizes to a complete Iranian mobile. */
function phoneFromValue(value: string): string | null {
  return phoneFromJson(value) ?? normalizePhone(value);
}

/**
 * The number inside a **verified** payload: the known keys first (JSON or plain),
 * then — last resort — any *other* parameter whose value is a mobile number.
 *
 * `auth_date` and the identifiers are skipped by name, and the `hash` line is not
 * even in `params`; everything else has to survive `normalizePhone`, which wants
 * a complete Iranian mobile and nothing else.
 */
function extractPhone(params: URLSearchParams): string | null {
  for (const key of PHONE_KEYS) {
    for (const value of params.getAll(key)) {
      const found = phoneFromValue(value);
      if (found) return found;
    }
  }

  for (const [key, value] of params.entries()) {
    if (NON_PHONE_KEYS.has(key)) continue;
    const found = phoneFromValue(value);
    if (found) return found;
  }

  return null;
}
/**
 * The requester's id, when the payload carries one. Top-level `user_id` /
 * `sender_user_id` first, then the `id` inside a `user` JSON (the shape
 * `initData` uses) or a `user_id`/`id` inside a `contact` object — all kept as
 * tolerant fallbacks because Eitaa's contact-payload key names are undocumented.
 * A bare top-level `id` is ignored on purpose (`SENDER_KEYS` explains why).
 */
function extractSenderId(params: URLSearchParams): string | null {
  const asId = (value: unknown): string | null => {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const text = String(value).trim();
    return /^\d{1,20}$/.test(text) ? text : null;
  };

  for (const key of SENDER_KEYS) {
    const found = asId(params.get(key));
    if (found) return found;
  }

  for (const key of ["user", "contact"] as const) {
    const rawJson = params.get(key);
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      const found = asId(parsed?.["user_id"] ?? parsed?.["id"]);
      if (found) return found;
    } catch {
      // Not JSON — nothing to read here.
    }
  }

  return null;
}

/**
 * Full verification of a contact payload: signature → freshness → the number.
 *
 * Same rules and the same `DEFAULT_MAX_AGE_HOURS` as `verifyInitData`, including
 * the 1-minute future-skew allowance. `maxAgeHours: 0` skips the age check (the
 * check script's escape hatch, exactly like the initData verifier).
 */
export function verifyContact(
  raw: string,
  botToken: string,
  options: { maxAgeHours?: number; now?: number } = {},
): ContactVerification {
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const now = options.now ?? Date.now();

  if (!raw) return { ok: false, reason: "MISSING" };

  const parsed = parseSignedPayload(raw);
  // A missing or malformed `hash` is a bad signature — there is no third answer.
  if (!parsed) return { ok: false, reason: "BAD_HASH" };
  if (!verifySignedPayload(raw, botToken)) return { ok: false, reason: "BAD_HASH" };

  const authDate = Number(parsed.params.get("auth_date") ?? 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: "STALE" };
  if (maxAgeHours > 0) {
    const ageMs = now - authDate * 1000;
    // Stale, or dated in the future beyond clock skew — same verdict as `initData`.
    if (ageMs > maxAgeHours * 3_600_000 || ageMs < -60_000) return { ok: false, reason: "STALE" };
  }

  const phone = extractPhone(parsed.params);
  if (!phone) return { ok: false, reason: "NO_PHONE" };

  return { ok: true, phone, senderEitaaId: extractSenderId(parsed.params), authDate };
}
