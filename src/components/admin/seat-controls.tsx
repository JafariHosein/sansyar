"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { IconArrowUp, IconUserMinus } from "@tabler/icons-react";

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
import { cancelRefundToman, promotedSeatNote, type SeatMoney } from "@/lib/balance";
import { formatToman } from "@/lib/format";
import { notifyError, notifySuccess } from "@/lib/toast";
import {
  promoteWaiter,
  removeRegistration,
} from "@/server/actions/admin-session-manage";

/**
 * The two per-seat decisions that are not a payment or an attendance mark
 * (PROMPT.md §۶.۴): «حذف ثبت‌نام» and «ارتقای دستی از لیست انتظار».
 *
 * Both are the manager's own call about a person, so both sit behind a confirm —
 * §۶.۵ names the removal explicitly — and both say **before** the tap what the
 * screens will say after it:
 *
 *  - a removal releases the seat, the first person in line moves up automatically
 *    and the money the seat carried goes **back to the player's balance** in the
 *    same transaction — never out as cash — so the dialog states the amount before
 *    the tap and the toast repeats what really moved, from the action's own
 *    `refundedToman`;
 *  - a promotion hands over a seat **without checking capacity**: the button exists
 *    for the cases the automatic promotion cannot cover, and the manager must know
 *    that an overfull hall is their own decision.
 *
 * Both call an action that re-checks `requireAdmin()` inside its transaction (the
 * screen is never the guard) and both re-read the page afterwards, because the rail,
 * the queue and the money tiles are all server-rendered.
 */

const AUTH_HINT = "سانس‌یار را ببند و از ایتا دوباره باز کن.";

/**
 * «حذف ثبت‌نام» — the row leaves the board, never the database: it is canceled with
 * `cancelType = ADMIN`, nobody is charged (this is not a late cancel), a seat in
 * the hall hands itself to the first waiter in the same transaction, and the seat's
 * money (`cancelRefundToman` — the same helper the engine's refund runs) lands on
 * the player's balance again.
 */
export function RemoveSeatButton({
  registrationId,
  playerLabel,
  seatKind,
  money,
}: {
  registrationId: string;
  /** The name the dialog title and the toasts read. */
  playerLabel: string;
  /**
   * Which row this is: removing a **seat** frees the hall and promotes a waiter,
   * removing a **waitlist** row frees nothing at all.
   */
  seatKind: "CONFIRMED" | "WAITLIST";
  /**
   * The seat's own money — what it cost, what the balance covered and where the
   * rest stands. What comes back is `cancelRefundToman(money)`, which is exactly
   * what the action's transaction will send back.
   */
  money: SeatMoney;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  /** What the dialog promises and the toast reports — one number, computed once. */
  const refundToman = cancelRefundToman(money);

  function handleRemove(event: React.MouseEvent<HTMLButtonElement>) {
    // Keep the dialog open while the request is in flight: closing it first would
    // hide the spinner and leave the manager with no feedback at all.
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      const result = await removeRegistration(registrationId);

      if (result.ok) {
        haptic("success");
        setOpen(false);
        // The money sentence is built from the action's own number — the refund
        // that really moved, never the one the dialog predicted.
        const refundNote =
          result.refundedToman > 0
            ? ` — ${formatToman(result.refundedToman)} به موجودی‌اش برگشت.`
            : "";

        notifySuccess(
          "ثبت‌نام حذف شد",
          (seatKind === "WAITLIST"
            ? `${playerLabel} از لیست انتظار بیرون رفت.`
            : result.promoted
              ? "صندلی آزاد شد و اولین نفر تو لیست انتظار جاش رو گرفت."
              : "صندلی آزاد شد.") + refundNote,
        );
        router.refresh();
        return;
      }

      // A stale row (somebody else removed it, the session was canceled): close the
      // dialog and re-read, so the screen shows the truth.
      haptic("error");
      setOpen(false);
      notifyError(result.error, result.code === "AUTH" ? AUTH_HINT : undefined);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`حذف ثبت‌نام ${playerLabel}`}
        >
          <IconUserMinus aria-hidden="true" />
          حذف ثبت‌نام
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ثبت‌نام {playerLabel} حذف بشه؟</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-1">
            {seatKind === "CONFIRMED" ? (
              <>
                <span>صندلی این نفر آزاد می‌شه.</span>
                <span>
                  اولین نفر تو لیست انتظار خودکار جاش رو می‌گیره و پیام هم براش می‌ره.
                </span>
              </>
            ) : (
              <span>از لیست انتظار بیرون می‌ره؛ صندلی کسی آزاد نمی‌شه.</span>
            )}
            <span>براش جریمه‌ای ثبت نمی‌شه — این انصراف دیرهنگام حساب نمی‌شه.</span>
            {refundToman > 0 ? (
              <span className="text-ink">
                {formatToman(refundToman)} به موجودی این بازیکن برمی‌گرده (نقدی برنمی‌گرده).
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
            onClick={handleRemove}
          >
            {pending ? (
              <>
                <Spinner aria-hidden="true" />
                در حال حذف…
              </>
            ) : (
              "حذف ثبت‌نام"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * «ارتقا» — the manager pulls one row out of the queue by hand.
 *
 * Capacity is deliberately not checked anywhere in this path (`promoteWaiter`): the
 * button exists for the cases the automatic promotion cannot cover, so the dialog
 * says out loud that the hall may end up overfull and that **nobody is messaged** —
 * a manual promotion has no sentence of its own, and the manager is the one telling
 * the person.
 */
export function PromoteWaiterButton({
  registrationId,
  playerLabel,
}: {
  registrationId: string;
  /** The name the dialog title and the toasts read. */
  playerLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handlePromote(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      const result = await promoteWaiter(registrationId);

      if (result.ok) {
        haptic("success");
        setOpen(false);
        notifySuccess(
          "از لیست انتظار بالا اومد",
          `${playerLabel} حالا صاحب صندلیه${promotedSeatNote({
            chargedToman: result.chargedToman,
            outstandingToman: result.outstandingToman,
          })}`,
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          aria-label={`ارتقای ${playerLabel} از لیست انتظار`}
        >
          <IconArrowUp aria-hidden="true" />
          ارتقا
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{playerLabel} صاحب صندلی بشه؟</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-1">
            <span>این نفر همین حالا صاحب صندلی می‌شه؛ اگه موجودی داشته باشه، اول از موجودیش کم می‌شه و بقیه‌ش رو باید بده.</span>
            <span>ظرفیت سانس چک نمی‌شه؛ اگه سالن پره، تصمیمش با خودته.</span>
            <span className="text-ink">پیامی بهش نمی‌ره — خودت تو ایتا خبرش کن.</span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>بمانم</AlertDialogCancel>
          <AlertDialogAction aria-busy={pending} disabled={pending} onClick={handlePromote}>
            {pending ? (
              <>
                <Spinner aria-hidden="true" />
                در حال ارتقا…
              </>
            ) : (
              "ارتقا"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
