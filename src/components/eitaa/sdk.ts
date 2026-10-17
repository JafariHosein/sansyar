/**
 * The slice of the Eitaa SDK this app actually uses, typed.
 *
 * Everything is optional on purpose: the SDK is a remote script (the only external
 * script allowed in this project) that may be older than the docs, may fail to
 * load, or may simply not be there at all — a plain browser. Every call site must
 * therefore be defensive, and nothing here may be treated as a security decision:
 * the only trusted identity comes from a server-verified `initData`.
 *
 * Verified against the real script (2026-10-16): it reads its launch params from
 * `location.hash` (`tgWebAppData`, `tgWebAppVersion`, …), exposes `initData` /
 * `initDataUnsafe` as getters, writes `--tg-*` CSS custom properties itself, and
 * fires `viewportChanged`, `safeAreaChanged`, `contentSafeAreaChanged`, `themeChanged`.
 * `requestContact(callback)` (line ~2284) posts `web_app_request_phone`, answers
 * through the `phone_requested` event with a **signed** payload, and throws
 * `WebAppMethodUnsupported` / `WebAppContactRequested` instead of calling back.
 */

export type EitaaBackButton = {
  isVisible?: boolean;
  show?: () => void;
  hide?: () => void;
  onClick?: (callback: () => void) => void;
  offClick?: (callback: () => void) => void;
};

export type EitaaHapticFeedback = {
  impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
  notificationOccurred?: (type: "error" | "success" | "warning") => void;
  selectionChanged?: () => void;
};

/**
 * What `requestContact`'s callback receives.
 *
 * `response` is the **raw signed string** (the payload verified like `initData`),
 * `responseUnsafe` is the same thing pre-parsed for convenience and, like
 * `initDataUnsafe`, never trusted. `status` mirrors the SDK's `'sent'`/`'canceled'`.
 */
export type EitaaContactEvent = {
  status?: string;
  response?: string;
  responseUnsafe?: Record<string, unknown>;
};

export type EitaaContactCallback = (sent: boolean, data: EitaaContactEvent) => void;

export type EitaaWebApp = {
  initData: string;
  initDataUnsafe?: Record<string, unknown>;
  version?: string;
  platform?: string;
  colorScheme?: string;
  themeParams?: Record<string, string>;
  isExpanded?: boolean;
  /** `false` until the messenger reports a height — never assume a number. */
  viewportHeight?: number | false;
  viewportStableHeight?: number | false;
  safeAreaInset?: { top?: number; bottom?: number; left?: number; right?: number };
  contentSafeAreaInset?: { top?: number; bottom?: number; left?: number; right?: number };
  ready?: () => void;
  expand?: () => void;
  close?: () => void;
  openLink?: (url: string) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  enableClosingConfirmation?: () => void;
  /**
   * Ask the messenger for the account's own phone number. It opens Eitaa's own
   * native confirmation and hands back a signed payload — the **only** way this
   * app may learn a number it can trust. Throws `WebAppMethodUnsupported` on a
   * client older than 1.0 and `WebAppContactRequested` while one is already open.
   */
  requestContact?: (callback: EitaaContactCallback) => void;
  onEvent?: (event: string, handler: (payload?: unknown) => void) => void;
  offEvent?: (event: string, handler: (payload?: unknown) => void) => void;
  BackButton?: EitaaBackButton;
  HapticFeedback?: EitaaHapticFeedback;
};

/** `window.Eitaa.WebApp`, or `null` when the SDK is absent (a plain browser). */
export function eitaaWebApp(): EitaaWebApp | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { Eitaa?: { WebApp?: EitaaWebApp } }).Eitaa;
  return bridge?.WebApp ?? null;
}

/** The official SDK — the ONLY external script in this project, never self-hosted. */
export const EITAA_SDK_URL = "https://developer.eitaa.com/eitaa-web-app.js";

/** Marks the tag we injected, so it can never be added twice. */
const SDK_TAG_ATTRIBUTE = "data-sansyar-sdk";

/**
 * Make sure the SDK is on its way.
 *
 * `next/script` normally loads it, but this is the one dependency the whole app
 * hangs on: if that tag never materialises the splash would sit there forever.
 * So the bridge injects the script itself when it is not already present — guarded
 * by URL and by our own attribute, so a slow network can never double-load it.
 */
export function ensureEitaaSdk(): void {
  if (typeof document === "undefined") return;
  if (eitaaWebApp()) return;

  const alreadyThere =
    document.querySelector(`script[${SDK_TAG_ATTRIBUTE}]`) !== null ||
    document.querySelector(`script[src="${EITAA_SDK_URL}"]`) !== null;
  if (alreadyThere) return;

  const script = document.createElement("script");
  script.src = EITAA_SDK_URL;
  script.async = true;
  script.setAttribute(SDK_TAG_ATTRIBUTE, "true");
  document.head.appendChild(script);
}

/** Wait for the SDK to define `window.Eitaa.WebApp`, or give up after `timeoutMs`. */
export function waitForEitaaSdk(timeoutMs: number): Promise<EitaaWebApp | null> {
  return new Promise((resolve) => {
    const existing = eitaaWebApp();
    if (existing || typeof window === "undefined") {
      resolve(existing);
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const app = eitaaWebApp();
      if (app || Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer);
        resolve(app ?? null);
      }
    }, 100);
  });
}

/**
 * Inside the mini app? The SDK object exists in a plain browser too (the script
 * loads, it just has nothing to say), so **`initData` being non-empty is the only
 * signal**. Never `initDataUnsafe` — that is display-only data.
 */
export function eitaaInitData(): string | null {
  const initData = eitaaWebApp()?.initData;
  return initData && initData.length > 0 ? initData : null;
}

/** Call an SDK method without letting a missing/older method break the UI. */
export function safely<T>(operation: () => T): T | undefined {
  try {
    return operation();
  } catch {
    return undefined;
  }
}

/**
 * Does this client expose `requestContact` at all?
 *
 * A cheap pre-check for **rendering** decisions only: the SDK defines the method
 * on every client and *throws* `WebAppMethodUnsupported` when the client is older
 * than 1.0, so this can never answer "will it work". The call itself stays
 * defensive (`requestEitaaContact`), which is what keeps an old client on the
 * manual field.
 */
export function canRequestEitaaContact(): boolean {
  return typeof eitaaWebApp()?.requestContact === "function";
}

/**
 * How long to stay on one native request before giving up.
 *
 * Long enough to read the popup and confirm, short enough that a client which
 * never answers (a dismissed prompt, a build that does not emit
 * `phone_requested`) cannot park the sheet on a spinner forever — the same
 * "the splash can never hang" posture as the bridge's `DETECTION_DEADLINE_MS`.
 */
export const CONTACT_DEADLINE_MS = 30_000;

/**
 * Ask Eitaa for the account's own number.
 *
 * Resolves **exactly once** and never rejects. Every ending that is not a real
 * answer collapses into `{ sent: false, raw: null }`: a declined confirmation
 * (`sent: false`), a client that cannot do it (the SDK's throws —
 * `WebAppMethodUnsupported` on an older version, `WebAppContactRequested` while
 * another request is in flight), no SDK at all, a misbehaving callback that
 * fires twice, and the deadline above. The caller's job is one sentence, not an
 * error path — the manual field is always behind it.
 */
export function requestEitaaContact(): Promise<{ sent: boolean; raw: string | null }> {
  return new Promise((resolve) => {
    const app = eitaaWebApp();
    if (!app || typeof app.requestContact !== "function") {
      resolve({ sent: false, raw: null });
      return;
    }

    let settled = false;
    const settle = (sent: boolean, raw: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve({ sent, raw });
    };

    // Declared after `settle` on purpose: the closure only ever reads it from a
    // later macrotask (or from the `!accepted` line below), so there is no TDZ.
    const deadline = setTimeout(() => settle(false, null), CONTACT_DEADLINE_MS);

    // `safely` swallows the SDK's throws; the `return true` is only reached when
    // the call was accepted, which is how a throw is told apart from `undefined`.
    const accepted = safely(() => {
      app.requestContact?.((sent, data) => {
        const raw = data?.response;
        settle(sent === true, typeof raw === "string" && raw.length > 0 ? raw : null);
      });
      return true;
    });

    if (!accepted) settle(false, null);
  });
}
