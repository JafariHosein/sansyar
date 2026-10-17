"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconInfoCircle,
} from "@tabler/icons-react";

import { haptic } from "@/components/eitaa/haptics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { cancelRefundNote, cancelRefundToman, type SeatMoney } from "@/lib/balance";
import { formatToman } from "@/lib/format";
import type { CancelVerdict } from "@/lib/sessions";
import { notifyError, notifySuccess } from "@/lib/toast";
import { cancelRegistration } from "@/server/actions/cancel";

/**
 * «لغو ثبت‌نام» — one control shared by the session page and `/my` (PROMPT.md §۵.۴).
 *
 * The rule is never guessed here: the **server** resolves the verdict (settings
 * row + `lateCancelsInWindow`) and passes it in, so the dialog states exactly what
 * the engine will write — the free window, a first-time warning, or the days of
 * the ban. Confirm calls the action, and the action re-derives the same verdict
 * inside its transaction; if the clock moved between the two, the server wins and
 * the toast reports what actually happened.
 *
 * The **money** is the same kind of promise: the seat's own three facts come in,
 * `cancelRefundToman` (the engine's own formula) decides what is handed back and
 * `cancelRefundNote` — the one money sentence of `src/lib/balance.ts` — states it:
 * the money lands on the balance, never back in cash. The toast then reports the
 * refund the transaction actually paid.
 *
 * Confirming is the dialog's only action, so it carries the fill yellow — except
 * when the price is a ban, where the voice turns red: a destructive consequence
 * should never look like a positive one.
 */
export type CancelRegistrationProps = {
  sessionId: string;
  /** Resolved by the screen from `cancelVerdictNow` (see `src/lib/sessions.ts`). */
  verdict: CancelVerdict;
  /**
   * The seat's three money facts (`amountToman`, `paidFromBalance`,
   * `paymentStatus`). The cancel rules say nothing about refunds, and the money
   * rule is the owner's: what a seat carried goes onto the **balance**, never back
   * in cash — `cancelRefundToman` is what the transaction will pay and
   * `cancelRefundNote` is the sentence that promises it, so the dialog and the
   * engine cannot disagree. A seat that carried nothing renders nothing extra.
   */
  money: SeatMoney;
  /** Trigger label. `/my` rows keep the short default. */
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
};

export function CancelRegistration({
  sessionId,
  verdict,
  money,
  label = "لغو ثبت‌نام",
  variant = "secondary",
  size = "default",
  className,
}: CancelRegistrationProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const costsBan = verdict.kind === "LATE_PENALTY";
  // What this cancel hands back — the engine's own formula, so the sentence below
  // is the amount the transaction pays, never a second guess.
  const refundNote = cancelRefundNote(cancelRefundToman(money));

  function handleConfirm(event: React.MouseEvent<HTMLButtonElement>) {
    // Keep the dialog open while the request is in flight: closing it first would
    // hide the spinner and leave the player with no feedback at all.
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      const result = await cancelRegistration(sessionId);

      if (result.ok) {
        haptic("success");
        setOpen(false);
        notifySuccess(
          "ثبت‌نامت لغو شد",
          [
            // Any non-free cancel says what it cost: «اخطار اول — بدون محرومیت»
            // for the first late cancel, «۳ روز محرومیت» for the next one, and
            // «لغو دیرهنگام — بدون جریمه» when the rule is switched off.
            verdict.kind === "FREE" ? null : verdict.headline,
            // The freed seat goes to the first person in line, straight into the
            // hall — the membership gate already vetted them.
            result.promoted ? "جا آزاد شد؛ نفر اول لیست انتظار جات رو گرفت." : null,
            // The money came back — onto the balance, which is where the owner's
            // rule puts it (never cash), and the same amount the dialog promised.
            result.refundedToman > 0
              ? `${formatToman(result.refundedToman)} به موجودیت برگشت.`
              : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined,
        );
        // The seat count, the roster, the queue position and every chip on
        // `/my` are server-rendered — re-read them instead of patching the DOM.
        router.refresh();
        return;
      }

      haptic("error");
      notifyError(
        result.error,
        result.code === "AUTH" ? "سانس‌یار را ببند و از ایتا دوباره باز کن." : undefined,
      );
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={variant} size={size} className={className}>
          <IconCircleX aria-hidden="true" />
          {label}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {costsBan ? "لغو ثبت‌نام با محرومیت؟" : "لغو ثبت‌نام؟"}
          </AlertDialogTitle>

          {/* `asChild`: a description is a `<p>` and the alert brings its own
              heading — nesting block content inside a paragraph would be invalid. */}
          <AlertDialogDescription asChild>
            <div>
              <Alert variant={costsBan ? "destructive" : verdict.kind === "FREE" ? "success" : "default"}>
                {costsBan ? (
                  <IconAlertTriangle aria-hidden="true" />
                ) : verdict.kind === "FREE" ? (
                  <IconCircleCheck aria-hidden="true" />
                ) : (
                  <IconInfoCircle aria-hidden="true" />
                )}
                <AlertTitle>{verdict.headline}</AlertTitle>
                <AlertDescription>{verdict.detail}</AlertDescription>
              </Alert>

              {/* The money rule is the owner's, and `src/lib/balance.ts` owns the
                  words: what the seat carried goes back to the **balance** — not in
                  cash — and the next registration spends it automatically. Said only
                  when there is something to send back: a place in line, a waived
                  seat and an unpaid one carry no money, so nothing is promised. */}
              {refundNote ? <p className="mt-3 text-sm text-ink">{refundNote}</p> : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>بمانم</AlertDialogCancel>
          <AlertDialogAction
            variant={costsBan ? "destructive" : "default"}
            aria-busy={pending}
            disabled={pending}
            onClick={handleConfirm}
          >
            {pending ? (
              <>
                <Spinner aria-hidden="true" />
                در حال لغو…
              </>
            ) : (
              "لغو ثبت‌نام"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
