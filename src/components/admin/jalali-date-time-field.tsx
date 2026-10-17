"use client";

import { useState } from "react";

import { IconCalendarEvent, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toLatinDigits, toPersianDigits } from "@/lib/format";
import {
  formatJalaliWeekdayDate,
  formatTime,
  JALALI_MONTHS,
  JALALI_WEEKDAYS,
  jalaliDateTimeToUtc,
  jalaliMonthGrid,
  toJalaliDateTime,
} from "@/lib/jalali";
import { cn } from "@/lib/utils";

/**
 * The admin panel's **Jalali date-time field** (PROMPT.md §۶.۴: «پیکر شمسی
 * سفارشی»): a button that states the chosen moment as a person reads it
 * («شنبه ۲۵ مهر ۱۴۰۵ — ۲۱:۳۰») and a popover that picks it — a Saturday-first
 * month grid plus ساعت/دقیقه.
 *
 * The rules that shape it:
 *
 *  - **The value crossing the wire is a UTC `Date`** (`jalaliDateTimeToUtc` from
 *    `src/lib/jalali.ts`); every conversion happens here, so a form never has to
 *    know how a Jalali wall-clock maps to an instant.
 *  - **`new Date()` never runs during render.** The draft state (viewed month,
 *    picked day, time text) is seeded inside the open handler, so this client
 *    component renders identically on the server and on the client — Cache
 *    Components never sees a baked-in clock.
 *  - The grid is `jalaliMonthGrid` from `src/lib/jalali.ts` — the same helper the
 *    date check-script pins, so month boundaries cannot drift.
 */

/** `۱۴۰۵/۰۷/۲۵` style day numbers come out Persian; time input takes both. */
function parseTimePart(text: string, max: number): number | null {
  const digits = toLatinDigits(text.trim());
  if (!/^\d{1,2}$/.test(digits)) return null;
  const value = Number(digits);
  return value >= 0 && value <= max ? value : null;
}

export function JalaliDateTimeField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  clearable = false,
  hint,
}: {
  id?: string;
  /** The field's label — a noun phrase («شروع سانس»), like every admin label. */
  label: string;
  /** The chosen instant (UTC), or `null` when nothing is chosen yet. */
  value: Date | null;
  onChange: (value: Date | null) => void;
  disabled?: boolean;
  /** Offer «پاک کردن» — for an optional moment (a session's registration window). */
  clearable?: boolean;
  /** One quiet line under the control (a rule, a default, a warning). */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<{ jy: number; jm: number } | null>(null);
  const [day, setDay] = useState<{ jy: number; jm: number; jd: number } | null>(null);
  const [hourText, setHourText] = useState("۲۱");
  const [minuteText, setMinuteText] = useState("۰۰");

  // Seeding happens on open — never during render — so the server-rendered
  // markup and the first client render agree (see the file comment).
  function handleOpenChange(next: boolean) {
    if (next) {
      const base = toJalaliDateTime(value ?? new Date());
      setView({ jy: base.jy, jm: base.jm });
      setDay({ jy: base.jy, jm: base.jm, jd: base.jd });
      setHourText(toPersianDigits(String(base.hour).padStart(2, "0")));
      setMinuteText(toPersianDigits(String(base.minute).padStart(2, "0")));
    }
    setOpen(next);
  }

  const hour = parseTimePart(hourText, 23);
  const minute = parseTimePart(minuteText, 59);
  const timeValid = hour !== null && minute !== null;

  function confirm() {
    if (!day || !timeValid) return;
    onChange(jalaliDateTimeToUtc(day.jy, day.jm, day.jd, hour, minute));
    setOpen(false);
  }

  const weeks = view ? jalaliMonthGrid(view.jy, view.jm) : [];
  const today = open ? toJalaliDateTime(new Date()) : null;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={value === null || undefined}
            className="w-full justify-between font-normal"
          >
            {value ? (
              <span>
                {formatJalaliWeekdayDate(value)} — {formatTime(value)}
              </span>
            ) : (
              <span className="text-ink-muted">انتخاب تاریخ و ساعت</span>
            )}
            <IconCalendarEvent aria-hidden="true" className="text-ink-muted" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[19rem] gap-3 p-3">
          {/* Month header: «ماه قبل» on the right (RTL), «ماه بعد» on the left. */}
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="ماه قبل"
              onClick={() =>
                setView((current) =>
                  current === null
                    ? current
                    : current.jm === 1
                      ? { jy: current.jy - 1, jm: 12 }
                      : { jy: current.jy, jm: current.jm - 1 },
                )
              }
            >
              <IconChevronRight aria-hidden="true" />
            </Button>

            <span className="text-h3 text-ink">
              {view ? `${JALALI_MONTHS[view.jm - 1]} ${toPersianDigits(view.jy)}` : ""}
            </span>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="ماه بعد"
              onClick={() =>
                setView((current) =>
                  current === null
                    ? current
                    : current.jm === 12
                      ? { jy: current.jy + 1, jm: 1 }
                      : { jy: current.jy, jm: current.jm + 1 },
                )
              }
            >
              <IconChevronLeft aria-hidden="true" />
            </Button>
          </div>

          {/* Weekday header — the single letter is the visible form; the full
              name stays for screen readers. */}
          <div className="grid grid-cols-7 gap-1" aria-hidden="true">
            {JALALI_WEEKDAYS.map((weekday) => (
              <span key={weekday} className="py-1 text-center text-caption text-ink-muted">
                {weekday.slice(0, 1)}
              </span>
            ))}
          </div>

          <div role="grid" aria-label="روزهای ماه" className="grid grid-cols-7 gap-1">
            {weeks.flat().map((cell) => {
              const selected =
                day !== null && day.jy === cell.jy && day.jm === cell.jm && day.jd === cell.jd;
              const isToday =
                today !== null && today.jy === cell.jy && today.jm === cell.jm && today.jd === cell.jd;

              return (
                <button
                  key={`${cell.jy}-${cell.jm}-${cell.jd}`}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setDay({ jy: cell.jy, jm: cell.jm, jd: cell.jd })}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg text-sm transition-colors",
                    cell.inMonth ? "text-ink" : "text-ink-muted",
                    selected
                      ? "bg-brand text-ink"
                      : "hover:bg-sunken active:bg-sunken",
                    // «امروز» gets a perceivable edge, never colour alone.
                    isToday && !selected && "ring-1 ring-line-strong",
                  )}
                >
                  {toPersianDigits(cell.jd)}
                </button>
              );
            })}
          </div>

          <div className="flex items-end gap-2 border-t border-line pt-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={id ? `${id}-hour` : undefined} className="text-caption">
                ساعت
              </Label>
              <Input
                id={id ? `${id}-hour` : undefined}
                inputMode="numeric"
                dir="ltr"
                className="h-9 w-14 text-center text-sm"
                value={hourText}
                aria-invalid={hour === null || undefined}
                onChange={(event) => setHourText(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor={id ? `${id}-minute` : undefined} className="text-caption">
                دقیقه
              </Label>
              <Input
                id={id ? `${id}-minute` : undefined}
                inputMode="numeric"
                dir="ltr"
                className="h-9 w-14 text-center text-sm"
                value={minuteText}
                aria-invalid={minute === null || undefined}
                onChange={(event) => setMinuteText(event.target.value)}
              />
            </div>

            <div className="ms-auto flex items-center gap-2">
              {clearable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  پاک کردن
                </Button>
              ) : null}
              <Button type="button" size="sm" disabled={!timeValid} onClick={confirm}>
                تأیید
              </Button>
            </div>
          </div>

          {!timeValid ? (
            <p className="text-caption text-destructive">ساعت را از ۰ تا ۲۳ و دقیقه را از ۰ تا ۵۹ بزن.</p>
          ) : null}
        </PopoverContent>
      </Popover>

      {hint ? <p className="text-caption text-ink-muted">{hint}</p> : null}
    </div>
  );
}
