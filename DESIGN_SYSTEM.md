# DESIGN_SYSTEM.md — سانس‌یار (Sansyar)

> The single source of truth for every page, section, component and future UI change.
> All values below are the **real values shipped in the code** (`src/app/globals.css`).
> Framework: Next.js 16 (App Router) · Tailwind CSS v4 · shadcn/ui (Radix) · Estedad Variable.

---

## 1. Project overview

- **Product name:** سانس‌یار (Sansyar) — «سانس» is the Persian term for a booked court slot.
- **Type:** product/app UI with an embedded admin dashboard.
- **Surface profile:** **App / Product UI** (primary) + **Mobile/Native** (WebView idioms) + **Dashboard/Admin** (the `/admin` surface). Hybrid — route all three.
- **Platform:** web app that runs **only inside the Eitaa messenger as a mini app (برنامک)** — Android, Windows-desktop Eitaa, and Eitaa web (iframe). Plain browsers get the gate overlay.
- **Target users:** (a) futsal players who open a shared link in Eitaa and register for a session; (b) one hall manager who publishes sessions and polices attendance.
- **Main design goal:** make "which session is open, how full is it, can I register" readable in one thumb-scroll — and make the manager's penalty/attendance bookkeeping feel fair and legible, not punitive.

## 2. Brand direction

- **Visual style:** quiet paper-white surfaces, hairline structure, one loud accent; sporty but *administrative* — a hall's roster board, not a sports-brand poster.
- **Mood & tone:** decisive, plain-spoken, slightly dry-funny. «خودی ولی تمیز».
- **Design personality:** warm-human × minimal-swiss (a clean Persian sans, generous spacing, numbers treated as data).
- **Design concept (Step 2.7):** **«تابلوی سانس» — a futsal hall's fixture board, translated to a phone.**
  Layout: sessions read like fixture lines separated by *court-line* hairlines rather than stacked cards; Type: Estedad with proportional numerals so clocks and prices read tight as a fixture line; Color: warm paper white + ink, with saturated yellow used **only** where "act now" is true (the referee's card), green only for success/space; Motion: exactly one orchestrated moment — the **«نیمکت» (bench) capacity rail** filling seat-by-seat, plus a scoreboard countdown that ticks.
- **Memorable move (the one bold thing):** the capacity meter is not a progress bar — it is a **segmented bench**: `۱۲` small seats that fill left-to-right as people register, with waitlisted names shown *behind the line*. Everything else stays quiet.
- **Adversarial-review verdict:** *Concept test* — cover the wordmark and this could still not be any sports-booking app: the bench rail, the scoreboard countdown and the hairline roster are specific to «تابلوی سانس». The reflex version (dark UI + neon green + gradient hero card) was explicitly rejected. *Weakness found & fixed:* the first palette pass used yellow as a graphical indicator directly on white (1.85:1 — invisible to low-vision users); fixed by splitting brand tokens into `--brand` (fill, always with dark text on top) and `--brand-mark` (#B57F00, ≥3:1 as a bare mark on both surfaces). *Phase ۸ pass:* the concept held under a second adversarial read — the toast layer, sheets and empty/error states are all token-themed (nothing ships in a registry default look), the AdminNav rail hides its native scrollbar, and the gate's two stories (خارج از ایتا / ورودت تأیید نشد) read as one system.
- **Reference style used** (pulled in Step 2.6):
  | Reference | Move adapted |
  | --- | --- |
  | `docs.telegram-mini-apps.com/platform/viewport` (Telegram mini apps) | viewport stability (`viewportStableHeight`, `isStateStable`) drives `--app-vh`; never resize during an unstable viewport |
  | `core.telegram.org/bots/webapps` (WebApp API) | `safeAreaInset` + `contentSafeAreaInset` semantics; 44/48 px touch targets; header/bottom-bar chrome colors |
  | `telegram-webapps-skill` → `ux-patterns.md` (MIT, bundled in `.opencode/skills`) | native-feel CSS baseline: `-webkit-tap-highlight-color: transparent`, `overscroll-behavior: none`, no text selection on chrome, **keyboard-avoidance** for focused fields |
  | MoMo *Mini App Design Checklist* | ≤3 bottom tabs by default, minimize typed input, one wording per action, no gratuitous pop-ups |
  | SportyHQ / On Spot (sports-booking apps) | list→detail booking with a visible capacity signal; cancelled/empty/full states designed before the happy path |
- **Voice & UX copy:** verb-first, one label per intent, shared words across the whole flow («ثبت‌نام در سانس» → toast «ثبت‌نامت قطعی شد»). Empty states invite the next action. Errors state what happened **and** the fix, never apologise. Status vocabulary is fixed: «در حال ثبت‌نام»، «ثبت‌نام بسته شده»، «ظرفیت پر — لیست انتظار»، «ثبت‌نامت قطعی شد»، «در لیست انتظار»، «از لیست انتظار دراومدی»، «درخواستت ثبت شد»، «درخواستت تأیید نشد»، «هنوز تأیید نشدی»، «حاضر»، «تاخیر ۱۵ دقیقه»، «غایب»، «محروم تا ۳ آبان»، «موجودی من»، «کامل از موجودی»، «از موجودیات کم شد»، «به موجودیات برگشت». No filler («لذت ببرید»، «بهترین»، «Elevate»).

## 3. Color system

Strategy: **Restrained** — tinted near-white canvas + ink, one saturated accent (yellow) reserved for action, green reserved for affirmative/space states. No purple, no decorative gradient, no dark mode (deliberate: the mini app keeps a fixed light brand chrome).

| Role | Color | Hex | Usage |
|---|---|---|---|
| 60% — Dominant | «سفید سالن» | `#F7F8F5` | page background |
| 60% — Dominant (raised) | white | `#FFFFFF` | cards, sheets, tab bar, header |
| 60% — Dominant (sunken) | «سایهٔ سالن» | `#EDEFE9` | rails, meter tracks, inert blocks |
| 30% — Secondary | «خط زمین» | `#DDE2D7` | hairline roster rules (**decorative only**) |
| 30% — Secondary (control) | «خط دور» | `#75817A` | input/control outlines, divider that must be perceivable |
| 10% — Accent | «زرد برند» | `#F5B301` | primary button fill, active tab, "open now" |
| accent (hover/pressed) | | `#E0A100` | primary hover |
| accent (as text/ring) | | `#8A6100` | amber text, focus ring |
| accent (as bare mark) | | `#B57F00` | bars, dots, icons drawn directly on white |
| accent (tint) | | `#FFF3D1` | info banners, selected rows |
| success | «سبز سالن» | `#157F4A` | confirmed, free capacity, paid |
| success (text on tint) | | `#0F6339` | success text |
| success (tint) | | `#E4F4EA` | success badge background |
| danger | | `#B3261E` | cancel, absent, banned |
| danger (tint) | | `#FCEBE9` | danger badge background |
| text | «مرکب» | `#16201B` | body + headings |
| text muted | | `#56635C` | secondary copy, labels |

**Usage rules**
- Backgrounds: page `#F7F8F5`; anything elevated goes **lighter** (`#FFFFFF`) — elevation is read by background contrast + a soft shadow, never by drawing a border around a card.
- Text: `#16201B` for anything read as content; `#56635C` for supporting copy (5.9:1 — still AA). Never light-gray on white.
- Buttons: primary = `#F5B301` fill with **ink `#16201B` text** (9.0:1) — white on yellow is banned. Secondary = transparent with a `#75817A` outline. Destructive = `#B3261E` fill with white text.
- Cards: `#FFFFFF`, radius 14px, shadow `--shadow-card`.
- Highlights / focus: `:focus-visible` ring = 2px `#8A6100` + 2px offset. Selected rows use `#FFF3D1`, not a border.
- Separation: **hairlines are structure, not elevation.** `#DDE2D7` (1.3:1) is used for roster rules and table rows — deliberately quiet so it never competes with content; it is never the only way to tell two things apart. Perceivable edges that *are* affordances (inputs, primary dividers) use `#75817A` (4.1:1).
- **Dark mode: not shipped.** The mini app keeps a fixed light brand chrome (`setHeaderColor(#FFFFFF)`), and `themeChanged` is ignored on purpose. Do not add a dark theme without updating this file.
- Contrast is **computed, not eyeballed**: `node scripts/check-contrast.mjs` — all 28 pairs pass (AA body ≥4.5, UI ≥3.0).

## 4. Typography system

- **Brand personality:** warm-human / sporty-plain (Persian-first).
- **Font family:** **Estedad Variable** (`@fontsource-variable/estedad`, `arabic` + `latin` subsets, self-hosted — never a CDN). One family for everything; hierarchy comes from weight and size. Mono is not used, and numbers keep the font's proportional figures (see the numerals rule below).
- **Why:** Estedad is a geometric-humanist Persian face with tall digits and closed counters — it holds up at 13px inside a WebView, reads as *sporty without shouting*, and its Latin subset matches the Persian so venue names, «تومان» and digits never look pasted in from another system.
- **Type scale** (tokens; every text uses one of these, no inline one-offs):

| Token | Size (mobile → desktop) | Weight | Line-height | Use |
|---|---|---|---|---|
| `--text-display` | `clamp(1.75rem, 1.35rem + 1.7vw, 2.25rem)` | 800 | 1.25 | gate overlay + first-run headline |
| `--text-h1` | `clamp(1.375rem, 1.2rem + 0.8vw, 1.625rem)` | 700 | 1.35 | screen titles |
| `--text-h2` | `1.25rem` | 700 | 1.4 | section titles |
| `--text-h3` | `1.0625rem` | 650 | 1.45 | card titles, venue names |
| `--text-body-lg` | `1.0625rem` | 400 | 1.6 | lead paragraphs |
| `--text-body` | `1rem` | 400 | 1.6 | body copy (never below 16px) |
| `--text-sm` | `0.875rem` | 400 | 1.55 | supporting rows, meta |
| `--text-caption` | `0.8125rem` | 500 | 1.5 | labels, tab labels |
| `--text-button` | `0.9375rem` | 650 | 1 | buttons |
| `--text-numeral` | `1.0625rem` | 700 | 1 | clock/price/capacity counters |

- **Numerals:** every quantity (capacity, price, clock, countdown, minutes, stats, contact number) renders through `toPersianDigits()` with the font's **proportional** figures. **Never** `font-variant-numeric: tabular-nums`: Estedad's tabular set pads every digit to the widest glyph — 12.94px against 5.73–12.52px at 17px/700 — which spaced numbers out by ±40% (clock «۲۱:۳۰» 56.17px → 40.53px, date «۱۴۰۵/۰۷/۲۵» 129.38px → 91.23px). CSS `letter-spacing` cannot compensate: engines refuse to track Arabic-script digit runs, so the figure set is the only lever. No numeral in the app is a column that needs alignment. Never mix Latin and Persian digits in one line.
- **Line-height:** 1.6 for body (Persian needs more than Latin), 1.35–1.45 for headings.
- **Line-length:** 60–75ch; the desktop column is capped at 720px so prose never runs long.
- **Button text:** `--text-button`, weight 650, one line, verb-first.
- **Tailwind ↔ `cn` coupling (easy to break):** every token above becomes a real `text-*` utility, and Tailwind's built-in merge tables cannot tell a custom size (`text-button`) from a colour (`text-white`) — the merger drops the colour and the text renders ink-on-red at 2.6:1. The scale is therefore registered as a `font-size` class group in `src/lib/utils.ts`. **Adding a `--text-*` token means adding its name to `TYPE_SCALE` there.** Components import `cn` from `@/lib/utils`, never from the `cn` package; after `npx shadcn add`, run `npm.cmd run fix:cn-imports`.
- **Responsive rules:** scaling lives in the tokens (fluid `clamp()`); headings step down on mobile via the same tokens; nothing is truncated — rows wrap instead.

## 5. Layout system

- **Container widths:** mini-app pages = full-bleed with `16px` gutters (`20px` ≥ 420px). Desktop/iframe reading column = `max-width: 720px`, centred — **the manager panel is a mini-app surface too**: no desktop sidebar, the same 720px column, plus the admin section strip below.
- **Section spacing:** `24px` between blocks on mobile, `32px` ≥ 768px; `12px` inside a list group; `8px` between a label and its field.
- **Grid rules:** single column on mobile. Lists are **rows in a group**, separated by a `1px #DDE2D7` hairline (roster lines) — not a stack of individual cards. Cards are used only where elevation is real (one session being featured, a KPI block, a sheet).
- **Paged lists:** any list that can grow pages **in the database** — 20 rows a page (`src/lib/pagination.ts`), rendered by the shared server-side `Pagination` bar («قبلی/بعدی» + «۱ تا ۲۰ از ۴۳ … · صفحهی ۱ از ۳»), page number in the URL next to the list's own filters. A single page shows no pager. The public «گذشته» window is two weeks; the full history lives in the manager's paginated archive.
- **Page anatomy:** sticky compact header (title inline-start, actions inline-end) → content → fixed bottom tab bar (safe-area aware). Detail screens replace the header title and expose the primary action pinned above the tab bar. Sheets slide from the bottom for contextual actions/filters. Inside `/admin` a second sticky strip (`AdminNav`) sits directly under the header — **every panel section one tap away** — and the tab bar stays visible, so the panel never needs the messenger's BackButton.
- **Conversion / CTA flow:** one primary goal per screen. Primary CTA = solid yellow with ink text, one per screen, repeated only as "the same action" (e.g. «ثبت‌نام در سانس» on the card and on the detail screen). Secondary = outline. Destructive = red, spatially separated (last item in a sheet, never adjacent to the primary CTA).
- **Mobile-first behavior (the platform we actually ship):**
  - `--app-vh` is kept in sync with Eitaa's `viewportStableHeight`; fallback `100dvh`.
  - Bottom padding = `max(env(safe-area-inset-bottom), var(--tg-safe-area-inset-bottom))` + tab-bar height. Header padding respects `--tg-safe-area-inset-top`.
  - **Keyboard avoidance:** when a field is focused and the viewport shrinks, the focused field is scrolled above the keyboard and the bottom tab bar is hidden — the keyboard must never cover the field.
  - **List → detail** is the core pattern: tap a session row → detail screen; back restores scroll position and filters.
  - Sheets (not centred desktop modals) for contextual actions, filters and confirms; every sheet is swipe-dismissible **and** has a visible close control.
  - Touch targets ≥ 44×44 px; tap feedback within ~100 ms; light haptics on register/cancel success and error.
  - No gesture-only actions, no hover-only affordances.
- **Alignment:** text starts inline (right in RTL); numeric runs are end-aligned; icons align with the first text line, never optically centred against a two-line block.
- **Long unbreakable strings** (deep links, ids) never get `whitespace-nowrap`: they wrap with `break-all` inside a `min-w-0` track, so no dialog can push its grid past the 375px phone and scroll horizontally (the share-dialog bug, phase ۸ — see `src/components/admin/share-session.tsx`).
- **Breakpoints:** `375px` (baseline), `768px` (tablet/iframe), `1280px+` (Eitaa desktop, admin).
- **No hero composition:** this is an app surface, not a marketing page — there is no full-viewport hero anywhere except the gate overlay, which is a centred editorial block (logo → one sentence → one action → 3-step guide) that fits inside `100svh` at 700/800 px heights.

## 6. Component system

- **Component base:** **shadcn/ui** (Radix primitives) with **Tabler** icons — one base for the whole project, fully re-themed to the tokens above (no stock shadcn look, no second registry). Tailwind v4 `@theme` maps every token in `globals.css`.
- **Re-theming status:** the `radix-nova` preset is compact by default (`h-8` buttons, ring-bordered cards), so components are re-themed to the variants/sizes/spacing in this file. Done: `button` `badge` `card` `input` `alert` `alert-dialog` `dialog` `empty` `skeleton` `sonner` `spinner`. Every remaining component is re-themed in the phase that first uses it (phase map, `PROMPT.md` §۰.۵); the token layer already gives them the brand colours, radii, shadows, font and type scale, so nothing can drift far.
- **Chart / data-viz:** none in v1 (the admin uses numerals and the bench rail, not charts). If a chart is ever added, use Recharts and follow the dashboard gate (labels, no colour-only meaning).
- **Buttons:** `default` (yellow/ink — the primary), `outline` (lineStrong edge), `ghost` (transparent, for header icons), `destructive` (red/white), `success` (green/white, used for confirmations). Sizes: `sm` 36px, `default` 44px, `lg` 52px (pinned CTA), `icon` 44px square. States: default / hover (darker by one step) / `:focus-visible` ring / active (`scale(.98)` + shadow shift) / disabled (40% opacity + `cursor: not-allowed`).
- **Cards:** white, 14px radius, `--shadow-card`, `1px` inner hairline only when the card sits on white. Never nested.
- **Badges:** pill (`999px`), tinted background + darker text of the same hue, always icon or word **plus** colour (never colour alone): «در حال ثبت‌نام» (green soft), «به‌زودی» (brand soft), «ظرفیت پر» (sunken), «لغو شده» (red soft), «ثبت‌نامت قطعی شد» (green soft), «در لیست انتظار» (brand soft), «در انتظار تأیید» (brand soft — the manager's queue). A row's own-state line repeats the same fixed words with an icon — hourglass for waiting, check for confirmed, x for a cancel — so the state is never carried by the tint alone.
- **Navbar:** mobile = compact sticky header; desktop = same header inside the 720px column; admin = the same header + the sticky section strip (`AdminNav`: داشبورد · سانس‌ها · کاربران · مکان‌ها · تنظیمات) right under it, with the tab bar kept — the panel is never a dead end, and on narrow screens the strip scrolls its **active** pill to centre (`scrollIntoView`, inline centre) so the current section is always visible — with the native scrollbar hidden (`overflow-y-hidden` + `[scrollbar-width:none]` + a hidden `::-webkit-scrollbar`), so no stray bar ever sits under the pills.
- **Tab bar:** fixed bottom, 3 items for players (`سانس‌ها` · `ثبت‌نام‌های من` · `پروفایل`), 4 for the manager (adds `مدیریت`); icon **+** label (56px tall, safe-area aware, hairline on top); active = **amber** icon (`--brand-ink`, 5.5:1) + ink label + a 2px `--brand-mark` top marker; inactive = `--ink-muted`. The fill yellow is never used as a bare mark on white (1.85:1). Destructive items never live here.
- **Footer:** none — replaced by the profile screen («دربارهٔ سانس‌یار», «بستن برنامک»).
- **Forms:** label above field, required marker `*`, helper text below, inline validation on blur, errors under the field wired with `aria-describedby`. Date/time uses a custom **Jalali picker** (month grid via `jalaali-js`) — never a Gregorian input with Persian labels.
- **Inputs:** 44px min height, `#75817A` outline, 10px radius, focus ring token; digits are Persian.
- **Feature sections (app):** the session list (segmented filters + roster rows), the session detail (info block → bench rail → participant list → rules), the "my registrations" list, the profile/history block.
- **The signature component — `<CapacityBench>`:** a segmented rail of `capacity` seats (`h-3.5`, `rounded-[3px]`, `flex-1` so any capacity still fits a 375px phone). Confirmed = `--brand-mark` (`#B57F00`, ≥3:1) — **not** the fill yellow, which is 1.85:1 on white and fails WCAG 1.4.11 for graphical objects; free = a `--sunken` seat with a `--line` hairline; waitlist = a thin `--ink-muted` strip after the last seat. Always renders the paired text «۸ از ۱۲ نفر · ۲ نفر در لیست انتظار» and exposes `role="img"` carrying that same summary as its accessible name, so it is never colour-only. Reduced-motion = no fill animation. `size="sm"` is used inside list rows, `md` on the detail screen.
- **Empty states:** every list renders the shared `Empty` composition — `EmptyMedia variant="icon"`, `EmptyTitle`, `EmptyDescription`, plus `EmptyContent` when there is one action to take. A bare sentence in a box is not an empty state.
- **Error state (boundaries):** one block for every route group — `AppError` (`src/components/common/app-error.tsx`): a `--danger-soft` mark, `text-h1` «مشکلی پیش آمد», one sentence, primary «دوباره امتحان کن» (Next's `retry()`), and a link home. Never the framework's English page.

## 7. Card & section style

- **Chosen style:** flat paper surfaces, hairline-separated rows, soft shadow only for genuinely floating/raised things (sheets, popovers, the pinned CTA bar). No bento, no glass, no gradient.
- **Radius:** one scale, derived from `--radius: 10px` — `--radius-sm` 6px (inner chips) · `--radius-md` 8px (small controls) · `--radius-lg` 10px (inputs, buttons) · `--radius-xl` 14px (cards, sheets, popovers) · `--radius-2xl` 18px · `999px` (pills, avatars, badges). Nothing invents its own radius.
- **Shadow / elevation:** three levels only — `--shadow-card: 0 1px 2px rgb(22 32 27 / .06)`, `--shadow-pop: 0 8px 24px -8px rgb(22 32 27 / .18)`, `--shadow-bar: 0 -1px 0 #DDE2D7`. Shadows are hue-tinted (green-ink) rather than neutral black.
- **Gradients:** none. The only permitted "gradient" is the `mask-image` edge fade on a horizontally scrollable rail.
- **Glassmorphism:** none.
- **Rule:** one elevation hierarchy (page → raised surface → floating element); no nested elevated surfaces; a border never communicates elevation.

## 8. Icon system

- **Icon library:** **`@tabler/icons-react`** (never Lucide; `iconLibrary` in `components.json` stays in sync).
- **Size:** 20px default (inline with text), 24px for tab-bar items and empty-state marks, 16px inside badges. Stroke `1.75`.
- **Color:** inherits `currentColor`; muted icons use `#56635C`, active tab uses `#8A6100` (amber text token, not the fill yellow).
- **Usage rules:** icon + label everywhere a tab or a primary action; icon-only controls (header, sheet close, counters) always carry an `aria-label`; **emoji are never used as structural icons** — inside the *share message text* sent to Eitaa they are allowed, because there they are typography, not UI.
- **RTL note:** directional icons (back/chevron) are mirrored via logical classes; Tabler icons that encode direction are flipped with `rtl:rotate-180` where needed.

## 9. Image & asset rules

- **Logo:** **text wordmark** «سانس‌یار» set in Estedad 800 with the brand yellow dot/underline as its only mark — shipped as live text (no raster logo), in one component (`src/components/brand/Wordmark.tsx`) so it can be swapped in one place. Eitaa's own app icon/`عکس شروع` is uploaded to the EitaaYar panel, not shipped here.
- **User-provided images:** none in v1 (no upload anywhere).
- **AI-generated / stock images:** none. The app has no decorative imagery; every visual is data (digits, rails, badges). This is a deliberate choice, not an omission.
- **Avatars:** **no initials, no photos** — a roster row's disc carries the row's **order number** in Persian digits (`bg-brand-soft`, `text-brand-ink`), `aria-hidden` because the `<ol>` already announces the order; the disc is a seat marker, not an identity picture. The viewer's own row adds the outline «تو» badge. (The owner's rule replaced the earlier initials disc in the same round that added the numbered roster.)
- **Crop / radius / treatment:** n/a.

## 10. Animation & interaction system

- **Animation library:** **CSS only** (Tailwind transitions + a few keyframes). No GSAP, no Framer — the mini app must stay light in a WebView.
- **Hover states:** desktop only, one step darker/lighter; mobile never relies on hover.
- **The one orchestrated moment:** the **bench rail fill** on a successful registration (seats fill left-to-right, 240ms staggered 30ms, `transform`/`opacity` only), paired with a success haptic. Everything else is a plain 150ms state change.
- **Scoreboard countdown:** plain proportional digits that the `LiveCountdown` island refreshes every 30s and on `visibilitychange` (cards and detail share it). It never changes a digit's own advance, so a new minute re-flows nothing: no tabular tracking, no fixed-width numeral slot.
- **Button interaction:** hover = colour step; active = `scale(.98)` + reduced shadow; focus = ring; disabled = 40% + no pointer events.
- **Interaction states (every interactive element):** default / hover / **`:focus-visible`** / active-pressed / disabled — specified per component, never a stock library default.
- **Async feedback:** every server action shows a pending state the moment it starts (button label → «در حال ثبت‌نام…» + inline spinner, `aria-busy`), then a result: success toast (green tint, check icon) or an inline error under the field / an error toast (red tint, alert icon). Never a silent action.
- **Toast system:** `sonner`, bottom-anchored above the tab bar (so it never sits behind the keyboard), 4s default, 6s for errors, dismissible, icon **+** text always.
- **Form feedback:** validate on blur; errors under the field with `aria-describedby`; server errors mapped back to the offending field; the submit button stays enabled with a visible reason for failure rather than a mysteriously disabled button.
- **Data view states (every list/table/view):** **empty** (a written invitation to act, with the action), **loading** (skeleton rows matching the real row rhythm — never a spinner in the middle of a list), **error** (what failed + a retry control). Sheet/dialog states: idle → pending → success/error, with focus trapped and restored.
- **Reduced-motion:** `@media (prefers-reduced-motion: reduce)` collapses all transitions to 0.01ms, disables the bench stagger, and keeps countdown numbers updating without motion.
- **Performance (targets: LCP < 2.5s, CLS < 0.1, INP < 200ms — targeted via the nine levers):** animate only `transform`/`opacity`; RSC by default with client islands only where interaction demands it; self-hosted subset fonts with `display: swap`; no images to lazy-load; skeletons reserve the exact row height so the layout never shifts; the Eitaa SDK is the only third-party script and it is `beforeInteractive` by platform requirement.

## 11. Accessibility rules

- **Contrast:** computed with `scripts/check-contrast.mjs` — body/supporting text ≥ 4.5:1, UI/large ≥ 3:1, in the one shipped (light) theme. Re-run that script after any colour change; never assert "passes AA" by eye.
- **Focus:** visible `:focus-visible` ring (2px `#8A6100`) on every interactive element; plain elements get a 2px offset, shadcn components use a solid 2px ring. Never removed without a replacement; rings never appear on mouse click.
- **Keyboard:** everything operable; tab order matches visual order; a skip-to-content link at the top of the shell; dialogs/sheets trap focus and restore it on close; the Jalali picker is fully keyboard-navigable (grid with arrow keys).
- **Semantics & ARIA:** landmarks (`header`, `nav`, `main`), one `h1` per screen then sequential headings; tabs/combobox/menu/dialog follow WAI-ARIA APG; live regions for pending/success/error; the bench rail exposes `role="img"` with a text summary («۸ از ۱۲ نفر») so it is never colour-only.
- **System adaptation:** `prefers-reduced-motion`; `forced-colors` (tokens use `currentColor`/system colors where they must); 200% zoom and text scaling do not clip or truncate; **RTL via logical properties** (`ms-`/`me-`/`ps-`/`pe-`, `inset-inline`) — never `ml-`/`left-`.
- **Text readability:** body never below 16px; muted copy still AA; no text over imagery (there is no imagery).
- **Never colour alone:** every state pairs colour with an icon or a word (paid/unpaid, present/late/absent, banned).

## 12. Anti-AI-slop rules

The canonical countable gate lives in `.opencode/skills/ui-ux-kit/SKILL.md` → "Pre-flight check", plus the App/Product (B3), Mobile (B4) and Dashboard (B2) gates in `references/surface-rules.md`. Project-specific decisions to check future work against:

- **Approved palette (the only colours allowed):** `#F7F8F5`, `#FFFFFF`, `#EDEFE9`, `#DDE2D7`, `#75817A`, `#16201B`, `#56635C`, `#F5B301`, `#E0A100`, `#8A6100`, `#B57F00`, `#FFF3D1`, `#157F4A`, `#0F6339`, `#E4F4EA`, `#B3261E`, `#FCEBE9`.
- **Pure `#000` / `#fff` used?** `#FFFFFF` is used deliberately as the raised-surface white on a warm-white page (the elevation device) — documented, not reflexive. Pure `#000` is never used.
- **Concept-test verdict:** recorded in §2 — the fixture-board concept survives covering the wordmark (bench rail + scoreboard countdown + roster hairlines); the weak point (yellow as a bare graphical mark failing 3:1) was found and fixed with the `--brand-mark` token.
- **Project-specific exceptions to the gate:**
  1. **No hero section and no marketing anatomy** — this is an app surface; only the gate overlay is a centred editorial block.
  2. **Hairlines are used for row separation** even though the shared law prefers background contrast — they are a documented *structural* device (the "court line"), deliberately below 3:1, and are never the only cue. Perceivable edges that act as affordances still use `#75817A`.
  3. **No dark mode** — mandated: the mini app keeps fixed light brand chrome and ignores `themeChanged`.
  4. **Emoji are allowed inside the Eitaa share-message text** (typography there), never as UI icons.
  5. **4 bottom tabs for the manager** (3 for players) — one over the MoMo ≤3 default, because «مدیریت» is a first-class destination for the only admin.

## 13. Future page instructions

Every future page, section and component reuses the colours, type scale, spacing, radii, shadows, components, icons, motion tokens and copy voice defined above. Do not introduce a new visual style unless this file is explicitly updated first.

## 14. Update policy

If colours, typography, components, animation, cards, icons or imagery change, update this file in the same change so it never drifts from the live UI — and re-run `node scripts/check-contrast.mjs`, since a changed token that no longer passes AA is a bug, not a preference.
