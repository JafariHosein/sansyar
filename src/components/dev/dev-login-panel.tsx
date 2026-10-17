"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconPower, IconShieldLock, IconUserPlus } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { haptic } from "@/components/eitaa/haptics";
import { notifyError, notifySuccess } from "@/lib/toast";
import type { SessionUserPayload } from "@/server/actions/results";
import { devLogin, devSignOut } from "@/server/actions/dev-auth";

/**
 * Development-only login simulator.
 *
 * ⚠️ Reached **only** through `DevPanelSlot` (`dev-panel-slot.tsx`), whose
 * compile-time `process.env.NODE_ENV` guard keeps this module — code and copy — out
 * of a production bundle. Never import it directly: a static import is exactly what
 * put these strings in the release (phase ۸ hygiene).
 *
 * When it is rendered, the *server* already reported that dev login is enabled
 * (`EITAA_DEV_LOGIN` and not production), and the actions behind it re-check that
 * on every call — production exposes neither the button nor the path.
 *
 * Both buttons go through a signed payload that the server verifies with the very
 * same functions as a real Eitaa login, so the simulator exercises the real chain.
 */
export function DevLoginPanel({
  onLoggedIn,
  allowSignOut = false,
}: {
  onLoggedIn?: (user: SessionUserPayload) => void;
  allowSignOut?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"USER" | "ADMIN" | "out" | null>(null);

  async function signIn(role: "USER" | "ADMIN") {
    setBusy(role);
    const result = await devLogin({ role });
    setBusy(null);

    if (!result.ok) {
      haptic("error");
      notifyError("ورود آزمایشی نشد", result.error);
      return;
    }

    haptic("success");
    notifySuccess(
      role === "ADMIN" ? "ورود آزمایشی به‌عنوان مدیر" : "ورود آزمایشی به‌عنوان بازیکن",
      result.user.name,
    );
    onLoggedIn?.(result.user);
    router.refresh();
  }

  async function signOut() {
    setBusy("out");
    const result = await devSignOut();
    setBusy(null);
    if (!result.ok) {
      notifyError("خروج آزمایشی نشد", result.error);
      return;
    }
    // A full reload re-runs the bridge, which is exactly what a fresh app open does.
    window.location.reload();
  }

  return (
    <Card className="w-full max-w-md border border-dashed border-line-strong text-start">
      <CardHeader>
        <CardTitle className="text-h3">حالت توسعه</CardTitle>
        <CardDescription>
          شبیه‌ساز ورود؛ فقط روی همین سیستم کار می‌کند و در نسخه‌ی نهایی وجود ندارد.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => void signIn("USER")}>
          <IconUserPlus aria-hidden="true" />
          ورود آزمایشی بازیکن
        </Button>
        <Button variant="outline" disabled={busy !== null} onClick={() => void signIn("ADMIN")}>
          <IconShieldLock aria-hidden="true" />
          ورود آزمایشی مدیر
        </Button>
        {allowSignOut ? (
          <Button variant="ghost" disabled={busy !== null} onClick={() => void signOut()}>
            <IconPower aria-hidden="true" />
            پاک کردن نشست
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
