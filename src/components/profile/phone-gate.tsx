"use client";

import { useEffect, useState, useTransition } from "react";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { IconDeviceMobileMessage, IconPhone } from "@tabler/icons-react";

import { haptic } from "@/components/eitaa/haptics";
import { useEitaaRuntime } from "@/components/eitaa/runtime-context";
import { requestEitaaContact } from "@/components/eitaa/sdk";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatPhoneForDisplay } from "@/lib/phone";
import { notifySuccess } from "@/lib/toast";
import { savePhoneFromEitaa } from "@/server/actions/profile";

import { PHONE_ANSWERED_KEY, rememberAnsweredId, useAnsweredId } from "./first-run-marker";
import { FirstRunSheet } from "./first-run-sheet";

/** What a declined, timed-out or impossible request says — one honest sentence. */
const CONTACT_MISSING =
  "شماره‌ت نرسید — برای استفاده از سانس‌یار باید شماره‌ت رو بفرستی. دوباره امتحان کن.";

/**
 * Dev-only simulator box, reached through a **compile-time** guard: the bundler
 * inlines `process.env.NODE_ENV`, the ternary folds to `null` in a release and the
 * `import()` — the only reference to `phone-dev-box.tsx` in the app — goes with it,
 * so neither the box nor its copy exists in a production bundle (the proof is a
 * grep over `.next/static`). The laziness is a side effect, not a behaviour: the
 * sheet renders `null` until the client knows the login, so nothing is prerendered
 * either way — the deferred chunk swaps in on the client and nothing suspends.
 */
const DevPhoneBox =
  process.env.NODE_ENV !== "production"
    ? dynamic(() => import("./phone-dev-box").then((mod) => mod.PhoneDevBox), {
        ssr: false,
        loading: () => null,
      })
    : null;

/**
 * The first-run sheet: one blocking question, asked once per account, with
 * **one** way to answer it.
 *
 * The action asks Eitaa itself (`WebApp.requestContact`): the messenger shows its
 * own confirmation and hands back a signed payload, which the server action
 * verifies exactly like `initData` — so the number is the one on *this* account.
 * It is still **not** a login step: Eitaa's rules forbid login by contact data,
 * identity remains `initData`, and the number is only a contact detail the
 * manager reads.
 *
 * There is no hand-typed fallback (a deliberate product rule): the number is
 * collected once and can never be changed by the player — the profile shows it
 * read-only — so a typed number would be an unfixable typo. A refusal from Eitaa
 * is answered with one honest sentence and the same button to try again, and the
 * sheet stays up until it is answered.
 *
 * It lives in the `(app)` layout but decides everything on the client
 * (`ready && user && !user.phone && !answered`), which is what keeps every route
 * in this group a prerenderable shell — the sheet is `null` on the server and on
 * the first client render. Accounts created before this feature, and the manager's
 * own account, get it too: every account answers once. It hands the flow over to
 * `RealNameGate` the moment it is answered.
 */
export function PhoneGate() {
  const { ready, user, devEnabled } = useEitaaRuntime();
  const router = useRouter();
  const answeredId = useAnsweredId(PHONE_ANSWERED_KEY);
  /** What the Eitaa path ended with — a statement about the button, not a field. */
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Which account the sheet is up for, or `null` when it is not shown at all. */
  const eitaaId =
    ready && user && user.phone === null && user.eitaaId !== answeredId ? user.eitaaId : null;

  /* Dev-only console hook, the contact sibling of `window.__eitaaDebugLogin`:
     `window.__eitaaDevContact("09123456789")` runs the whole path — the action
     signs a real payload and `savePhoneFromEitaa` verifies it for real. Registered
     only while the sheet is up, and reached through a **compile-time** guard like
     the box above, so a release bundle holds neither the hook nor its copy. */
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !devEnabled || eitaaId === null) return;

    let cancelled = false;
    let uninstall: (() => void) | undefined;

    void import("./phone-dev-box").then(({ installPhoneDevHook }) => {
      // A teardown may land before the chunk does (React 19 mounts this effect
      // twice in development): never install the hook into a dead mount.
      if (cancelled) return;
      uninstall = installPhoneDevHook({ eitaaId, onSaved: () => router.refresh() });
    });

    return () => {
      cancelled = true;
      uninstall?.();
    };
  }, [devEnabled, eitaaId, router]);

  if (eitaaId === null) return null;

  // The guard above types this as a plain `string`, which is what the transition
  // closures below read (a captured `string | null` loses the narrowing there).
  const accountId = eitaaId;

  /** The one ending: the marker, a toast, a fresh render — and the name sheet. */
  function finish(phone: string) {
    haptic("success");
    rememberAnsweredId(PHONE_ANSWERED_KEY, accountId);
    notifySuccess("شماره‌ت ثبت شد", formatPhoneForDisplay(phone));
    router.refresh();
  }

  function handleEitaa() {
    if (pending) return;
    setMessage(null);

    startTransition(async () => {
      const { sent, raw } = await requestEitaaContact();

      if (!sent || !raw) {
        haptic("error");
        setMessage(CONTACT_MISSING);
        return;
      }

      const result = await savePhoneFromEitaa(raw);

      if (!result.ok) {
        haptic("error");
        // A payload that carried no usable number is the same fact for the
        // player as one that never arrived — and the old "write it yourself"
        // sentence went with the manual path.
        setMessage(
          result.code === "NO_PHONE" || result.code === "MISSING" ? CONTACT_MISSING : result.error,
        );
        return;
      }

      finish(result.phone);
    });
  }

  return (
    <FirstRunSheet
      icon={<IconPhone aria-hidden="true" className="size-7" stroke={1.75} />}
      title="شماره‌ی همراهت رو بفرست"
      description="برای اینکه مدیر بتونه باهات هماهنگ کنه، شماره‌ت رو یک‌بار از خود ایتا می‌گیریم. فقط خودِ مدیر می‌بینتش و شماره بعداً قابل تغییر نیست."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={handleEitaa} disabled={pending} aria-busy={pending}>
            {pending ? (
              <>
                <Spinner aria-hidden="true" />
                در حال گرفتن شماره…
              </>
            ) : (
              <>
                <IconDeviceMobileMessage aria-hidden="true" />
                فرستادن شماره با ایتا
              </>
            )}
          </Button>

          {message ? (
            <p role="alert" className="text-caption text-destructive">
              {message}
            </p>
          ) : null}
        </div>

        {DevPhoneBox && devEnabled ? (
          <DevPhoneBox
            blocked={pending}
            onStart={() => setMessage(null)}
            onSent={finish}
            onFailed={setMessage}
          />
        ) : null}
      </div>
    </FirstRunSheet>
  );
}
