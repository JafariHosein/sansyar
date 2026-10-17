---
name: Eitaa Mini App (برنامک)
description: How Sansyar runs as an Eitaa mini app (برنامک) and ONLY as that — EitaaYar registration, the official SDK script, seamless initData login with server-side HMAC-SHA256 verification (no SMS/OTP and no number-based login), the "only inside Eitaa" gate overlay, admin identification by EITAA id, session share links with startapp deep links, BackButton/viewport/safe-area behavior, local simulation and real-device debugging. Use whenever touching Eitaa integration, mini-app auth, share links, or WebView-specific UI.
---

# Eitaa Mini App (برنامک) — Sansyar

Sansyar is **not a website that also works in Eitaa** — it is an Eitaa mini app, full stop.
The whole product (users *and* admin) runs inside Eitaa's WebView. There is **no SMS and no OTP
anywhere**, and no login path tied to a number; opening the URL in a normal browser shows a branded
"only works inside Eitaa" page instead of the app. The single number the product holds is
`User.phone` — a contact number for the manager, asked once on the first run. The sheet's primary
action is Eitaa's own **`WebApp.requestContact`**: the callback hands back a signed
`key=value&…&hash=` string, the server verifies it **exactly like `initData`** and stores the
number; typing stays as the fallback when the player declines (or the client is too old). It is
never a login, never SMS-verified and never shown to another player.

## Source of truth

- Official docs: `https://developer.eitaa.com/docs` — pages: Home, Introduction, QuickStart,
  JsSDK, AuthorizationViaHash, ValidateHash, ManagementPanel, TestAndDebug, **WebNotice**, FAQ.
- Developer rules (binding): `https://eitaa.com/pg/terms/mini-apps`.
- Docs source repo (raw markdown, easy to grep): `https://github.com/eitaa/Documentation`
  (`docs/**`). Official Next.js examples: `ExamplesAndPackages/FinanceSampleNextJs.md`,
  `ExamplesAndPackages/ToDoSampleNextJs.md`.
- When docs and this skill disagree, the docs win; then update this skill.

## Platform facts

- A mini app is registered in the **EitaaYar** panel (`https://eitaayar.ir` → «برنامه» →
  developer authentication → «افزودن برنامه»).
- Runs on **Android** + **Windows-desktop Eitaa** (QuickStart) and in **Eitaa web**, which loads
  the app inside an `<iframe>` (WebNotice). iOS is not supported yet.
- The destination URL must be **HTTPS and must not redirect** — register the site root
  (`https://<domain>/`) and make the root return **200** even outside Eitaa (the gate overlay), never 30x.
- Eitaa passes user data as a signed query-string called **`initData`** (plus a
  `tgWebAppStartParam` GET param). Server-side verification is mandatory for trust.
- **Rules from `eitaa.com/pg/terms/mini-apps` (mandatory):** login must use **Init Data** and be
  verified **server-side**; login via **Contact Data (phone) is forbidden**; the login must run
  **before the app loads (preload)**; the **Back Button must be supported**; don't collect more
  data than needed.
  The ban is on *logging in* with contact data — Sansyar's one use of `requestContact` fills
  `User.phone` (a contact detail), never the identity; see § Contact number below.

## SDK loading & detection

Official script — **must be loaded from the official URL, never self-hosted or bundled**
(docs warn: updates, security, client compatibility). It is the only allowed external script.

```tsx
// src/components/eitaa/eitaa-runtime.tsx — loaded BY THE BRIDGE, not by next/script
ensureEitaaSdk();                              // src/components/eitaa/sdk.ts
const webApp = await waitForEitaaSdk(3000);    // window.Eitaa.WebApp, or null
```

> ⚠️ **Do not use `next/script strategy="beforeInteractive"` here.** In Next 16 + React 19 the tag
> is rendered inside the RSC tree, so React reports *"A tree hydrated but some attributes of the
> server rendered HTML didn't match"*, hydration never completes, the client tree stays inert and
> the splash never advances (the tag still loads, which makes it look like a timing bug). The
> bridge injects the identical tag itself, guarded so it can only ever be added once, and the
> screen is additionally capped by a hard 4.5s deadline that falls back to the gate overlay.

Verified by reading the real script (2026-10-16, 84KB, not obfuscated):

- Launch params come from **`location.hash`** (`tgWebAppData`, `tgWebAppVersion`,
  `tgWebAppPlatform`, `tgWebAppThemeParams`, `tgWebAppFullscreen`, `tgWebAppShowSettings`), and are
  cached in `sessionStorage`, so a reload keeps them.
- `initDataUnsafe` is `URLSearchParams(tgWebAppData)` with JSON-looking values decoded.
- There is **no `startParam` getter**. A start param arrives as the `start_param` key *inside the
  signed `initData`* (docs: the value of the GET param `tgWebAppStartParam` on the mini-app URL).
  Routing may use the URL copy as a fallback; everything else uses the verified value.
- It writes its own CSS variables on `document.documentElement.style`:
  `--tg-viewport-height`, `--tg-viewport-stable-height`, `--tg-safe-area-inset-*`,
  `--tg-content-safe-area-inset-*`. The `--tg-` prefix is built at runtime, so grepping the
  minified file for `--tg-` finds nothing — the variables are real.
- Events: `viewport_changed`, `safe_area_changed`, `content_safe_area_changed`, `theme_changed`,
  `activated`, `deactivated`, `visibility_changed`, `fullscreen_changed`, `back_button_pressed`.
- API present (Telegram parity): `ready`, `expand`, `close`, `openLink`, `setHeaderColor`,
  `setBackgroundColor`, `setBottomBarColor`, `enableClosingConfirmation`, `enableVerticalSwipes`,
  `viewportHeight`, `viewportStableHeight`, `safeAreaInset`, `contentSafeAreaInset`, `BackButton`,
  `MainButton`, `SecondaryButton`, `SettingsButton`, `HapticFeedback` (`impactOccurred` /
  `notificationOccurred` / `selectionChanged`), `showAlert`, `showConfirm`, `showPopup`,
  `requestWriteAccess`, `addToHomeScreen`, `lockOrientation`, `showProgress`, `hideProgress`,
  `onEvent`, `offEvent`. **Absent:** `sendData`, `CloudStorage`, `requestLocation`,
  `readTextFromClipboard`, `openInvoice`, `shareToStory`.

**`window.Eitaa` exists in a plain browser too** — the script loads and simply has no `initData`.
So `window.Eitaa !== undefined` is *not* a signal of being inside the mini app: the only signal is a
**non-empty `initData`**. **Never set `X-Frame-Options` or CSP `frame-ancestors`** — Eitaa web
embeds the app in an iframe and those headers blank it out.

## Server-side initData verification (the critical part)

Algorithm (exactly as documented in `AuthorizationViaHash.md`):

1. Split `initData` into `key=value` pairs; set `hash` aside.
2. Sort the remaining pairs alphabetically (`"key=value"` strings).
3. Join with `\n` → data-check-string.
4. `secret = HMAC-SHA256(key = "WebAppData", message = bot_token)` → **raw bytes**, not the hex string.
5. `mac = HMAC-SHA256(key = that secret (raw bytes), message = data-check-string)` → hex.
6. Timing-safe compare with `hash`.

> ⚠️ **The key of the second HMAC is the raw digest, not its hex string.** Feeding `.digest("hex")`
> back in as the key is a tempting misreading of the docs and produces a *different* mac — it fails
> the official test vector below (`19ec4dfd…` instead of `c3bb1efc…`). Verified against the vector
> in `scripts/check-eitaa-signature.ts`; the bundled Telegram reference
> (`telegram-webapps/references/backend-validation.md`) agrees: `.createHmac("sha256", secretKey)`.

```ts
// src/lib/eitaa.ts — server-only
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyEitaaInitData(
  initData: string,
  botToken: string,
  maxAgeHours = 24, // 0 = skip auth_date check (for the official test vector)
) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!hash || !authDate) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const mac = createHmac("sha256", secret).update(dataCheckString).digest();
  const expected = Buffer.from(hash, "hex");
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  if (maxAgeHours > 0 && Date.now() - authDate * 1000 > maxAgeHours * 3_600_000) return null;

  const user = JSON.parse(params.get("user") ?? "null") as
    | { id: number | string; first_name?: string; last_name?: string }
    | null;
  if (!user?.id || !user.first_name) return null;

  return { user: { ...user, id: String(user.id) }, startParam: params.get("start_param") };
}
```

- `user.id` has up to 52 significant bits → store as **String** (`User.eitaaId String @unique`).
- Always check `auth_date` freshness in production (24h default).
- Optional extra (off by default): remote `POST https://eitaayar.ir/api/app/verify`
  with `{token, hash, ip}` — single-use, 1-minute window, max 20 req/s per IP.
- Official **test vector** (from `AuthorizationViaHash.md`) — verify the implementation
  against it in `scripts/check-eitaa-signature.ts`:
  - token: `5768337691:AAGDAe6rjxu1cUgxK4BizYi--Utc3J9v5AU`
  - initData: `auth_date=1709144340&device_id=5d41402abc4b2a76b9719d911017c592&chat_instance=-3788475317572404878&chat_type=private&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22%D9%85%D9%87%D8%AF%DB%8C%22%2C%22last_name%22%3A%22%D9%87%D8%A7%D8%B4%D9%85%DB%8C%22%2C%22language_code%22%3A%22fa%22%2C%22allows_write_to_pm%22%3Atrue%7D&hash=c3bb1efcada7b75eec382110554ab07e57622e982a72cac38ba3e64f51d40bb9`
  - expected: valid; `user.id === "279058397"`, name «مهدی هاشمی» (skip the age check).

## Login flow (preload, no OTP)

Implemented by `src/components/eitaa/eitaa-runtime.tsx`, mounted once in the root layout:

1. Detect mini-app mode: a **non-empty `initData`** is the only signal (the SDK's `window.Eitaa`
   exists in a plain browser too). If absent → **gate overlay**: the branded "open inside Eitaa"
   screen, rendered by this bridge as an overlay — **not a route** — HTTP 200, no redirect, `document.documentElement.dataset.runtime = "outside"`.
   The overlay is part of the server render, so the first paint is already the splash and app
   content can never flash.
2. `ready()` + `expand()` immediately; `document.documentElement.dataset.runtime = "eitaa"`.
3. Unify chrome colors with the brand (light UI always, even if Eitaa is in dark mode):
   `setHeaderColor("#FFFFFF")`, `setBackgroundColor`/`setBottomBarColor` = app bg token.
   Ignore `themeChanged` on purpose.
4. **Preload login (required by the rules)**: keep the branded splash up, send `initData` to the
   server action `eitaaLogin(initData)`, and **do not render app content until the login is
   confirmed** — the "logged-out" flash must never be visible. Then `router.refresh()`.
5. Map `start_param`: for `s_<sessionId>` ask the `canOpenSession` server action first, then
   `router.replace("/sessions/<id>")`. A missing or unpublished id (or any non-session param) keeps
   the player on the board with a «سانس مورد نظر پیدا نشد» toast — a share link outlives its session,
   and its holder deserves a reason instead of a 404 (PROMPT.md §۱۳.۶).
6. BackButton: `show()` + `onClick(() => router.back())` on non-root routes, `hide()` on root tab
   routes; refresh visibility after every navigation.
7. `haptic("success"|"error"|"light")` helper (`src/components/eitaa/haptics.ts`) — Eitaa
   `HapticFeedback` only, always alongside a visible change.
8. If the SDK never appears (`waitForEitaaSdk(3000)`) or detection stalls, the hard
   `DETECTION_DEADLINE_MS = 4500` ceiling shows the gate overlay: "open Sansyar from inside
   Eitaa" — there is **no alternative login path**.

> ⚠️ Do not guard the boot effect with a one-shot `useRef`: React 19 mounts effects twice in
> development, the first pass is cancelled, and the second returns early — the splash then hangs
> forever. The login is idempotent precisely so it can run twice.

- Server action `eitaaLogin` (`src/server/actions/eitaa-auth.ts`):
  - `EITAA_BOT_TOKEN` empty → explicit error («برنامک ایتا فعال نیست»).
  - Verify via `verifyEitaaInitData`; invalid/expired → error.
  - `upsert` user by `eitaaId` (name = `first_name + last_name`; `role = ADMIN` when the id is in
    `ADMIN_EITAA_ID` — and a row that is already `ADMIN` stays that way, because a login
    **promotes, never demotes**; do **not** overwrite a name the user later customized),
    then set the signed cookie session. Must be idempotent (safe to call repeatedly).
- **Never trust `initDataUnsafe`** for anything security-related — navigation/display only.

## Contact number (`requestContact`) — not a login

The first-run sheet («شمارهی همراهت رو بفرست») leads with Eitaa's own **`WebApp.requestContact`**
(verified against the live SDK: it posts `web_app_request_phone`, resolves through the
`phone_requested` event, throws `WebAppMethodUnsupported` on older clients and
`WebAppContactRequested` while another request is pending — both swallowed in
`requestEitaaContact`, `src/components/eitaa/sdk.ts`). The callback is
`(sent, { status, response })`; **`response` is a signed string** — Eitaa's docs: «رشتهای از
دادههای تماس کاربر به همراه یک هش … همانند initData از صحت آن مطمئن شوید»:

1. The client POSTs the **raw string** to `savePhoneFromEitaa` (`src/server/actions/profile.ts`).
2. `verifyContact` (`src/lib/eitaa-contact.ts`) reuses `src/lib/eitaa-signature.ts` — **one HMAC
   recipe for both payload types**, never a second copy: mac over the sorted `key=value` lines,
   `secret = HMAC-SHA256(key="WebAppData", msg=bot_token)` **raw digest**, timing-safe compare,
   `auth_date` freshness with the same 24h rule as `initData`.
3. Extraction is **tolerant on purpose** (Eitaa documents no key names for this payload):
   `phone_number` / `phone` / `contact` (JSON or plain), then any value that `normalizePhone`
   accepts; identifiers (`user_id`, `id`, `auth_date`, `user`) are never read as a phone. The
   requester id is compared with the signed-in account when present (`user_id`, `sender_user_id`,
   or an id inside `user`/`contact` JSON — a bare top-level `id` is ignored by design: an
   ambiguous key would refuse *valid* numbers).
4. Nothing is stored unless the signature verifies. On refusal the server logs **parameter keys
   only** — the payload carries a personal number.
5. `CONTACT_DEADLINE_MS = 30_000` ends the wait when a native sheet never answers (same
   "nothing may hang" posture as the splash's `DETECTION_DEADLINE_MS`), and there is **no typed
   fallback at all** (the owner removed it): decline / older client → «ایتا شماره‌ای نفرستاد —
   یک‌بار دیگه امتحان کن.» and the only action is retrying the same Eitaa call — without a number
   the player cannot use the app. The number is **immutable after saving** (`savePhoneFromEitaa`
   answers `LOCKED` for any different value; only a manager can fix it in the DB), and the same
   first-run flow then asks for the **real-name pair** (`RealNameGate` → `saveRealName`) — stored
   separately from the Eitaa display name and just as immutable. Verification failure → «این شماره
   از ایتا تأیید نشد — یک‌بار دیگه امتحان کن.»
6. Dev: `devContact` (`src/server/actions/dev-contact.ts`) signs a **real** payload with the same
   bot token and the sheet's dev box (plus `window.__eitaaDevContact`) feeds it through the real
   `savePhoneFromEitaa` — signature check included. Inert in production like `devLogin`.

## Gate: outside Eitaa

- No `/login`, no OTP, no login by number. A browser without a valid Eitaa context gets the same branded **«سانسیار فقط از داخل ایتا باز میشود»** overlay from `EitaaRuntime` — the gate is **not a route**. (The contact-number sheet and the real-name sheet inside the Eitaa runtime are different, later overlays: they only appear after a verified login and only until saved.)
  Logo, one clear sentence, a primary
  «باز کردن در ایتا» button (built from `EITAA_APP_USERNAME` / `EITAA_LINK_TEMPLATE`), and a short
  3-step guide.
- **Return 200, never a 30x** — the EitaaYar destination URL is the site root, and redirects break
  registration/entry. The bridge also sets `document.documentElement.dataset.runtime = "outside"`.

## Session share links (the link is the way in; Android adds a button)

- **The link is the entry point.** A click goes through the client's `processWebAppLink` →
  `{domain, appname, startapp, mode}` → WebView; the `start_param` then arrives inside the signed
  `initData`. The message API accepts only `token/chat_id/text` (**no keyboard/markup**).
- **The Android-only button**: Eitaa **Android** renders a button under any message whose app link
  carries `&btn=<label>` — the label is shown **raw** (never percent-decoded, so it must stay
  Persian text and must never be `encodeURIComponent`d; a percent-encoded label shows up literally
  as `%D8%…` — verified on the owner's device, مهر ۱۴۰۵). Eitaa's own multi-word labels are written
  with dots (`@trendingapps`: `…&btn=برنامک.بازی.سودوکو`; the client's own survey link:
  `btn=شروع.نظرسنجی`). The **web client has no `btn` handling at all** (grepped 5.1/704) and
  desktop draws none — there the plain link must carry the whole job. The other affordances are
  unchanged: the small «باز کردن» button on the program's row in the chat list
  (`chatlist-mini-app-btn`, lang key `MiniApps.OpenApp`), and the panel's
  «عنوان دکمه / آدرس دکمه / عکس شروع / پیام شروع», which build the **program's card inside its
  own chat** — a different surface from the per-message button; never confuse the two.
- Build share links ONLY through `src/lib/eitaa-link.ts`:
  - `startParam = `s_${sessionId}`` — `[A-Za-z0-9_-]` only, max 512 chars.
  - Template: `EITAA_LINK_TEMPLATE` (with `{start}`) or default
    `https://eitaa.com/<EITAA_APP_USERNAME>?startapp={start}`. `buildAppLink` appends
    `&btn=ثبت‌نام` (`LINK_BUTTON_LABEL`) to every start-param link; a template that pins its own
    `btn` wins.
  - Docs confirm `start_param` reaches the app as "the value of the GET param `tgWebAppStartParam`
    on the mini-app URL" (i.e. inside the signed `initData`), and Eitaa's own «ارسال داده به برنامک»
    example is `https://eitaa.com/app/miniapp?startapp=data`. Our handed-out shape
    (`https://eitaa.com/<program>/<shortname>?startapp=…`) was verified live: it serves Eitaa's own
    landing page («بازکردن برنامه» + `et://resolve?domain=…&appname=…&startapp=…`) and the client
    parses `<domain>/<appname>?startapp=`. Keep it in one module.
- The admin panel produces a ready-to-paste Persian message (Jalali date, Persian digits, تومان)
  plus the link on its own line, with copy buttons; the CTA line («روی دکمه یا لینک زیر بزن 👇»)
  rides only when a link exists. Receiving side: `s_<id>` → `/sessions/<id>`.

## Program → player messages (`sendMessage`)

- The working shape is **`POST https://eitaayar.ir/api/app/sendMessage`** with JSON
  `{ token, chat_id, text }` (`chat_id` = the player's `eitaaId`); the documented-looking
  `/api/{token}/sendMessage` shape answers **401**. One home: `src/lib/eitaa-notify.ts`
  (`server-only` — the token never reaches a bundle), called **only** from action shells
  (`membership.ts`, `cancel.ts`), never from `registration-core.ts` (the tsx harness imports it).
- It may fail and that is fine: delivery needs the player to have pressed «شروع» on the program,
  every send spends the program's **daily message credit**, and each refusal is swallowed and
  logged (`[notify] …`). Never let a notification block or roll back a write.
- Dev / harness: nothing is sent — the text is logged instead (`IS_PRODUCTION` gate), so an
  automated run can never message a real person. Events wired today: membership approval (with a
  link to the app), membership rejection, waitlist→hall promotion, late-cancel warning and
  penalty. Share links inside messages come from `src/lib/eitaa-link.ts`, the only link builder.

## WebView UX rules

- Safe area & height: keep `--app-vh` in sync from `viewportStableHeight`
  (`viewportChanged` event with `isStateStable=true`); fallback `100dvh`. Bottom tab bar
  and content padding must respect `max(env(safe-area-inset-bottom), var(--tg-safe-area-inset-bottom))`.
  Eitaa also exposes `--tg-safe-area-inset-*`, `--tg-content-safe-area-inset-*`,
  `--tg-viewport-stable-height`.
- Do **not** disable vertical swipes (docs recommend leaving them enabled).
- `enableClosingConfirmation()` only when there is meaningful unsaved state — otherwise skip.
- Desktop/web-Eitaa layout must work inside an iframe (container-relative breakpoints).
- No logout button — identity is the Eitaa account; `Eitaa.WebApp.close()` is the "exit".

## Testing & debugging

- Android: Eitaa settings → tap-and-hold the version row → `Enable WebView Debug` →
  `chrome://inspect#devices` (Chromium browsers only).
- Windows desktop: Eitaa settings → Advanced → experimental settings →
  `Enable webview inspecting` → right-click → Inspect.
- SDK check: `typeof window.Eitaa.WebApp !== "undefined"`.
- Local simulation (no Eitaa needed, **development only**):
  `npx.cmd tsx scripts/eitaa-sign-initdata.ts [--id 200000001] [--name "کاربر آزمایشی"] [--start s_<id>]`
  prints a signed `initData` (signed with `EITAA_BOT_TOKEN`; it loads `.env` through `@next/env` so
  an escaped `\$` is read exactly as the server reads it). The bridge also registers
  `window.__eitaaDebugLogin(initData)` when `EITAA_DEV_LOGIN` is on, and the gate overlay shows a dev
  panel with «ورود آزمایشی بازیکن» / «ورود آزمایشی مدیر» buttons — both go through a signed payload
  and the *real* verifier. Production exposes neither the hook, the buttons, nor the action
  (`EITAA_DEV_LOGIN` is false in production by construction, and the action re-checks it).
  The phone sheet has the sibling simulator: `devContact` signs a **real** contact payload with the
  same bot token, and the sheet's dev box (or `window.__eitaaDevContact("0912…")`) feeds it through
  the real `savePhoneFromEitaa` — signature, freshness, sender check and the DB write all run for
  real. Production exposes none of it (`devContact` re-checks `EITAA_DEV_LOGIN` before anything).
  In a dev browser each full page load shows the gate (correct behaviour) — log in with one click.
- **`window.__eitaaDebugLogin(initData)` is also the only *timer-free* way in.** Chrome freezes
  `setTimeout`/`setInterval`/rAF while `document.visibilityState === "hidden"` (background tab,
  minimized window), so the splash's 4.5s deadline and `waitForEitaaSdk` polling never complete and
  the screen sits on «در حال ورود…» forever. The bridge nudges itself on `visibilitychange`/`focus`/
  `pageshow`, but for automation prefer the hook: it runs the real action, reveals the app and
  refreshes, with no timer involved. In a hidden tab React handlers still work (clicks, server
  actions, toasts) — only time-based UI (toast auto-dismiss, the countdown tick) stays frozen, so
  never read a frozen clock as a product bug.
- Real test needs a public HTTPS deploy registered in EitaaYar (HTTPS, no redirect).

## Roadmap — messenger APIs (do not build yet — document in README)

- Send messages: `POST https://eitaayar.ir/api/app/sendMessage` with
  `{ token, chat_id=<user.id>, text }` — requires the user's write permission
  (`requestWriteAccess`) and daily message credits; Markdown supported. For session
  reminders / registration-open alerts.
- Publishing to «مرکز برنامکهای ایتا» (optional public listing).

## Don'ts

- Don't self-host or bundle `eitaa-web-app.js` — always the official URL.
- Don't load it with `next/script strategy="beforeInteractive"` — the tag lands in the RSC tree and
  React hydration fails (see § SDK loading). Let the bridge load it.
- Don't treat `window.Eitaa` as proof of being inside Eitaa — only a non-empty `initData` is.
- Don't redirect the registered destination URL (HTTPS, direct 200) and don't send
  `X-Frame-Options` / `frame-ancestors`.
- Don't add SMS, OTP, a login path, or a second way in — ever. Identity is `eitaaId` only. The one number we hold is `User.phone` (contact number for the manager, first-run only): collected through `WebApp.requestContact` with typing as the fallback, and **never** treated as identity or login.
- Don't put `EITAA_BOT_TOKEN` anywhere near the client.
- Don't adopt Eitaa's dark theme or rebuild its native chrome — keep the Sansyar light design.
- Don't invent a share-link format outside `src/lib/eitaa-link.ts`.
