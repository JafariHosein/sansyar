/**
 * The Eitaa signature algorithm — pure and dependency-free. It covers **both**
 * signed payloads this app receives: the login `initData` and the contact
 * payload that `WebApp.requestContact` hands back (same `key=value&…&hash=` shape,
 * same mac, different key names — see `src/lib/eitaa-contact.ts`).
 *
 * Kept separate from `src/lib/eitaa.ts` on purpose: this module imports nothing
 * from Next, React or `server-only`, so the *same* code is used by the server
 * action, the dev simulator and `scripts/check-eitaa-signature.ts`. A second
 * hand-written copy is how signature bugs survive.
 *
 * ⚠️ The second HMAC key is the **raw digest**, not its hex string. `.digest("hex")`
 * re-fed as the key produces a different, plausible-looking mac that fails every
 * login with no other symptom — the official test vector in the check script
 * pins this down (`19ec4dfd…` instead of `c3bb1efc…`).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** The fixed key of the first HMAC, straight from Eitaa's docs. */
export const INIT_DATA_KEY = "WebAppData";

/** How long a signature stays acceptable when a caller asks for freshness. */
export const DEFAULT_MAX_AGE_HOURS = 24;

export type EitaaInitDataUser = {
  /** Eitaa ids have up to 52 significant bits — always carried as a string. */
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
};

export type VerifiedEitaaInitData = {
  user: EitaaInitDataUser;
  /** Unix seconds from the signed payload. */
  authDate: number;
  /** `s_<sessionId>` when the app was opened from a share link. */
  startParam: string | null;
};

/**
 * Any signed `key=value&…&hash=<hex64>` payload. `initData` is the one we log in
 * with; Eitaa's **contact payload** (`WebApp.requestContact`) is the same string
 * shape and is verified with the same recipe — see `src/lib/eitaa-contact.ts`.
 */
export type ParsedSignedPayload = {
  hash: string;
  /** The `key=value` lines that the mac is computed over (`hash` excluded). */
  checkString: string;
  /** Every parameter, percent-decoded, with `hash` already removed. */
  params: URLSearchParams;
};

const HEX_64 = /^[0-9a-f]{64}$/i;

/**
 * Split a signed payload into the hash and the data-check-string.
 *
 * Values are compared **as parsed** (percent-decoded), which is what the official
 * vector expects and what every validated implementation does — `URLSearchParams`
 * also turns `+` into a space, so a payload must not rely on a literal `+`.
 */
function parseInitData(initData: string): ParsedSignedPayload | null {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !HEX_64.test(hash)) return null;
  params.delete("hash");
  const checkString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  return { hash, checkString, params };
}

/** `secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)` — raw bytes. */
function deriveSecret(botToken: string): Buffer {
  return createHmac("sha256", INIT_DATA_KEY).update(botToken, "utf8").digest();
}

/**
 * The public door to the parser, for payload types **other than** `initData`
 * (today: the contact payload).
 *
 * Deliberately a thin alias: a second hand-written parse would be a second place
 * for the mac's input to drift, and the whole point of this module is that the
 * recipe exists exactly once.
 */
export function parseSignedPayload(raw: string): ParsedSignedPayload | null {
  return parseInitData(raw);
}

/** The mac Eitaa expects for this payload, as lowercase hex. */
export function computeInitDataHash(initData: string, botToken: string): string | null {
  const parsed = parseInitData(initData);
  if (!parsed || !botToken) return null;
  return createHmac("sha256", deriveSecret(botToken)).update(parsed.checkString, "utf8").digest("hex");
}

/**
 * Timing-safe signature check for **any** signed payload — `initData` and the
 * contact payload share this algorithm, only the key names differ.
 *
 * Never throws, never leaks which part failed.
 */
export function verifySignedPayload(raw: string, botToken: string): boolean {
  const parsed = parseInitData(raw);
  if (!parsed || !botToken) return false;
  const mac = createHmac("sha256", deriveSecret(botToken))
    .update(parsed.checkString, "utf8")
    .digest();
  const expected = Buffer.from(parsed.hash, "hex");
  return mac.length === expected.length && timingSafeEqual(mac, expected);
}

/** `initData`'s name for the check above; kept so every existing call site reads as it did. */
export function verifyInitDataSignature(initData: string, botToken: string): boolean {
  return verifySignedPayload(initData, botToken);
}

/**
 * Produce a signed `initData` string — the mirror image of the verifier, used by
 * the dev-only simulator (`scripts/eitaa-sign-initdata.ts` and `devLogin`).
 *
 * Values go out percent-encoded but the mac is computed over the decoded values,
 * so `buildInitData` → `verifyInitData` round-trips through the real algorithm.
 */
export function buildInitData(fields: Record<string, string>, botToken: string): string {
  const entries = Object.entries(fields);
  const checkString = entries
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const hash = createHmac("sha256", deriveSecret(botToken)).update(checkString, "utf8").digest("hex");
  const query = entries
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `${query}&hash=${hash}`;
}

/** Name shown to other players: Eitaa `first_name` + `last_name`. */
export function eitaaDisplayName(user: EitaaInitDataUser): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
}

/**
 * Full verification: signature → freshness → payload.
 *
 * `now` is injected rather than read from the clock so the caller controls
 * freshness (and the check script stays deterministic).
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  options: { maxAgeHours?: number; now?: number } = {},
): VerifiedEitaaInitData | null {
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const now = options.now ?? Date.now();

  const parsed = parseInitData(initData);
  if (!parsed || !verifyInitDataSignature(initData, botToken)) return null;

  const authDate = Number(parsed.params.get("auth_date") ?? 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (maxAgeHours > 0) {
    const ageMs = now - authDate * 1000;
    // Reject stale payloads — and payloads dated in the future (clock skew > 1 min).
    if (ageMs > maxAgeHours * 3_600_000 || ageMs < -60_000) return null;
  }

  const rawUser = parsed.params.get("user");
  if (!rawUser) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawUser) as Record<string, unknown>;
  } catch {
    return null;
  }

  const id = payload["id"];
  if (typeof id !== "number" && typeof id !== "string") return null;
  const idText = String(id).trim();
  if (!/^\d{1,20}$/.test(idText)) return null;

  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;

  return {
    user: {
      id: idText,
      firstName: text(payload["first_name"]) ?? "بازیکن",
      lastName: text(payload["last_name"]),
      username: text(payload["username"]),
      languageCode: text(payload["language_code"]),
    },
    authDate,
    startParam: parsed.params.get("start_param") || null,
  };
}
