"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import {
  IconBan,
  IconCircleCheck,
  IconClipboardCheck,
  IconPencil,
} from "@tabler/icons-react";

import { haptic } from "@/components/eitaa/haptics";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatCount, formatToman, toPersianDigits } from "@/lib/format";
import type { SessionStatus } from "@/lib/sessions";
import { notifyError, notifySuccess } from "@/lib/toast";
import { closeAttendance } from "@/server/actions/attendance";
import { cancelSession } from "@/server/actions/admin-session-manage";
import { setSessionStatus } from "@/server/actions/admin-sessions";

/**
 * The session-level controls of the manage screen (PROMPT.md §۶.۴): «انتشار» /
 * «برگردون به پیش‌نویس»، «بستن حضور و غیاب» and «لغو کل سانس».
 *
 * Three shapes in one file because they are three answers to the same question —
 * *what happens to everyone at once* — and they share one voice, one confirm pattern
 * and one rule: the action re-checks the role and the row's state inside its own
 * transaction, so this screen is never the guard.
 *
 * Two of them are deliberately careful about a draft:
 *
 *  - «برگردون به پیش‌نویس» is offered only while **nobody holds a seat**: hiding a
 *    session with people in it is not a status change, it is taking something away
 *    from them, so the screen states the alternative instead of doing it;
 *  - «لغو کل سانس» is available on a draft as well: a slot that will never happen
 *    must not have to be published first to be dropped.
 */

const AUTH_HINT = "سانس‌یار را ببند و از ایتا دوباره باز کن.";

/**
 * «انتشار» / «برگردون به پیش‌نویس» — the one status tap (the whole form lives in
 * the edit screen, `setSessionStatus` next door).
 *
 * No confirm dialog: §۶.۵ names the sensitive writes and a status flip is not one of
 * them — publishing is the point of the screen, and the only way back to a draft is
 * a hall with nobody in it.
 */
export function SessionStatusControls({
  sessionId,
  status,
  occupiedCount,
}: {
  sessionId: string;
  /** The **stored** status; a canceled session offers no switch at all. */
  status: SessionStatus;
  /** Seats people hold — the reason the draft-back door is closed. */
  occupiedCount: number;
}) {
  const router = useRouter();
  /** Which flip is in flight, so the button says what it is doing. */
  const [target, setTarget] = useState<"DRAFT" | "PUBLISHED" | null>(null);
  const [, startTransition] = useTransition();

  function change(next: "DRAFT" | "PUBLISHED") {
    if (target !== null) return;
    setTarget(next);

    startTransition(async () => {
      const result = await setSessionStatus(sessionId, next);
      setTarget(null);

      if (result.ok) {
        haptic("success");
        notifySuccess(
          next === "PUBLISHED" ? "سانس منتشر شد" : "سانس پیش‌نویس شد",
          next === "PUBLISHED"
            ? "از همین حالا بازیکن‌ها می‌تونن ثبت‌نام کنن."
            : "تا منتشرش نکنی روی تابلوی بازیکن‌ها نیست.",
        );
        router.refresh();
        return;
      }

      haptic("error");
      notifyError(result.error, result.code === "AUTH" ? AUTH_HINT : undefined);
      router.refresh();
    });
  }

  // A canceled session is a record: nothing about it is switched any more.
  if (status === "CANCELED") return null;

  if (status === "DRAFT") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={target !== null}
            aria-busy={target === "PUBLISHED"}
            onClick={() => change("PUBLISHED")}
          >
            {target === "PUBLISHED" ? (
              <>
                <Spinner aria-hidden="true" />
                در حال انتشار…
              </>
            ) : (
              <>
                <IconCircleCheck aria-hidden="true" />
                انتشار سانس
              </>
            )}
          </Button>
        </div>
        <p className="text-caption text-ink-muted">
          این سانس پیش‌نویسه؛ تا منتشرش نکنی هیچ بازیکنی نه می‌بینش، نه ثبت‌نام می‌کنه.
        </p>
      </div>
    );
  }

  // Published: the way back to a draft stays open only while the hall is empty.
  if (occupiedCount > 0) {
    return (
      <p className="text-caption text-ink-muted">
        سانس منتشرشده‌ست. برای برگشت به پیش‌نویس باید اول ثبت‌نام‌ها آزاد بشن —
        وگرنه صندلی‌ها زیر پای بچه‌ها خالی می‌شه.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={target !== null}
          aria-busy={target === "DRAFT"}
          onClick={() => change("DRAFT")}
        >
          {target === "DRAFT" ? (
            <>
              <Spinner aria-hidden="true" />
              در حال برگرداندن…
            </>
          ) : (
            <>
              <IconPencil aria-hidden="true" />
              برگردون به پیش‌نویس
            </>
          )}
        </Button>
      </div>
      <p className="text-caption text-ink-muted">
        هیچ‌کس تو این سانس نیست، پس برگردوندنش کسی رو از دست نمی‌ده.
      </p>
    </div>
  );
}

/** What the sweep's toast says — the count, the bans, and whether bans were on. */
function closeDescription(
  result: { closed: number; penalized: number },
  noShowEnabled: boolean,
): string {
  if (result.closed === 0) return "همه از قبل ثبت شده بودن؛ هیچ غایبی اضافه نشد.";

  const absent = `${formatCount(result.closed, "نفر")} غایب حساب شدن`;
  if (result.penalized > 0) {
    return `${absent} و ${formatCount(result.penalized, "محرومیت")} ثبت شد.`;
  }
  return noShowEnabled
    ? `${absent}.`
    : `${absent} — جریمه‌ی نیومدن خاموشه، پس محرومیتی ثبت نشد.`;
}

/**
 * «بستن حضور و غیاب» (§۵.۵ / §۶.۴) — the one tap that ends the night: every seat
 * the manager never marked becomes «غایب» and is charged once, when the rule is on.
 *
 * The dialog states both halves out loud (who it sweeps, what it costs them), and the
 * sweep is idempotent on the server, so a second tap can only ever answer
 * `closed: 0`. With nothing left to sweep the button stays visible and disabled with
 * its reason: a manager looking for it must not have to guess where it went.
 */
export function CloseAttendanceButton({
  sessionId,
  pendingCount,
  noShowEnabled,
  noShowPenaltyDays,
}: {
  sessionId: string;
  /** Seats nobody has marked yet — exactly the rows the sweep will touch. */
  pendingCount: number;
  /** Whether a no-show is charged at all for this session. */
  noShowEnabled: boolean;
  noShowPenaltyDays: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleClose(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      const result = await closeAttendance(sessionId);

      if (result.ok) {
        haptic("success");
        setOpen(false);
        notifySuccess("حضور و غیاب بسته شد", closeDescription(result, noShowEnabled));
        router.refresh();
        return;
      }

      haptic("error");
      setOpen(false);
      notifyError(result.error, result.code === "AUTH" ? AUTH_HINT : undefined);
      router.refresh();
    });
  }

  if (pendingCount === 0) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled>
            <IconClipboardCheck aria-hidden="true" />
            بستن حضور و غیاب
          </Button>
        </div>
        <p className="text-caption text-ink-muted">
          حضور همه ثبت شده — چیزی برای بستن نمونده.
        </p>
      </div>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" disabled={pending}>
          <IconClipboardCheck aria-hidden="true" />
          بستن حضور و غیاب
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>حضور و غیاب بسته بشه؟</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-1">
            <span>هر کسی که ثبت نکردی غایب حساب می‌شه و جریمه‌ش ثبت می‌شه.</span>
            <span>
              الآن {formatCount(pendingCount, "نفر")} تو این سانس ثبت نشدن.
            </span>
            <span className="text-ink">
              {noShowEnabled
                ? `هر کدوم که غایب بشه، ${toPersianDigits(
                    noShowPenaltyDays,
                  )} روز محرومیت می‌گیره — طبق قوانین همین سانس.`
                : "جریمه‌ی نیومدن تو قوانین این سانس خاموشه، پس محرومیتی ثبت نمی‌شه."}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>بمانم</AlertDialogCancel>
          <AlertDialogAction aria-busy={pending} disabled={pending} onClick={handleClose}>
            {pending ? (
              <>
                <Spinner aria-hidden="true" />
                در حال بستن…
              </>
            ) : (
              "بستن حضور و غیاب"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * «لغو کل سانس» (§۶.۴) — the manager releases everyone: «همه بدون جریمه لغو می‌شوند».
 *
 * One transaction cancels every live row with `cancelType = ADMIN` and writes **no**
 * `Penalty` — a canceled session is not the players' fault — and every one of them is
 * messaged afterwards. The money is not lost either: every row that carried money
 * sends it back to its player's balance in the same transaction (the owner's rule:
 * money that is given up lands on the balance, never in cash), and the dialog states
 * the total before the tap with the same helper the engine's refund runs.
 */
export function CancelSessionButton({
  sessionId,
  title,
  liveCount,
  refundTotal,
  refundCount,
}: {
  sessionId: string;
  /** The session's own name, so the title names the row it is about to release. */
  title: string;
  /** Seats held **plus** people in line — everyone this cancel lets go. */
  liveCount: number;
  /**
   * What the released seats send back to balances, added up seat by seat
   * (`cancelRefundToman` on each row) — never `count × price`.
   */
  refundTotal: number;
  /** How many of the released rows actually carry money back. */
  refundCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleCancel(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      const result = await cancelSession(sessionId);

      if (result.ok) {
        haptic("success");
        setOpen(false);
        notifySuccess(
          "سانس لغو شد",
          result.canceled === 0
            ? "ثبت‌نامی نداشت؛ فقط خودش کنار رفت."
            : `${formatCount(result.canceled, "نفر")} بدون جریمه آزاد شدن و پیام هم براشون رفت.`,
        );
        router.refresh();
        return;
      }

      haptic("error");
      setOpen(false);
      notifyError(result.error, result.code === "AUTH" ? AUTH_HINT : undefined);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" disabled={pending}>
          <IconBan aria-hidden="true" />
          لغو کل سانس
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>سانس {title} لغو بشه؟</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-1">
            <span>همه‌ی ثبت‌نام‌ها بدون جریمه لغو می‌شن.</span>
            {liveCount > 0 ? (
              <span>
                الآن {formatCount(liveCount, "نفر")} تو این سانس ثبت‌نام کردن — به همه‌شون پیام می‌ره.
              </span>
            ) : (
              <span>ثبت‌نامی برای لغو کردن نیست؛ فقط خود سانس کنار می‌ره.</span>
            )}
            {refundCount > 0 ? (
              <span className="text-ink">
                {formatToman(refundTotal)} به موجودی {formatCount(refundCount, "نفر")} برمی‌گرده
                (نقدی برنمی‌گرده).
              </span>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>بمانم</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            aria-busy={pending}
            disabled={pending}
            onClick={handleCancel}
          >
            {pending ? (
              <>
                <Spinner aria-hidden="true" />
                در حال لغو…
              </>
            ) : (
              "لغو کل سانس"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
