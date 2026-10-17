"use client";

/**
 * Dev-only phone simulator — the sibling of the login simulator.
 *
 * Two surfaces, both of them simulator copies of a real path:
 *  - `PhoneDevBox`, the first-run sheet's dashed box: one button that has the action
 *    sign a *real* contact payload with the same token and then feeds it through
 *    `savePhoneFromEitaa` — signature, freshness, sender check and the DB write all
 *    run for real;
 *  - `installPhoneDevHook`, the console sibling of `window.__eitaaDebugLogin`:
 *    `window.__eitaaDevContact("09123456789")` walks the very same path.
 *
 * ⚠️ Never import this module statically. The sheet reaches it through a
 * compile-time `process.env.NODE_ENV` guard (`PhoneGate`), which the bundler folds
 * away in a production build — so a release ships neither this code nor its copy.
 * Bundle hygiene only: whether the simulator may *act* is still decided by the
 * server (`EITAA_DEV_LOGIN`, re-checked inside `devContact` before anything runs).
 */

import { useTransition } from "react";

import { haptic } from "@/components/eitaa/haptics";
import { Button } from "@/components/ui/button";
import { notifyError } from "@/lib/toast";
import { devContact } from "@/server/actions/dev-contact";
import { savePhoneFromEitaa } from "@/server/actions/profile";

import { PHONE_ANSWERED_KEY, rememberAnsweredId } from "./first-run-marker";

/** The number the dev-only button pretends Eitaa sent (never a real person's). */
const DEV_SIMULATED_PHONE = "09120000055";

/**
 * The sheet's dev box. It owns its own in-flight state, so the box and the real
 * Eitaa button can never both be running — `blocked` carries the sheet's own
 * request, and the box reports its own state back through the same callbacks the
 * real path uses (`onStart` clears the sentence, `onFailed` writes one).
 */
export function PhoneDevBox({
  blocked = false,
  onStart,
  onSent,
  onFailed,
}: {
  /** The sheet's Eitaa request is in flight — never start a second one. */
  blocked?: boolean;
  onStart: () => void;
  onSent: (phone: string) => void;
  onFailed: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const busy = pending || blocked;

  function handleSend() {
    if (busy) return;
    onStart();

    startTransition(async () => {
      const built = await devContact(DEV_SIMULATED_PHONE);
      if (!built.ok) {
        haptic("error");
        onFailed(built.error);
        return;
      }

      const result = await savePhoneFromEitaa(built.payload);
      if (!result.ok) {
        haptic("error");
        onFailed(result.error);
        return;
      }

      onSent(result.phone);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line-strong p-3">
      <p className="text-caption text-ink-muted">
        حالت توسعه: همان مسیر واقعی و امضاشده، فقط بدون ایتا.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleSend}
        disabled={busy}
      >
        شبیه‌سازی ارسال شماره از ایتا
      </Button>
    </div>
  );
}

/**
 * Register `window.__eitaaDevContact` and hand back the remover. Only ever called
 * while the sheet is up, and only when the server enabled the simulator.
 */
export function installPhoneDevHook({
  eitaaId,
  onSaved,
}: {
  /** The account the marker is written for (the sheet's own account). */
  eitaaId: string;
  /** The sheet's own ending for a saved number — a toast and a fresh render. */
  onSaved: () => void;
}): () => void {
  const onWindow = window as unknown as { __eitaaDevContact?: (phone: string) => Promise<unknown> };

  onWindow.__eitaaDevContact = async (phone: string) => {
    const built = await devContact(phone);
    if (!built.ok) {
      notifyError("شبیه‌سازی شماره نشد", built.error);
      return built;
    }

    const result = await savePhoneFromEitaa(built.payload);
    if (!result.ok) {
      notifyError("شبیه‌سازی شماره نشد", result.error);
      return result;
    }

    haptic("success");
    rememberAnsweredId(PHONE_ANSWERED_KEY, eitaaId);
    onSaved();
    return result;
  };

  return () => {
    delete onWindow.__eitaaDevContact;
  };
}
