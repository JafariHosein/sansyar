/**
 * Every environment read in the app funnels through here.
 *
 * Nothing here may be imported by a Client Component: `EITAA_BOT_TOKEN` and
 * `SESSION_SECRET` are secrets, and `server-only` turns an accidental client
 * import into a build error instead of a leaked token.
 *
 * ⚠️ A `$` inside a `.env` value is eaten by dotenv-expand (it looks like a
 * variable reference). Escape it as `\$` — `npm.cmd run check:env` enforces this.
 */

import "server-only";

const clean = (value: string | undefined): string => (value ?? "").trim();

export const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** Public base URL, used in absolute links (share messages, docs). */
export const APP_URL = clean(process.env.APP_URL) || "http://localhost:3000";

/** Eitaa app token from the EitaaYar panel — the HMAC key for `initData`. */
export const EITAA_BOT_TOKEN = clean(process.env.EITAA_BOT_TOKEN);

/** App shortname from the panel; used when `EITAA_LINK_TEMPLATE` is not set. */
export const EITAA_APP_USERNAME = clean(process.env.EITAA_APP_USERNAME);

/** Full link template containing `{start}` (see `src/lib/eitaa-link.ts`). */
export const EITAA_LINK_TEMPLATE = clean(process.env.EITAA_LINK_TEMPLATE);

/** Optional token the dev simulator signs with (defaults to the real one). */
export const EITAA_DEV_BOT_TOKEN = clean(process.env.EITAA_DEV_BOT_TOKEN);

/** Eitaa ids that get the ADMIN role. Comma-separated. */
export const ADMIN_EITAA_IDS: readonly string[] = clean(process.env.ADMIN_EITAA_ID)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/**
 * The dev-only login simulator. Inert in production by construction, and off
 * when `EITAA_DEV_LOGIN=0`. Never relied upon for real authentication.
 */
export const EITAA_DEV_LOGIN = !IS_PRODUCTION && clean(process.env.EITAA_DEV_LOGIN) !== "0";

/** Whether a verified Eitaa login can be checked at all. */
export function eitaaConfigured(): boolean {
  return EITAA_BOT_TOKEN !== "";
}

/**
 * Admin identity comes from the environment, never from the client and never
 * from a database flag alone (PROMPT.md §5.7).
 */
export function isAdminEitaaId(eitaaId: string): boolean {
  return ADMIN_EITAA_IDS.includes(eitaaId);
}

const MIN_SECRET_LENGTH = 32;

/** The `jose` signing key. Throws rather than falling back to something weak. */
export function getSessionSecret(): Uint8Array {
  const secret = clean(process.env.SESSION_SECRET);
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters — set it in .env (see .env.example).`,
    );
  }
  return new TextEncoder().encode(secret);
}

/** Eitaa link configuration, in the shape `src/lib/eitaa-link.ts` wants. */
export function getEitaaLinkConfig(): { username: string | null; template: string | null } {
  return {
    username: EITAA_APP_USERNAME || null,
    template: EITAA_LINK_TEMPLATE || null,
  };
}
