"use client";

import dynamic from "next/dynamic";

import type { SessionUserPayload } from "@/server/actions/results";

/**
 * The always-bundled half of the dev-only login panel.
 *
 * `DevLoginPanel` is reached **only** through the compile-time guard below: the
 * bundler inlines `process.env.NODE_ENV`, the ternary folds to `null` in a release
 * and the `import()` — the module's only reference in the whole app — goes with it.
 * The panel's code, its copy and the simulator actions behind it are therefore
 * absent from a production bundle, and `grep`ing `.next/static` is the proof.
 *
 * `ssr: false` is a side effect of that shape, not a behaviour change: both callers
 * render the panel only after their own client-side checks (the bridge once the
 * gate is up, the profile once the session is read), so there is never anything to
 * prerender — the server renders the `loading` slot (`null`) and the client swaps
 * the chunk in once it lands. Nothing about the surrounding screen suspends.
 *
 * This guard is **bundle hygiene only** — nothing here decides whether the panel
 * may render: that is still the server's answer (`EITAA_DEV_LOGIN` → `devEnabled`),
 * and `devLogin`/`devSignOut` re-check the same flag on every call.
 */
const DevLoginPanel =
  process.env.NODE_ENV !== "production"
    ? dynamic(() => import("./dev-login-panel").then((mod) => mod.DevLoginPanel), {
        ssr: false,
        loading: () => null,
      })
    : null;

export function DevPanelSlot({
  enabled,
  onLoggedIn,
  allowSignOut = false,
}: {
  /** The server's answer: development with `EITAA_DEV_LOGIN` on. */
  enabled: boolean;
  onLoggedIn?: (user: SessionUserPayload) => void;
  allowSignOut?: boolean;
}) {
  if (!enabled || DevLoginPanel === null) return null;

  return <DevLoginPanel onLoggedIn={onLoggedIn} allowSignOut={allowSignOut} />;
}
