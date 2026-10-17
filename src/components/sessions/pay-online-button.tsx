"use client";

import { useTransition } from "react";

import { useRouter } from "next/navigation";

import { IconCreditCard } from "@tabler/icons-react";

import { haptic } from "@/components/eitaa/haptics";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { notifyError, notifySuccess } from "@/lib/toast";
import { payForRegistration } from "@/server/actions/payment";

/**
 * The confirm tap of the mock gateway (§۵.۳).
 *
 * The gateway is a screen, not an integration: no real PSP, no redirect out of
 * the mini app. Tapping it calls the server action, which flips the seat with a
 * compare-and-set — the state lives in the `WHERE`, so two taps can never both
 * "charge" — and the player is moved to the session screen, where the payment
 * line now reads «پرداخت شده». `router.replace` keeps the back button away from
 * a gateway that has already been paid.
 */
export function PayOnlineButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (pending) return;

    startTransition(async () => {
      const result = await payForRegistration(sessionId);

      if (result.ok) {
        haptic("success");
        notifySuccess("پرداختت ثبت شد", "جات قطعی شد — روز سانس ببینیمت.");
        router.replace(`/sessions/${sessionId}`);
        return;
      }

      haptic("error");
      notifyError(
        result.error,
        result.code === "AUTH" ? "سانس‌یار را ببند و از ایتا دوباره باز کن." : undefined,
      );
      // Any other code means the world moved on (already paid, seat released):
      // re-read the screen so it states the new truth instead of an old one.
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      size="lg"
      className="w-full"
      aria-busy={pending}
      disabled={pending}
      onClick={handleClick}
    >
      {pending ? (
        <>
          <Spinner aria-hidden="true" />
          در حال پرداخت…
        </>
      ) : (
        <>
          <IconCreditCard aria-hidden="true" />
          پرداخت موفق (تست)
        </>
      )}
    </Button>
  );
}
