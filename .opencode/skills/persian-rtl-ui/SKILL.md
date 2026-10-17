---
name: Persian & RTL UI
description: How to build Persian (Farsi) right-to-left interfaces correctly — typography and fonts, نیم‌فاصله and character normalization, Persian digits, Jalali dates and Asia/Tehran timezone, RTL layout mirroring in Tailwind/shadcn, Iranian phone handling, copy tone, and a Persian QA checklist. Use whenever UI text is Persian, or when handling Iranian phone numbers, Jalali calendars, Persian digits, or RTL layouts.
---

# Persian & RTL UI

Every screen in this project is Persian (Farsi) and RTL-first. These rules separate a native-feeling Persian app from an obviously machine-generated one. Apply them silently — do not announce them in the UI.

## 1. Direction & layout

- `<html lang="fa" dir="rtl">` on every page. Never flip direction on inner sections unless quoting LTR content.
- Tailwind logical utilities only: `ms-*`/`me-*`, `ps-*`/`pe-*`, `text-start`/`text-end`, `start-*`/`end-*`, `rounded-s-*`/`rounded-e-*`. Treat `ml-*`, `mr-*`, `text-left`, `text-right` as lint errors.
- Do NOT add `flex-row-reverse` to "fix" RTL — normal row order is already correct. Flex/grid with `gap` and `justify-between` are direction-agnostic.
- Mirror directional icons (arrows, chevrons for بعدی/قبلی, back, send): `rtl:-scale-x-100` on the icon, or use the mirrored pair. Check each one visually.
- Wrap Radix floating UI (Select, Popover, DropdownMenu, Tooltip, Sheet) in `<DirectionProvider dir="rtl">` once at the app root so positioning and collision logic respect RTL.
- Mixed-direction inline content (phone numbers, Latin names, URLs, codes): wrap in `<span dir="ltr" className="inline-block">` so trailing punctuation doesn't jump around.
- RTL `overflow-x` containers visually start at the right: verify the first card is fully visible and no phantom scrollbar appears.

## 2. Typography

- UI font: **Estedad Variable** (self-hosted via `@fontsource-variable/estedad`; import the `arabic` + `latin` subsets). No font CDNs. Fallback stack: `"Estedad Variable", Vazirmatn, "Segoe UI", Tahoma, sans-serif`.
- Persian needs more vertical room: body line-height 1.7–1.8 (not 1.5); headings 1.3–1.4. Never apply `tracking-*` (letter-spacing) to Persian text — it breaks cursive joins.
- Body text ≥ 16px.
- Character rules (these leak in from machine translation constantly):
  - Persian «ی» and «ک» only — never Arabic «ي» and «ك». Normalize user input: ي→ی، ك→ک، ة→ه.
  - **نیم‌فاصله**: compound words take ZWNJ (U+200C), not a full space: `ثبت‌نام`, `سانس‌یار`, `کد پیگیری`, `به‌زودی`, `صفحه‌ی اصلی`, `سانس‌ها`. Write the ZWNJ character explicitly; a full space reads as a typo to native speakers.
  - Persian guillemets «...» instead of straight quotes.
  - No space before `،` and `:` — write `سانس، مکان:` not `سانس ، مکان :`.
- Keep Latin brand/code strings separated with proper spacing inside Persian sentences.

## 3. Digits & numbers

- Display digits: Persian (۰–۹). Format with `new Intl.NumberFormat('fa-IR')` — produces Persian digits and the `٬` thousands separator: `۲۵۰٬۰۰۰ تومان`.
- Input digits: users may type Persian or Latin digits. Normalize everything to Latin before state/DB: map `۰۱۲۳۴۵۶۷۸۹ → 0123456789`. Store/compute Latin, render Persian.
- Percent `۲۵٪`, decimal separator `٫` (`۴٫۵`).
- Currency: always «تومان» after the amount, e.g. «۱۸۰٬۰۰۰ تومان». Durations: «۳ روز محرومیت»، «۱۲ ساعت قبل».

## 4. Dates & time — Jalali

- All user-visible dates are Jalali (شمسی). Never show Gregorian dates in the UI (fine in logs/dev tools).
- Format with `Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', ... })` — modern Node/browsers default `fa-IR` to the Persian calendar with Persian digits. e.g. `{ day: 'numeric', month: 'long' }` → «۲۵ مهر»؛ with weekday → «جمعه ۲۵ مهر».
- Store timestamps in UTC (MySQL `DATETIME`); convert at render time with `timeZone: 'Asia/Tehran'`. Never store Jalali strings.
- Week starts **شنبه**. Months: فروردین، اردیبهشت، خرداد، تیر، مرداد، شهریور، مهر، آبان، آذر، دی، بهمن، اسفند.
- Native `<input type="date">` and shadcn Calendar are Gregorian: for admin forms build a small Jalali picker (month grid via `jalaali-js`) styled with project tokens — do not ship a Gregorian calendar with Persian labels.
- Relative time: «۲ ساعت دیگر»، «۳ روز پیش»، «امروز، ۲۱:۳۰». Countdowns: «تا شروع ثبت‌نام: ۱ روز و ۴ ساعت».
- Clock: 24-hour Persian digits `۲۱:۳۰`.

## 5. Forms & validation

- **Sansyar has no OTP and no number-based login** — identity is the Eitaa account. The only
  number is the player's contact number (`User.phone`, asked once on the first run, admin-visible);
  never add a verification-code field or a login by number. (The Iranian-mobile rule below is the
  one to reuse for that field: accept `09xxxxxxxxx`, `+989xxxxxxxxx`, `00989...`, spaces/dashes and
  Persian digits → normalize to `09xxxxxxxxx`; regex `^09\d{9}$`.)
- Codes/ids that read left-to-right: wrap in `<span dir="ltr" className="inline-block">` so
  trailing punctuation does not jump around inside the RTL layout.
- Error messages in Persian, specific and actionable: «نام را کامل وارد کنید»، «تاریخ پایان باید
  بعد از شروع باشد». Never a bare «invalid input».
- Labels above inputs; required marker `*` after the label; helper text under the field. All Persian.

## 6. Copy & microcopy tone

- Tone: friendly, sporty, concrete — «خودی ولی تمیز». Use «شما» or neutral verb forms; no bureaucratic jargon, no exclamation spam.
- Buttons say exactly what happens: «ثبت‌نام در سانس»، «لغو ثبت‌نام»، «ذخیره تغییرات»، «اشتراک‌گذاری سانس». Same action = same word across the whole flow.
- Empty states invite an action: «هنوز توی هیچ سانسی نیستید. سانس‌های باز را ببینید.»
- Errors: what happened + how to fix, in the product voice. No apologies, no vagueness.
- Status vocabulary: «در حال ثبت‌نام»، «ثبت‌نام بسته شده»، «ظرفیت پر — لیست انتظار»، «حاضر»، «تاخیر ۱۵ دقیقه»، «غایب»، «محروم تا ۳ آبان».
- Demo/seed names must be real Persian names (امیرحسین، سینا، محمدرضا، آرش، مهدی) — never «John Doe» or transliterated English.

## 7. QA checklist (run before calling Persian UI done)

- [ ] No physical direction utilities (`ml-`, `mr-`, `text-left`, `text-right`, `left-`, `right-`) in the code.
- [ ] No Arabic ي/ك characters anywhere in copy (grep for them).
- [ ] نیم‌فاصله present in compound words (`ثبت‌نام` not `ثبت نام`).
- [ ] Every date renders Jalali with Persian digits.
- [ ] Every amount renders Persian digits + «تومان».
- [ ] Phones stored Latin `09...`, rendered as one unbroken Persian run: `۰۹۱۲۳۴۵۶۷۸۹` (no grouping).
- [ ] Directional icons mirrored correctly (chevron/arrow/back).
- [ ] 375px viewport: no horizontal scroll, fixed bottom nav usable, nothing clipped.
- [ ] Long Persian titles truncate with ellipsis instead of breaking layout.
