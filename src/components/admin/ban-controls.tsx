"use client";

import { useId, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { IconBan, IconShieldOff } from "@tabler/icons-react";

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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toLatinDigits } from "@/lib/format";
import { formatJalaliDate } from "@/lib/jalali";
import { notifyError, notifySuccess } from "@/lib/toast";
import { banUser, waiveBan } from "@/server/actions/admin-users";

/**
 * The manager's **ban** controls on one account (PROMPT.md §۵.۶ / §۶.۴).
 *
 * Two shapes, one file — the same split `MembershipButtons` uses:
 *
 *  - `<BanControls>` — «محروم کردن»: a dialog that collects **days** and a
 *    **reason**, and says out loud what it will do before doing it (the ban blocks
 *    every سانس, and the player is told in Eitaa). The ban button is always
 *    available, even while a ban is active: extending one is a legitimate
 *    decision, and the engine takes the ban that ends last.
 *  - `<WaiveBanButton>` — «لغو محرومیت» on one penalty row: a confirm, nothing
 *    more. Only a live ban row renders it (`penaltyState === "ACTIVE"`).
 *
 * Both call a server action that re-checks `requireAdmin()` — the screen is never
 * the guard — and both re-read the page afterwards (`router.refresh()`), because
 * the ban card, the history and the state chips are all server-rendered.
 *
 * The days field accepts Persian digits (every number the app draws is Persian,
 * so a manager copies what they see) and normalizes them before the call; the
 * server validates the same 1..90 window again.
 */

/** The window `banUser` accepts — mirrored here only to catch it before the round trip. */
const MIN_BAN_DAYS = 1;
const MAX_BAN_DAYS = 90;
const MIN_REASON_LENGTH = 3;

export function BanControls({
  userId,
  playerLabel,
}: {
  userId: string;
  /** The name the dialog title and the toasts read — the page's own heading. */
  playerLabel: string;
}) {
  const router = useRouter();
  const daysId = useId();
  const reasonId = useId();

  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [daysError, setDaysError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setDays("");
    setReason("");
    setDaysError(null);
    setReasonError(null);
  }

  function handleBan(event: React.MouseEvent<HTMLButtonElement>) {
    // Keep the dialog open while the request is in flight: closing it first would
    // hide the spinner and leave the manager with no feedback at all.
    event.preventDefault();
    if (pending) return;

    const parsedDays = Number.parseInt(toLatinDigits(days).trim(), 10);
    const parsedReason = reason.trim();

    if (!Number.isFinite(parsedDays) || parsedDays < MIN_BAN_DAYS || parsedDays > MAX_BAN_DAYS) {
      setDaysError(`مدت رو بین ${MIN_BAN_DAYS} تا ${MAX_BAN_DAYS} روز بنویس.`);
      haptic("error");
      return;
    }
    if (parsedReason.length < MIN_REASON_LENGTH) {
      setReasonError("دلیل رو هم بنویس — همین جمله به خودش می‌رسه.");
      haptic("error");
      return;
    }

    setDaysError(null);
    setReasonError(null);

    startTransition(async () => {
      const result = await banUser(userId, { days: parsedDays, reason: parsedReason });

      if (result.ok) {
        haptic("success");
        setOpen(false);
        reset();
        notifySuccess(
          "محروم شد",
          `${playerLabel} تا ${formatJalaliDate(result.until)} نمی‌تونه ثبت‌نام کنه.`,
        );
        // The ban card, the penalty history and every chip are server-rendered:
        // re-read the page instead of patching the DOM.
        router.refresh();
        return;
      }

      // A stale row (the account is gone, the session expired): close the dialog
      // and re-read, so the screen shows the truth instead of a button that can
      // only keep failing.
      haptic("error");
      setOpen(false);
      notifyError(
        result.error,
        result.code === "AUTH" ? "سانس‌یار را ببند و از ایتا دوباره باز کن." : undefined,
      );
      router.refresh();
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" disabled={pending}>
          <IconBan aria-hidden="true" />
          محروم کردن
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>محروم کردن {playerLabel}</AlertDialogTitle>
          <AlertDialogDescription>
            تا پایان این مدت تو هیچ سانسی نمی‌تونه ثبت‌نام کنه. از تو ایتا هم خبردار می‌شه.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <FieldGroup className="gap-4">
          <Field data-invalid={daysError ? true : undefined}>
            <FieldLabel htmlFor={daysId}>مدت (روز)</FieldLabel>
            <Input
              id={daysId}
              name="days"
              inputMode="numeric"
              autoComplete="off"
              placeholder="۳"
              value={days}
              onChange={(event) => {
                setDays(event.target.value);
                if (daysError) setDaysError(null);
              }}
              aria-invalid={daysError ? true : undefined}
              disabled={pending}
            />
            {daysError ? (
              <FieldError>{daysError}</FieldError>
            ) : (
              <FieldDescription>
                بین {MIN_BAN_DAYS} تا {MAX_BAN_DAYS} روز.
              </FieldDescription>
            )}
          </Field>

          <Field data-invalid={reasonError ? true : undefined}>
            <FieldLabel htmlFor={reasonId}>دلیل</FieldLabel>
            <Textarea
              id={reasonId}
              name="reason"
              rows={3}
              maxLength={200}
              placeholder="مثلاً: سه بار نیومدن بدون انصراف"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (reasonError) setReasonError(null);
              }}
              aria-invalid={reasonError ? true : undefined}
              disabled={pending}
            />
            {reasonError ? (
              <FieldError>{reasonError}</FieldError>
            ) : (
              <FieldDescription>کاربر همین جمله رو تو پیام ایتا می‌خونه.</FieldDescription>
            )}
          </Field>
        </FieldGroup>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>بمانم</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            aria-busy={pending}
            disabled={pending}
            onClick={handleBan}
          >
            {pending ? (
              <>
                <Spinner aria-hidden="true" />
                در حال محروم کردن…
              </>
            ) : (
              "محروم کن"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * «لغو محرومیت» — one confirm on one live penalty row. The dialog states both
 * halves of the outcome: the player can register again, and the pardon is sent to
 * them as a message (nobody should find the door open with no idea why).
 */
export function WaiveBanButton({
  penaltyId,
  playerLabel,
}: {
  penaltyId: string;
  /** The name the confirm dialog reads. */
  playerLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleWaive(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      const result = await waiveBan(penaltyId);

      if (result.ok) {
        haptic("success");
        setOpen(false);
        notifySuccess(
          "محرومیت لغو شد",
          `${playerLabel} از الآن می‌تونه تو سانس‌ها ثبت‌نام کنه — پیام لغو هم براش رفت.`,
        );
        router.refresh();
        return;
      }

      haptic("error");
      setOpen(false);
      notifyError(
        result.error,
        result.code === "AUTH" ? "سانس‌یار را ببند و از ایتا دوباره باز کن." : undefined,
      );
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={pending}>
          <IconShieldOff aria-hidden="true" />
          لغو محرومیت
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>محرومیت {playerLabel} لغو بشه؟</AlertDialogTitle>
          <AlertDialogDescription>
            با این کار از الآن می‌تونه تو سانس‌ها ثبت‌نام کنه و پیام لغو هم براش می‌ره.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>بمانم</AlertDialogCancel>
          <AlertDialogAction aria-busy={pending} disabled={pending} onClick={handleWaive}>
            {pending ? (
              <>
                <Spinner aria-hidden="true" />
                در حال لغو…
              </>
            ) : (
              "لغو محرومیت"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
