---
name: Next.js Fullstack Patterns
description: Project conventions for the Next.js App Router + Prisma + MySQL backend of Sansyar — server actions, zod validation, Eitaa-only initData auth with signed cookie sessions (no SMS/OTP — one contact number on the account), the "only inside Eitaa" gate, role-gated admin routes, transactional registration logic, share-link building, and Windows/npm notes. Use when writing server logic, database schema or queries, auth, data mutations, or anything that touches the database.
---

# Next.js Fullstack Patterns (Sansyar)

The UI is Persian/RTL, but **code, identifiers, and comments are English**. The domain spec lives in `PROMPT.md`; this skill is *how* the backend gets written.

**There is no phone/OTP path.** Identity comes exclusively from Eitaa `initData` (`User.eitaaId`),
and the admin is whoever's id is listed in `ADMIN_EITAA_ID`. Never add an `OtpCode` model, an
SMS provider, or a second login path — not even a stub. `User.phone` is the one number in the
product and it is **not** an auth factor: a contact number collected once on the first run — the
sheet's only action is Eitaa's `WebApp.requestContact`, whose signed payload `savePhoneFromEitaa`
verifies server-side exactly like `initData` (`src/lib/eitaa-contact.ts`) — normalized by
`src/lib/phone.ts`, **immutable after saving** (typed entry was removed — `savePhone` no longer
exists), selected **only** for an admin viewer, and never sent to a player's browser. The same
first-run flow then collects the **real-name pair** (`User.firstName`/`lastName`, `saveRealName`),
separate from the display name `User.name` (`updateDisplayName` edits only that one) and just as
immutable.

## Layout

```
src/app/layout.tsx          # root: <html lang="fa" dir="rtl">, Estedad, metadata, <EitaaRuntime>
src/app/(app)/...           # sessions list (/), my, profile — AppShell: sticky header + bottom tab bar
src/app/(app)/sessions/[id]/page.tsx # session detail: facts, register/waitlist, rules, roster (own not-found)
src/app/admin/...           # the manager panel: its OWN layout — AdminShell = header + sticky AdminNav
                            # section strip + the app tab bar (so no screen needs the BackButton),
                            # per-page server guard; dashboard / sessions / users / venues / settings
                            # dynamic segments (`/admin/sessions/[id]`, `…/edit`, `/admin/users/[id]`, …)
                            # export `instant = false` for the same reason as `/sessions/[id]`
src/app/not-found.tsx       # Persian 404 (bad URL; the session route has a nested one inside AppShell)
src/server/actions/*.ts     # "use server" modules per domain
src/server/sessions/queries.ts # read side: home board, session detail, my registrations (never counters)
src/server/penalties.ts     # getActiveBan — a warning has days = 0 and never bans
src/server/actions/session-link.ts # canOpenSession: deep-link target check for the client bridge
src/lib/db.ts               # Prisma singleton (a driver adapter is mandatory in Prisma 7)
src/lib/auth.ts             # session create/read/destroy + getCurrentUser/requireUser/requireAdmin
src/lib/eitaa-signature.ts  # pure initData verify/sign/parse — no `server-only`, shared with scripts
src/lib/eitaa.ts            # server-only facade: signature + link config
src/lib/eitaa-link.ts       # the ONLY place that builds Eitaa startapp share links
src/components/eitaa/eitaa-runtime.tsx # mini-app bridge (client; mounted in the root layout)
src/components/eitaa/sdk.ts            # injects the official SDK (never `next/script`) + typed surface
src/components/eitaa/outside-eitaa.tsx # branded "only inside Eitaa" gate — an OVERLAY, not a route
src/server/actions/eitaa-auth.ts       # eitaaLogin server action
src/lib/jalali.ts           # Jalali helpers (format, parse, month grid)
src/lib/format.ts           # formatToman, toPersianDigits, formatJalaliDate...
prisma/schema.prisma
prisma/seed.ts
```

## Prisma

- One client via the `globalThis` singleton pattern in `lib/db.ts` (avoids hot-reload connection leaks).
- All datetimes stored in UTC (MySQL `DATETIME(3)`); render with `timeZone: 'Asia/Tehran'`.
- `User`: `eitaaId String @unique` (Eitaa ids have up to 52 significant bits → always a String), `name` (display name), `role`, `membershipStatus` (`PENDING | APPROVED | REJECTED` — the membership gate), `firstName`/`lastName` (the real-name pair, immutable after the first-run sheet), `createdAt`, `phone String?` (contact number, `09XXXXXXXXX`; first-run sheet from Eitaa's `requestContact` only — **no typed path**, immutable after the first save, admin-visible only, never an identity).
- `Registration` has `@@unique([sessionId, userId])` — rely on the constraint and catch `P2002`.
- Indexes: `Session(startsAt, registrationOpensAt)`, `Registration(userId, createdAt)`, `Penalty(userId, endsAt)`.
- Migrations: `npx.cmd prisma migrate dev`. Seed must be idempotent (`upsert` everywhere); seed the admin with `eitaaId = ADMIN_EITAA_ID` (fallback demo id when unset).

## Auth (Eitaa mini app only)

- **Single path**: the client bridge (`EitaaRuntime`) posts `initData` to `eitaaLogin` (`src/server/actions/eitaa-auth.ts`); the server verifies it with `verifyInitData` (`src/lib/eitaa-signature.ts` — HMAC-SHA256, key `WebAppData`, and the second HMAC key is the RAW digest bytes; see the `eitaa-miniapp` skill), then upserts the user by `eitaaId` and sets the session cookie. Idempotent — safe to call on every app open (preload login is required by Eitaa's developer rules). A login **promotes, never demotes** the role (a DB `ADMIN` row survives) and never overwrites the display name (it becomes editable later).
- **Role**: `ADMIN` when the verified `eitaaId` is in `ADMIN_EITAA_ID` (comma-separated env) **or** the row already says `ADMIN`; the write path only ever upgrades to `ADMIN` (`src/server/eitaa-login.ts` `upsertUser`), so revoking is a deliberate DB write. Never promote from the client.
- **Session**: jose `SignJWT` payload `{ uid, role }` in an `httpOnly`, `SameSite=Lax` cookie (30 days; `Secure` in production). `getSession()` verifies and returns the payload. `requireAdmin()` = session + DB role check; `requireUser()` for user actions.
- **Gate**: nothing may redirect the root — the EitaaYar destination URL must return **200 with no 30x**. There is no `middleware.ts` in Next 16 (it is `proxy.ts`, and it is not an auth boundary here): the gate is the `OutsideEitaa` **overlay** that `EitaaRuntime` renders whenever the (verified) `initData` is empty, and every protected page/action re-checks auth server-side (`/admin` → `requireAdmin`, `/my` → `requireUser`). Never add `X-Frame-Options` or CSP `frame-ancestors` — Eitaa web embeds the app in an iframe.
- **Dev simulator**: `NODE_ENV=development` + `EITAA_DEV_LOGIN != "0"` only — the gate's «ورود آزمایشی بازیکن/مدیر» panel, the `window.__eitaaDebugLogin(initData)` hook, and the CLI `npx.cmd tsx scripts/eitaa-sign-initdata.ts [--id …] [--name …] [--start s_<sessionId>]` (it loads `.env` through `@next/env`, so an escaped `\$` reads exactly as the server reads it). The `devLogin`/`devSignOut` actions re-check the flag, so production exposes neither path.
- Never trust `initDataUnsafe`; only the verified server payload counts.

## Server actions

- One module per domain: `eitaa-auth.ts`, `registration.ts`, `membership.ts` (the manager's approval of an account), `cancel.ts`, `payment.ts`, `profile.ts`, `attendance.ts`, `admin-sessions.ts`, `admin-session-manage.ts`, `admin-users.ts`, `admin-venues.ts`, `admin-settings.ts`.
- Start every action with zod `safeParse`; never trust client ids — derive `userId` from `getSession()`.
- Return a typed result `{ ok: true, ... } | { ok: false, error: string, fieldErrors?: Record<string, string> }` and wire it into `useActionState`.
- Mutations end with targeted `revalidatePath` calls — no manual client refetches.
- Multi-step invariants run inside `prisma.$transaction`: registration (session lock → ban check → the account's membership read under a user-row lock → occupancy count over `CONFIRMED` → insert `CONFIRMED`/`WAITLIST`), the membership decision (`decideMembership` in `src/server/membership-core.ts` — user-row lock, approve from `PENDING`/`REJECTED`, reject from `PENDING` only), cancel (cancel + promote the earliest waiter **straight into `CONFIRMED`**), attendance marking (`src/server/attendance-core.ts` — registration-row lock, guards `NOT_CONFIRMED`/`NOT_STARTED`/`SESSION_CANCELED`/`SESSION_NOT_PUBLISHED`, one `NO_SHOW` per event, strike ladder counted as events; `closeAttendance` sweeps only `{CONFIRMED, PENDING}` idempotently). Eitaa messages go out from the action shells only (`membership.ts`, `cancel.ts`, `attendance.ts`, `admin-session-manage.ts`) — the `*-core.ts` modules must never import the `server-only` notifier.
- Lists that can grow **page in the database**: `src/lib/pagination.ts` (`PAGE_SIZE = 20`, `parsePage`/`pageRange`/`clampPage`) + the shared server-rendered `Pagination` bar; the public «گذشته» window is `HOME_LOOKBACK_DAYS = 14`.
- Result types live in `src/server/actions/results.ts` (one union per action, e.g. `RegisterOutcome`) so a `"use server"` module exports only functions and the client still gets a typed result.
- `registerSeat` (`src/server/registration-core.ts`) is the reference write — called by the thin `registerForSession` action (`src/server/actions/registration.ts`: zod the id, `getCurrentUser()`, `revalidatePath`s) and by `scripts/check-registration-race.ts` through the injected client: `$transaction`: **lock the session row** (`SELECT … FOR UPDATE`) → **lock the user row and read `membershipStatus`** (refuse `NOT_APPROVED` before anything is written) → re-read `status` and derive the stage → refuse `ALREADY` when a non-canceled row exists → `getActiveBan` → count **occupancy** (`CONFIRMED`) → create (a fresh row is `CONFIRMED` when there is room and `WAITLIST` otherwise), or **revive** the canceled row (one row per `(sessionId, userId)`; `createdAt` is reset so a re-registration joins the back of the queue, and `promotedAt`/payment stamps are cleared) → on success `revalidatePath("/")`, `("/my")` and (`/sessions/<id>`). P2002 → `ALREADY`. `cancelSeat` lives next to it with the same shape, and `decideMembership` (`membership-core.ts`) is the one-time account decision.
- Never let the UI be the rule: a disabled button is a hint, the action re-checks window, ban, duplicates and capacity server-side (the verifier proved this by calling the action with a raw cookie while the button was hidden).

## Rendering (Cache Components)

- Request-time reads (cookie, DB, `new Date()`) belong in an async child behind `<Suspense>` **after** `await connection()`; the fallback skeleton mirrors the real row rhythm so nothing shifts.
- A **dynamic** route whose shared chrome reads `usePathname()` cannot become an instant shell: the build fails with `CLIENT_HOOK_DYNAMIC`. `/sessions/[id]` therefore exports `instant = false` — Next's documented remedy; it disables that validation only, and the route still streams its Suspense'd data (`◐`). Static routes keep their shell, so don't "fix" the chrome by dropping the active tab everywhere.
- The Eitaa bridge reads the pathname in `PathnameWatcher` inside a `<Suspense>` (`eitaa-runtime.tsx`) so the root layout can never block a future dynamic route.
- Avoid races with conditional writes: `updateMany({ where: { id, status: 'WAITLIST' }, ... })` then check `count`. Count `CONFIRMED` rows inside the transaction for occupancy — that is the only status that holds a seat; do not keep counters on `Session`.
- Admin actions call `requireAdmin()` first; user actions `requireUser()`.
- Share links: everything (message text + `?startapp=s_<id>` link) is built in the admin action via `src/lib/eitaa-link.ts` — no ad-hoc URL building in components.

## Domain invariants (quick)

- Registration allowed only when: the account is `membershipStatus: APPROVED` (the membership gate — an unapproved request is refused with `NOT_APPROVED` and no row is written), session `PUBLISHED` and not canceled, `registrationOpensAt ≤ now ≤ registrationClosesAt`, user not banned (`Penalty.endsAt > now && waivedAt == null && days > 0` — checked **before** the membership gate), and no live row exists (`CONFIRMED`/`WAITLIST`; a fresh tap answers `ALREADY`, and a `CANCELED` row is revived instead of duplicated).
- Cancellation per policy creates warning/penalty rows (see `PROMPT.md` §5.4/5.6) inside a transaction; cancelling a `WAITLIST` row is always free (no `Penalty` row at all, and nobody is promoted — the hall was already full), and any freed seat promotes the earliest waiter **straight into `CONFIRMED`** (the hall, not a queue).
- Attendance: `PRESENT | LATE(+minutes) | ABSENT`; marking runs the late/no-show engine — never duplicate a penalty for the same triggering event.
- Admin manual ban = `Penalty` row with `type: MANUAL`.

## Formatting helpers

Single source in `lib/format.ts` / `lib/jalali.ts`: `formatToman`, `toPersianDigits`, `formatJalaliDate`, `formatJalaliDateTime`, `relativeTimeFa`. Components must not inline-format numbers or dates. (Phone helpers live in `lib/phone.ts` — `normalizePhone` + `formatPhoneForDisplay` — and that is the only place phone handling belongs.)

## Practical (Windows)

- PowerShell blocks the npm ps1 shims on this machine: use `npm.cmd` and `npx.cmd`.
- Quote paths — the workspace path contains a space.
- MySQL runs in Docker (`docker compose up -d`); if 3306 is busy, change `docker-compose.yml` and `DATABASE_URL` together.

## Verification habits

- After each domain change: `npm.cmd run build` (type-safe end to end).
- Exercise guards out of order: register twice; register while banned; cancel after deadline; open a session outside its window; call `eitaaLogin` with a tampered `initData` — each must return the right Persian error, not crash.
- Catch expected Prisma errors (`P2002`, `P2025`) — no unhandled errors in server logs.
