"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { DevPanelSlot } from "@/components/dev/dev-panel-slot";
import { isTabRoot } from "@/components/layout/nav";
import { haptic } from "@/components/eitaa/haptics";
import { OutsideEitaa } from "@/components/eitaa/outside-eitaa";
import { EitaaRuntimeContext, type EitaaRuntimeState } from "@/components/eitaa/runtime-context";
import {
  ensureEitaaSdk,
  eitaaWebApp,
  safely,
  waitForEitaaSdk,
} from "@/components/eitaa/sdk";
import { EitaaSplash } from "@/components/eitaa/splash";
import { parseStartTarget, startParamFromUrl, targetPath } from "@/lib/eitaa-link";
import { notifyError } from "@/lib/toast";
import type { SessionUserPayload } from "@/server/actions/results";
import { eitaaLogin } from "@/server/actions/eitaa-auth";
import { canOpenSession } from "@/server/actions/session-link";

/** How long to wait for the SDK before declaring "this is not Eitaa". */
const SDK_TIMEOUT_MS = 3000;
/** Absolute ceiling: the splash is never allowed to outlive this. */
const DETECTION_DEADLINE_MS = 4500;

type Phase = "detecting" | "outside" | "rejected" | "ready";

/**
 * The pathname, read **inside** a `<Suspense>` boundary.
 *
 * `usePathname()` is runtime-only URL data, and the bridge sits in the root
 * layout, which is prerendered for every route. Calling the hook directly in the
 * bridge blocked the shell of the dynamic route (`/sessions/[id]`) with
 * `CLIENT_HOOK_DYNAMIC` — «usePathname() in a Client Component outside of
 * <Suspense>» — which failed `next build` outright. The bridge needs the pathname
 * only *after* hydration, to decide whether Eitaa shows its BackButton, so the
 * hook lives here and streams in with the first client render.
 */
function PathnameWatcher({ onPathname }: { onPathname: (pathname: string) => void }) {
  const pathname = usePathname();

  useEffect(() => {
    onPathname(pathname);
  }, [onPathname, pathname]);

  return null;
}

/**
 * The Eitaa bridge — mounted once in the root layout, wrapping every screen.
 *
 * Order of operations (PROMPT.md §13.3):
 *  1. wait briefly for the SDK, then decide: `initData` non-empty means we are
 *     inside the messenger, anything else renders the gate;
 *  2. unify the chrome with our light design and track the stable viewport height;
 *  3. **preload login**: post `initData` to the server action and keep the splash
 *     up until it is confirmed, so logged-out content is never visible;
 *  4. route a `start_param` (`s_<id>`) to its session, wire the BackButton, and let
 *     the tab bar see the role through context.
 */
export function EitaaRuntime({
  children,
  appLink,
  devEnabled,
}: {
  children: React.ReactNode;
  /** Gate button target, built on the server by `src/lib/eitaa-link.ts`. */
  appLink: string | null;
  /** True only in development with the simulator switched on. */
  devEnabled: boolean;
}) {
  const router = useRouter();
  /** `null` until `PathnameWatcher` mounts — see the component above. */
  const [pathname, setPathname] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("detecting");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUserPayload | null>(null);
  const [inside, setInside] = useState(false);
  /** `performance.now()` when the current boot attempt started — see the nudge below. */
  const bootStartedAt = useRef(0);

  const reveal = useCallback((next: SessionUserPayload) => {
    setUser(next);
    setError(null);
    setPhase("ready");
  }, []);

  /* 1–3. Detect the runtime, then log in before showing anything. */
  useEffect(() => {
    // No "already booted" ref here: React 19 mounts effects twice in development
    // and the first pass is cancelled, so a one-shot guard would leave the splash
    // up forever. The login is idempotent, so running it twice is harmless.
    let cancelled = false;
    bootStartedAt.current = performance.now();

    void (async () => {
      // Load the official SDK ourselves — never via `next/script`, which would put
      // the tag in the RSC tree and break hydration (see `ensureEitaaSdk`).
      // Inside Eitaa this resolves in a few milliseconds.
      ensureEitaaSdk();
      const webApp = await waitForEitaaSdk(SDK_TIMEOUT_MS);
      if (cancelled) return;

      const initData = webApp?.initData;
      if (!webApp || !initData) {
        // No SDK, or the SDK loaded but the messenger never handed us a payload:
        // a plain browser. There is no alternative way in.
        document.documentElement.dataset.runtime = "outside";
        setPhase("outside");
        return;
      }

      document.documentElement.dataset.runtime = "eitaa";
      setInside(true);

      const result = await eitaaLogin(initData);
      if (cancelled) return;

      if (!result.ok) {
        setError(result.error);
        setPhase("rejected");
        return;
      }

      reveal(result.user);
      haptic("success");

      // The verified `start_param` wins; the URL copy is only a display fallback.
      const target = parseStartTarget(
        result.startParam ?? startParamFromUrl(window.location.search, window.location.hash),
      );

      if (!target) {
        router.refresh();
        return;
      }

      // A shared link outlives its session more often than one would like, so the
      // target is checked before navigating (§۱۳.۶): a stale link must land on the
      // board with a reason, never on a page that only says "not found".
      const openable = await canOpenSession(target.sessionId);
      if (cancelled) return;

      if (!openable) {
        notifyError("سانس مورد نظر پیدا نشد", "شاید حذف شده باشد — سانس‌های باز را ببین.");
        router.replace("/");
        return;
      }

      router.replace(targetPath(target));
    })();

    return () => {
      cancelled = true;
    };
  }, [reveal, router]);

  /* Never leave the splash up forever: whatever happens above, this is the ceiling. */
  useEffect(() => {
    if (phase !== "detecting") return;
    const timer = window.setTimeout(() => {
      setPhase((current) => (current === "detecting" ? "outside" : current));
    }, DETECTION_DEADLINE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  /* A hidden tab freezes timers (Chrome throttling), so a phone that is backgrounded
     while the splash is up can come back to a page that is still «detecting» long
     after the deadline. Settle the phase the moment the tab is visible again instead
     of waiting for the frozen timers. */
  useEffect(() => {
    if (phase !== "detecting") return;

    const settle = () => {
      if (document.visibilityState !== "visible") return;
      // The boot effect still owns the "inside Eitaa" verdict: a payload that arrived
      // while we were hidden resumes on the next tick, so never race it here.
      if (eitaaWebApp()?.initData) return;
      // A tab that has only just become visible keeps the normal grace period — on a
      // real device the SDK arrives inside it, and a premature gate would be worse
      // than a slightly longer splash.
      if (performance.now() - bootStartedAt.current < SDK_TIMEOUT_MS) return;

      document.documentElement.dataset.runtime = "outside";
      setPhase("outside");
    };

    document.addEventListener("visibilitychange", settle);
    window.addEventListener("focus", settle);
    window.addEventListener("pageshow", settle);
    return () => {
      document.removeEventListener("visibilitychange", settle);
      window.removeEventListener("focus", settle);
      window.removeEventListener("pageshow", settle);
    };
  }, [phase]);

  /* Chrome, viewport height and safe areas. */
  useEffect(() => {
    if (!inside) return;
    const app = eitaaWebApp();
    if (!app) return;

    safely(() => app.ready?.());
    safely(() => app.expand?.());

    // Fixed light chrome (DESIGN_SYSTEM.md §3): the messenger's dark theme is
    // ignored on purpose, so our header never sits on a black bar.
    safely(() => app.setHeaderColor?.("#FFFFFF"));
    safely(() => app.setBackgroundColor?.("#F7F8F5"));
    safely(() => app.setBottomBarColor?.("#FFFFFF"));

    // The SDK writes `--tg-viewport-stable-height`, but `--app-vh` is ours and
    // must reflect the *stable* height so the layout does not jump while the
    // keyboard opens. `viewportStableHeight` is `false` until it is reported.
    const syncViewport = () => {
      const height = app.viewportStableHeight;
      if (typeof height === "number" && height > 0) {
        document.documentElement.style.setProperty("--app-vh", `${height}px`);
      }
    };
    syncViewport();
    app.onEvent?.("viewportChanged", syncViewport);
    app.onEvent?.("safeAreaChanged", syncViewport);
    app.onEvent?.("contentSafeAreaChanged", syncViewport);

    return () => {
      app.offEvent?.("viewportChanged", syncViewport);
      app.offEvent?.("safeAreaChanged", syncViewport);
      app.offEvent?.("contentSafeAreaChanged", syncViewport);
    };
  }, [inside]);

  /* BackButton: shown on every route except the tab roots, where Eitaa closes the app. */
  useEffect(() => {
    if (!inside || pathname === null) return;
    const backButton = eitaaWebApp()?.BackButton;
    if (!backButton) return;

    if (isTabRoot(pathname)) {
      safely(() => backButton.hide?.());
      return;
    }

    safely(() => backButton.show?.());
    const onClick = () => router.back();
    safely(() => backButton.onClick?.(onClick));
    return () => {
      safely(() => backButton.offClick?.(onClick));
    };
  }, [inside, pathname, router]);

  /* Dev-only console hook: `window.__eitaaDebugLogin("<initData>")`.
     The payload comes from `npx.cmd tsx scripts/eitaa-sign-initdata.ts` and is
     verified by the same server action as a real login. The guard below is a
     **compile-time** one on purpose: the bundler folds it away in a release, so a
     production bundle never even references the dev module — what decides whether
     the simulator is *available* stays `devEnabled` (false outside development, and
     every action behind it re-checks `EITAA_DEV_LOGIN`). */
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !devEnabled) return;

    let cancelled = false;
    let uninstall: (() => void) | undefined;

    void import("@/components/dev/dev-console").then(({ installDebugLogin }) => {
      // A teardown may land before the chunk does (React 19 mounts this effect
      // twice in development): never install the hook into a dead mount.
      if (cancelled) return;
      uninstall = installDebugLogin({
        onLoggedIn: (next) => {
          reveal(next);
          router.refresh();
        },
        onRejected: (message) => {
          // Same shape as a refused real login (see the boot above): Eitaa was here,
          // the server said no, and the gate renders the retry story.
          document.documentElement.dataset.runtime = "eitaa";
          setInside(true);
          setError(message);
          setPhase("rejected");
        },
      });
    });

    return () => {
      cancelled = true;
      uninstall?.();
    };
  }, [devEnabled, reveal, router]);

  const context = useMemo<EitaaRuntimeState>(
    () => ({ inside, ready: phase === "ready", user, devEnabled }),
    [inside, phase, user, devEnabled],
  );

  const revealed = phase === "ready";

  return (
    <EitaaRuntimeContext.Provider value={context}>
      {/* Deferred URL data: a direct `usePathname()` in this component blocks the
          prerender of every dynamic route (see `PathnameWatcher`). */}
      <Suspense fallback={null}>
        <PathnameWatcher onPathname={setPathname} />
      </Suspense>

      <div data-app-content inert={!revealed} aria-hidden={!revealed}>
        {children}
      </div>

      {revealed ? null : (
        // Opaque, full-viewport and present in the server HTML, so the first paint
        // is the splash and no app content can flash behind it.
        <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
          {phase === "detecting" ? (
            <EitaaSplash appLink={appLink} />
          ) : (
            <OutsideEitaa
              appLink={appLink}
              error={error}
              devSlot={
                <DevPanelSlot
                  enabled={devEnabled}
                  onLoggedIn={(next) => {
                    reveal(next);
                    router.refresh();
                  }}
                />
              }
            />
          )}
        </div>
      )}
    </EitaaRuntimeContext.Provider>
  );
}

