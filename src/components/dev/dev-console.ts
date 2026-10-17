"use client";

/**
 * Dev-only console hook — `window.__eitaaDebugLogin("<initData>")` (PROMPT.md §13.3).
 *
 * The payload comes from `npx.cmd tsx scripts/eitaa-sign-initdata.ts` and is
 * verified by the very same server action a real login uses, so the hook exercises
 * the real chain — and it is the only **timer-free** way in: a hidden tab freezes
 * `setTimeout`, so the splash's 4.5s deadline never fires there.
 *
 * `__eitaaDebugLogin("reject:<message>")` swaps the login for the bridge's
 * «ورودت تأیید نشد» phase. A real browser can never reach it — the boot enters that
 * phase only when Eitaa hands over a payload the server refuses — so the simulator
 * is the one place the rejected gate can be seen and QA'd.
 *
 * ⚠️ Never import this module statically. The bridge reaches it through a
 * compile-time `process.env.NODE_ENV` guard (`EitaaRuntime`), which the bundler
 * folds away in a production build — so a release ships neither the hook nor its
 * copy. Bundle hygiene only: whether the simulator may *act* is still decided by the
 * server (`EITAA_DEV_LOGIN` in `src/lib/env.ts` plus the re-check inside `devLogin`).
 */

import { notifyError } from "@/lib/toast";
import { eitaaLogin } from "@/server/actions/eitaa-auth";
import type { SessionUserPayload } from "@/server/actions/results";

/**
 * Install the hook and hand back the remover.
 *
 * Idempotent: a second install simply replaces the first function, and each remover
 * only ever deletes the hook it installed — React 19 mounting an effect twice in
 * development therefore leaves exactly one live hook behind.
 */
export function installDebugLogin({
  onLoggedIn,
  onRejected,
}: {
  onLoggedIn: (user: SessionUserPayload) => void;
  /** Puts the bridge in its «ورودت تأیید نشد» phase, exactly like a refused login. */
  onRejected: (message: string) => void;
}): () => void {
  const onWindow = window as unknown as {
    __eitaaDebugLogin?: (initData: string) => Promise<unknown>;
  };

  onWindow.__eitaaDebugLogin = async (initData: string) => {
    if (initData.startsWith("reject:")) {
      const message = initData.slice("reject:".length).trim() || "ورود آزمایشی ناموفق بود.";
      onRejected(message);
      return { ok: false, error: message };
    }

    const result = await eitaaLogin(initData);
    if (!result.ok) {
      notifyError("ورود آزمایشی نشد", result.error);
      return result;
    }

    onLoggedIn(result.user);
    return result;
  };

  return () => {
    delete onWindow.__eitaaDebugLogin;
  };
}
