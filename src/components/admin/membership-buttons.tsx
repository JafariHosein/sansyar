"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { IconCircleCheck, IconCircleX } from "@tabler/icons-react";

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
import { notifyError, notifySuccess } from "@/lib/toast";
import { approveMembership, rejectMembership } from "@/server/actions/membership";

/**
 * «تأیید» / «رد عضویت» — the manager's decision on one **account** (the
 * membership gate, the owner's newest round).
 *
 * Two shapes, one component:
 *
 *  - the pending list: approve (the primary) + reject behind a confirm dialog —
 *    the dialog states out loud that a rejection is **reversible**, because the
 *    owner's rule is that no door slams shut: the rejected list keeps the account
 *    and this component re-approves it with one tap;
 *  - the rejected list (`allowReject={false}`): approve only. That is the one
 *    button a rejected account needs.
 *
 * The decision is one server call either way (`approveMembership` /
 * `rejectMembership`), which re-checks `requireAdmin` — the proxy is never the
 * auth boundary — and revalidates this page, so a row that changed under the
 * manager's finger (another tab, a double tap) answers honestly instead of
 * silently lying about the list.
 */
export function MembershipButtons({
  userId,
  playerLabel,
  allowReject = true,
}: {
  userId: string;
  /** The name the confirm dialog and the aria labels read — the row's own heading. */
  playerLabel: string;
  /**
   * `false` in the «ردشده‌ها» list: an account that is already rejected is
   * re-approvable, never re-rejectable — the server refuses the second rejection
   * anyway, and the screen does not offer what would only fail.
   */
  allowReject?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDecide(
    decision: "APPROVED" | "REJECTED",
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    // Keep the dialog open while the request is in flight: closing it first would
    // hide the spinner and leave the manager with no feedback at all.
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      const result =
        decision === "APPROVED" ? await approveMembership(userId) : await rejectMembership(userId);

      if (result.ok) {
        haptic("success");
        setOpen(false);
        notifySuccess(
          decision === "APPROVED" ? "عضویت تأیید شد" : "عضویت رد شد",
          decision === "APPROVED"
            ? `${playerLabel} از الآن می‌تونه سانس بگیره — از تو ایتا هم خبردار شد.`
            : `${playerLabel} تو «ردشده‌ها» می‌مونه؛ هر وقت خواستی از همین‌جا تأییدش کن.`,
        );
        // The queue is server-rendered: re-read it instead of patching the DOM.
        router.refresh();
        return;
      }

      // A stale list (the other manager decided first, the account is gone): close
      // the dialog and re-read, so the screen shows the truth instead of a button
      // that can only keep failing.
      haptic("error");
      setOpen(false);
      notifyError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        disabled={pending}
        aria-busy={pending}
        aria-label={`تأیید عضویت ${playerLabel}`}
        onClick={(event) => handleDecide("APPROVED", event)}
      >
        {pending ? <Spinner aria-hidden="true" /> : <IconCircleCheck aria-hidden="true" />}
        {allowReject ? "تأیید" : "تأیید عضویت"}
      </Button>

      {allowReject ? (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" disabled={pending}>
              <IconCircleX aria-hidden="true" />
              رد
            </Button>
          </AlertDialogTrigger>

          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>عضویت {playerLabel} رد بشه؟</AlertDialogTitle>
              <AlertDialogDescription>
                این حساب تا وقتی ردشده بمونه نمی‌تونه از سانس‌یار استفاده کنه. رد شدن پایان کار
                نیست — از بخش «ردشده‌ها» هر وقت خواستی می‌تونی تأییدش کنی. از تو ایتا هم بهش خبر
                می‌دیم که تأیید نشده.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>بمانم</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                aria-busy={pending}
                disabled={pending}
                onClick={(event) => handleDecide("REJECTED", event)}
              >
                {pending ? (
                  <>
                    <Spinner aria-hidden="true" />
                    در حال رد کردن…
                  </>
                ) : (
                  "رد عضویت"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
