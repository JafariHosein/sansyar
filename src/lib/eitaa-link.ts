/**
 * The **only** place that shapes an Eitaa link (PROMPT.md §13.6).
 *
 * A session link carries the start param — `start_param` inside the signed
 * `initData` (Eitaa's docs: the value of the GET param `tgWebAppStartParam` on
 * the mini-app URL) — **and** a `btn` param: the Eitaa **Android** client renders
 * a button under any message whose app link carries `&btn=<label>`, labelled with
 * the **raw** value (never percent-decoded, so the label must stay Persian text;
 * Eitaa's own `@trendingapps` posts and its survey link use the same param). The
 * web and desktop clients render no button — the link itself stays tappable
 * there, so it must never be dropped from a message. The «دکمه» fields in the
 * EitaaYar panel are a different thing: the program's card inside its own chat.
 *
 * Pure on purpose — no env, no `server-only` — so the server config accessor
 * (`getEitaaLinkConfig` in `src/lib/eitaa.ts`), admin actions and the check script
 * all share one implementation.
 *
 * ⚠️ The exact link shape is not documented by Eitaa (it mirrors Telegram's
 * `?startapp=`). Verify on a real device and fix it by editing `EITAA_LINK_TEMPLATE`
 * only — never by building a URL somewhere else.
 */

/** Start-param prefix for a session deep link. `[A-Za-z0-9_-]` only, max 512 chars. */
export const SESSION_START_PREFIX = "s_";

/** Fallback template; `{username}` comes from `EITAA_APP_USERNAME`. */
export const DEFAULT_LINK_TEMPLATE = "https://eitaa.com/{username}?startapp={start}";

/**
 * The Android-only button's label, appended as `&btn=<label>` to every link that
 * carries a start param — **raw**, never `encodeURIComponent`d: the client shows
 * the value verbatim (a percent-encoded label renders as `%D8%…` on the button).
 */
export const LINK_BUTTON_LABEL = "ثبت‌نام";

/** URL params that may carry a start param (checked client-side, navigation only). */
export const START_PARAM_QUERY_KEYS = ["tgWebAppStartParam", "startapp", "start_param"] as const;

/** Prisma `cuid()` ids (25 chars) plus room for other id shapes. */
const SESSION_ID = /^[A-Za-z0-9_-]{6,64}$/;

export type EitaaLinkConfig = {
  /** `EITAA_APP_USERNAME` — the app's shortname from the EitaaYar panel. */
  username: string | null;
  /** `EITAA_LINK_TEMPLATE` — full override containing `{start}`. */
  template: string | null;
};

export type StartTarget = { kind: "session"; sessionId: string };

/** `s_<sessionId>` — the start param that opens one session. */
export function sessionStartParam(sessionId: string): string {
  return `${SESSION_START_PREFIX}${sessionId}`;
}

/** Where a start param leads. Unknown or malformed values fall back to the home screen. */
export function parseStartTarget(startParam: string | null | undefined): StartTarget | null {
  if (!startParam) return null;
  if (!startParam.startsWith(SESSION_START_PREFIX)) return null;
  const sessionId = startParam.slice(SESSION_START_PREFIX.length);
  return SESSION_ID.test(sessionId) ? { kind: "session", sessionId } : null;
}

/** The route a start target maps to. */
export function targetPath(target: StartTarget): string {
  return `/sessions/${target.sessionId}`;
}

/** The template in effect: explicit override first, then `{username}`, else none. */
export function resolveTemplate(config: EitaaLinkConfig): string | null {
  const template = config.template?.trim();
  if (template) return template;
  const username = config.username?.trim();
  if (!username) return null;
  return DEFAULT_LINK_TEMPLATE.replace("{username}", username);
}

/** The app's link with the start placeholder removed — the «باز کردن در ایتا» target. */
export function buildBaseLink(config: EitaaLinkConfig): string | null {
  const template = resolveTemplate(config);
  if (!template) return null;

  const stripped = template
    .replace(/[?&][^?&=]+=\s*\{start\}/g, "")
    .replace(/[?&]+$/, "")
    .replace(/\{start\}/g, "");

  // A template whose start param is followed by others (`…?startapp={start}&btn=…`)
  // leaves a bare `&` behind; promote it so the leftovers stay a query string.
  if (!stripped.includes("?")) {
    const amp = stripped.indexOf("&");
    if (amp !== -1) return `${stripped.slice(0, amp)}?${stripped.slice(amp + 1)}`;
  }
  return stripped;
}

/** A full app link carrying `startParam` (or the bare app link when omitted). */
export function buildAppLink(config: EitaaLinkConfig, startParam?: string | null): string | null {
  const template = resolveTemplate(config);
  if (!template) return null;
  if (!startParam) return buildBaseLink(config);

  const encoded = encodeURIComponent(startParam);
  const link = template.includes("{start}")
    ? template.replace(/\{start\}/g, encoded)
    : `${template}${template.includes("?") ? "&" : "?"}startapp=${encoded}`;
  return withLinkButton(link);
}

/** Adds the Android button label unless the template pins its own `btn`. */
function withLinkButton(link: string): string {
  return /[?&]btn=/.test(link) ? link : `${link}&btn=${LINK_BUTTON_LABEL}`;
}

/** The share link for one session. */
export function buildSessionLink(config: EitaaLinkConfig, sessionId: string): string | null {
  return buildAppLink(config, sessionStartParam(sessionId));
}

/**
 * A start param visible in the current URL.
 *
 * Display/navigation only — the value that counts is the verified `start_param`
 * inside `initData` (see `verifyInitData`), which is what the server action returns.
 * Eitaa delivers it as the GET param `tgWebAppStartParam`; telemetry has been seen
 * with all three spellings, so all three are read.
 */
export function startParamFromUrl(search: string, hash: string): string | null {
  for (const source of [hash, search]) {
    const query = source.startsWith("#") || source.startsWith("?") ? source.slice(1) : source;
    if (!query) continue;
    const params = new URLSearchParams(query);
    for (const key of START_PARAM_QUERY_KEYS) {
      const value = params.get(key);
      if (value) return value;
    }
  }
  return null;
}
