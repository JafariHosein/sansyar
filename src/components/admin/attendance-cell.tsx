"use client";

import { useId, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { IconCheck, IconCircleX, IconClock } from "@tabler/icons-react";

import { haptic } from "@/components/eitaa/haptics";
import { AttendanceChip } from "@/components/sessions/attendance-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toLatinDigits, toPersianDigits } from "@/lib/format";
import type { AttendanceStatus } from "@/lib/sessions";
import { notifyError, notifySuccess } from "@/lib/toast";
import { markAttendance } from "@/server/actions/attendance";

/**
 * «حاضر» / «تاخیر (دقیقه)» / «غایب» — the manager's mark on one seat of the
 * session they are managing (PROMPT.md §۵.۵ و §۶.۴).
 *
 * The engine (`src/server/attendance-core.ts`) owns the rules: it locks the
 * registration row, refuses a waitlisted or unstarted seat, and charges the two
 * §۵.۶ events exactly once. This component only decides *what the manager taps*,
 * and it talks to the shell in `src/server/actions/attendance.ts` — never to the
 * engine, and never with a rule of its own.
 *
 * Four deliberate choices:
 *
 *  - **the chip lives here, not in the page.** A mark is one tap and the row must
 *    answer instantly, so the local `mark`/`minutes` state paints the new chip
 *    before `router.refresh()` lands. The page keys this component by the
 *    server's own values, so the moment the truth arrives the state resets;
 *  - **only «تاخیر» opens a field.** «حاضر» و «غایب» are one tap each — a lateness
 *    is the one mark that carries a number, so its field is inline, prefilled from
 *    the mark that is already on the row (or from the session's own threshold) and
 *    submitted with Enter as well as the button;
 *  - **no confirm dialog.** §۶.۵ lists the sensitive writes and an attendance mark
 *    is not one of them: the mark is one tap, it is correctable, and the manager is
 *    standing at the door;
 *  - **the toast claims only what the engine wrote.** A strike is announced only
 *    when the result really carries one — and a late inside the threshold says so
 *    instead of pretending the ladder moved (the engine counts strictly *more
 *    than* `lateThresholdMinutes`).
 */

/** The engine's window, mirrored here only to catch a typo before the round trip. */
const MIN_LATE_MINUTES = 1;
const MAX_LATE_MINUTES = 720;

/** The engine's own sentence, so a refused minute count reads the same either way. */
const LATE_MINUTES_INVALID = "دقیقه‌ی تاخیر باید بین ۱ تا ۷۲۰ باشه.";

const AUTH_HINT = "سانس‌یار را ببند و از ایتا دوباره باز کن.";

/** What this component sends `markAttendance` — the shape the engine documents. */
type MarkInput =
  | { status: "PRESENT" }
  | { status: "LATE"; lateMinutes: number }
  | { status: "ABSENT" };

/**
 * Persian ordinals up to twenty — the whole range `lateStrikeCount` can take
 * (`src/lib/admin-sessions.ts` bounds it at ۱..۲۰), so the ladder's count always
 * has a word: «دومین تاخیر تو بازه‌ی ۳۰ روز».
 */
const STRIKE_ORDINALS: readonly string[] = [
  "اولین",
  "دومین",
  "سومین",
  "چهارمین",
  "پنجمین",
  "ششمین",
  "هفتمین",
  "هشتمین",
  "نهمین",
  "دهمین",
  "یازدهمین",
  "دوازدهمین",
  "سیزدهمین",
  "چهاردهمین",
  "پانزدهمین",
  "شانزدهمین",
  "هفدهمین",
  "هجدهمین",
  "نوزدهمین",
  "بیستمین",
];

function strikeOrdinal(count: number): string {
  return STRIKE_ORDINALS[count - 1] ?? `شماره‌ی ${toPersianDigits(count)}`;
}

/** The toast's one line: «حاضر ثبت شد» و هم‌خانواده‌هایش. */
function titleFor(attendance: Exclude<AttendanceStatus, "PENDING">): string {
  switch (attendance) {
    case "PRESENT":
      return "حاضر ثبت شد";
    case "LATE":
      return "تاخیر ثبت شد";
    default:
      return "غایب ثبت شد";
  }
}

/**
 * What the toast says underneath — one rule: never announce more than the engine
 * wrote.
 *
 * A ban comes first (it is the news the manager must not miss), then the ladder's
 * own count; a lateness inside the session's threshold says out loud that it did
 * not move anything, because a manager who expected a strike must not be left
 * wondering.
 */
function descriptionFor(
  result: {
    attendance: Exclude<AttendanceStatus, "PENDING">;
    lateMinutes: number | null;
    lateStrikes: number | null;
    penalty: { type: "NO_SHOW" | "LATE_STRIKES"; days: number } | null;
  },
  lateThresholdMinutes: number,
  lateStrikeWindowDays: number,
): string | undefined {
  if (result.penalty) {
    const ban = `محرومیت ${toPersianDigits(result.penalty.days)} روز ثبت شد`;
    return result.penalty.type === "NO_SHOW"
      ? `${ban} — بدون انصراف نیومدن تو سابقه‌ش موند.`
      : `${ban} — تاخیرهاش به حد نصاب رسید.`;
  }

  // `lateStrikes` is a number only while the strike rule is on at all.
  if (result.attendance === "LATE" && result.lateStrikes !== null) {
    if ((result.lateMinutes ?? 0) > lateThresholdMinutes) {
      return `${strikeOrdinal(result.lateStrikes)} تاخیر تو بازه‌ی ${toPersianDigits(
        lateStrikeWindowDays,
      )} روز.`;
    }

    return `این تاخیر تو نردبان تکرار حساب نمی‌شه — فقط تاخیر بیشتر از ${toPersianDigits(
      lateThresholdMinutes,
    )} دقیقه شمرده می‌شه.`;
  }

  return undefined;
}

export function AttendanceCell({
  registrationId,
  attendance,
  lateMinutes,
  lateThresholdMinutes,
  lateStrikeWindowDays,
  playerLabel,
}: {
  registrationId: string;
  /** The mark on the row right now — the server's value, the state's starting point. */
  attendance: AttendanceStatus;
  lateMinutes: number | null;
  /** The rules in force for *this* session, resolved by the query. */
  lateThresholdMinutes: number;
  lateStrikeWindowDays: number;
  /** The name the aria labels read. */
  playerLabel: string;
}) {
  const router = useRouter();
  const minutesId = useId();
  const errorId = useId();

  const [mark, setMark] = useState<AttendanceStatus>(attendance);
  const [minutes, setMinutes] = useState<number | null>(lateMinutes);
  const [lateOpen, setLateOpen] = useState(false);
  // Latin digits in the field: `toPersianDigits` re-draws it on the row, and an
  // `<input type="number">`-free text field keeps the Persian keyboard out of it.
  const [minutesInput, setMinutesInput] = useState(String(lateMinutes ?? lateThresholdMinutes));
  const [minutesError, setMinutesError] = useState<string | null>(null);
  /** Which tap is in flight, so exactly one button shows «در حال ثبت…». */
  const [busy, setBusy] = useState<AttendanceStatus | null>(null);
  const [pending, startTransition] = useTransition();

  function send(input: MarkInput) {
    if (pending) return;
    setBusy(input.status);

    startTransition(async () => {
      const result = await markAttendance(registrationId, input);
      setBusy(null);

      if (result.ok) {
        haptic("success");
        setMark(result.attendance);
        setMinutes(result.lateMinutes);
        setLateOpen(false);
        setMinutesError(null);
        notifySuccess(
          titleFor(result.attendance),
          descriptionFor(result, lateThresholdMinutes, lateStrikeWindowDays),
        );
        // The rail, the counts and the roster chips are server-rendered: re-read
        // them instead of patching the DOM.
        router.refresh();
        return;
      }

      haptic("error");
      notifyError(result.error, result.code === "AUTH" ? AUTH_HINT : undefined);
      // A stale row (the session was canceled next door, the seat was removed):
      // re-read, so the screen stops offering what can only keep failing.
      router.refresh();
    });
  }

  function toggleLate() {
    if (pending) return;
    // Reopening keeps the number that is on the row: a correction starts from the
    // mark it corrects, and a fresh mark starts from the session's own threshold.
    setMinutesInput(String(minutes ?? lateThresholdMinutes));
    setMinutesError(null);
    setLateOpen((open) => !open);
  }

  function submitLate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const parsed = Number.parseInt(toLatinDigits(minutesInput).trim(), 10);
    if (!Number.isFinite(parsed) || parsed < MIN_LATE_MINUTES || parsed > MAX_LATE_MINUTES) {
      haptic("error");
      setMinutesError(LATE_MINUTES_INVALID);
      return;
    }

    setMinutesError(null);
    send({ status: "LATE", lateMinutes: parsed });
  }

  const lateBusy = pending && busy === "LATE";

  return (
    <div className="flex flex-col gap-3">
      {/* The state of the row, drawn from the same local state the buttons write —
          so a tap and its chip can never disagree. */}
      <AttendanceChip status={mark} lateMinutes={minutes} />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={mark === "PRESENT" ? "secondary" : "outline"}
          aria-pressed={mark === "PRESENT"}
          aria-label={`ثبت حاضر برای ${playerLabel}`}
          disabled={pending}
          aria-busy={pending && busy === "PRESENT"}
          onClick={() => send({ status: "PRESENT" })}
        >
          {pending && busy === "PRESENT" ? (
            <Spinner aria-hidden="true" />
          ) : (
            <IconCheck aria-hidden="true" />
          )}
          {pending && busy === "PRESENT" ? "در حال ثبت…" : "حاضر"}
        </Button>

        <Button
          type="button"
          variant={lateOpen || mark === "LATE" ? "secondary" : "outline"}
          aria-expanded={lateOpen}
          aria-label={`ثبت تاخیر برای ${playerLabel}`}
          disabled={pending}
          onClick={toggleLate}
        >
          {lateBusy ? <Spinner aria-hidden="true" /> : <IconClock aria-hidden="true" />}
          تاخیر
        </Button>

        <Button
          type="button"
          variant={mark === "ABSENT" ? "secondary" : "outline"}
          aria-pressed={mark === "ABSENT"}
          aria-label={`ثبت غایب برای ${playerLabel}`}
          disabled={pending}
          aria-busy={pending && busy === "ABSENT"}
          onClick={() => send({ status: "ABSENT" })}
        >
          {pending && busy === "ABSENT" ? (
            <Spinner aria-hidden="true" />
          ) : (
            <IconCircleX aria-hidden="true" />
          )}
          {pending && busy === "ABSENT" ? "در حال ثبت…" : "غایب"}
        </Button>
      </div>

      {lateOpen ? (
        <form onSubmit={submitLate} noValidate className="flex flex-col gap-2">
          <label htmlFor={minutesId} className="text-caption text-ink-muted">
            دقیقه‌ی تاخیر
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={minutesId}
              name="lateMinutes"
              inputMode="numeric"
              autoComplete="off"
              className="w-24"
              value={minutesInput}
              onChange={(event) => {
                setMinutesInput(event.target.value);
                if (minutesError) setMinutesError(null);
              }}
              aria-invalid={minutesError ? true : undefined}
              aria-describedby={minutesError ? errorId : undefined}
              disabled={pending}
            />
            <Button type="submit" disabled={pending} aria-busy={lateBusy}>
              {lateBusy ? (
                <>
                  <Spinner aria-hidden="true" />
                  در حال ثبت…
                </>
              ) : (
                "ثبت تاخیر"
              )}
            </Button>
          </div>
          {minutesError ? (
            <p id={errorId} className="text-caption text-destructive">
              {minutesError}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
