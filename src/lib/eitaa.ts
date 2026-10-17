/**
 * Server-side Eitaa facade: the one place where the environment token meets the
 * pure algorithm in `src/lib/eitaa-signature.ts`.
 *
 * `server-only` is deliberate — `EITAA_BOT_TOKEN` must never reach a Client
 * Component. The algorithm itself stays importable by scripts and tests, which
 * is why it lives in its own module.
 */

import "server-only";

import { DEFAULT_MAX_AGE_HOURS, verifyInitData, type VerifiedEitaaInitData } from "@/lib/eitaa-signature";
import {
  buildBaseLink,
  buildSessionLink,
  type EitaaLinkConfig,
} from "@/lib/eitaa-link";
import { EITAA_BOT_TOKEN, getEitaaLinkConfig } from "@/lib/env";

export { eitaaConfigured, EITAA_APP_USERNAME } from "@/lib/env";

/**
 * Verify a raw `initData` string sent by the client bridge.
 *
 * Returns `null` for anything untrusted: bad signature, stale `auth_date`,
 * malformed user payload, or a missing app token.
 */
export function verifyEitaaInitData(
  initData: string,
  options: { maxAgeHours?: number } = {},
): VerifiedEitaaInitData | null {
  if (!EITAA_BOT_TOKEN) return null;
  return verifyInitData(initData, EITAA_BOT_TOKEN, {
    maxAgeHours: options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS,
  });
}

/** The app's own link — the «باز کردن در ایتا» button target on the gate page. */
export function eitaaAppLink(): string | null {
  return buildBaseLink(getEitaaLinkConfig());
}

/** The share link that opens one session (`s_<id>` start param). */
export function eitaaSessionLink(sessionId: string): string | null {
  return buildSessionLink(getEitaaLinkConfig(), sessionId);
}

/** Link configuration for callers that build several links (admin panel, phase 7). */
export function eitaaLinkConfig(): EitaaLinkConfig {
  return getEitaaLinkConfig();
}
