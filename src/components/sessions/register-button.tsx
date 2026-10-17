"use client";

import { useId, useTransition } from "react";

import { useRouter } from "next/navigation";

import { IconBallFootball, IconUserPlus } from "@tabler/icons-react";

import { haptic } from "@/components/eitaa/haptics";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { balanceRegisterNote } from "@/lib/balance";
import {
  NOTHING_OWED_YET,
  stageAllowsRegistration,
  waitlistPositionLabel,
  type PaymentMode,
  type SessionStage,
} from "@/lib/sessions";
import { notifyError, notifySuccess } from "@/lib/toast";
import { registerForSession } from "@/server/actions/registration";

/**
 * The one primary action of a session screen.
 *
 * Contract it keeps (`DESIGN_SYSTEM.md` §10 — async feedback):
 *  - the moment it starts, the label becomes «در حال ثبت‌نام…» with an inline
 *    spinner and `aria-busy` — never a silent action;
 *  - the result is a toast (success 4s / error 6s) **and** a refresh of the
 *    server-rendered screen, so counts, the roster and the viewer's own row agree
 *    with the database immediately — and when the account's balance paid part of
 *    the seat, that same toast says what came off it and what is left to hand over
 *    (`balanceRegisterNote`, the money sentence of `src/lib/balance.ts`);
 *  - there are exactly two landings for a successful tap — **`CONFIRMED`**, a seat
 *    in the hall (the membership gate already vetted the person, so there is no
 *    second approval), and **`WAITLIST`**, the line behind a full سانس. A
 *    confirmed seat on an `AT_REGISTRATION` session owes money, and the refresh
 *    lands back on this screen with the payment button on it;
 *  - a disabled button always says why: the reason is rendered under it and wired
 *    to the control with `aria-describedby`;
 *  - clicks are ignored while a request is in flight (double-submit guard).
 *
 * It never decides policy on its own: the server action re-checks the membership
 * gate, the session stage, the ban and capacity inside the transaction. `stage`
 * only shapes the copy and the visual weight.
 */
export function RegisterButton({
  sessionId,
  stage,
  paymentMode,
  disabledReason,
  label,
}: {
  sessionId: string;
  stage: SessionStage;
  /**
   * Only shapes the waitlist sentence: on an `AT_REGISTRATION` session the queue
   * is told that money is not owed yet. Payment itself is never decided here — a
   * waitlisted row owes nothing (`payForRegistration` refuses it).
   */
  paymentMode?: PaymentMode;
  /** Why registration is unavailable — shown under the button, never swallowed. */
  disabledReason?: string | null;
  /** Overrides the stage-derived label (the host screen owns its copy). */
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const reasonId = useId();

  // «ظرفیت پر» is not a failure: it is a different action with a quieter weight,
  // because capacity is gone and a seat is no longer what is being handed out.
  const joinWaitlist = stage === "full";
  const actionLabel = label ?? (joinWaitlist ? "ورود به لیست انتظار" : "ثبت‌نام در سانس");
  const pendingLabel = joinWaitlist ? "در حال افزودن به لیست انتظار…" : "در حال ثبت‌نام…";

  const reason = disabledReason?.trim() ?? "";
  const blocked = reason.length > 0 || !stageAllowsRegistration(stage);

  function handleClick() {
    if (pending) return;

    startTransition(async () => {
      const result = await registerForSession(sessionId);

      if (result.ok) {
        haptic("success");

        if (result.status === "CONFIRMED") {
          // The tap is a seat (§۵.۲, the owner's newest round): the membership
          // gate already vetted the person, so there is nothing to approve. The
          // refresh puts the payment line (on an online-payment session) and the
          // cancel control on screen.
          //
          // The money of the moment rides in the result, so the balance sentence
          // («۲۰٬۰۰۰ از موجودیت کم شد — حضوری بده ۲۵٬۰۰۰.») lands with the
          // confirmation instead of waiting for the screen behind the toast. The
          // words come from `src/lib/balance.ts`, the one home of money sentences,
          // and the line above stays word-for-word when the balance played no part.
          const balanceNote =
            paymentMode === undefined
              ? null
              : balanceRegisterNote({
                  status: result.status,
                  amountToman: result.amountToman,
                  fromBalance: result.fromBalance,
                  paymentStatus: result.paymentStatus,
                  paymentMode,
                });

          const copy =
            paymentMode === "AT_REGISTRATION"
              ? "تو لیست سانس هستی — پرداخت رو از همین صفحه انجام بده."
              : "تو لیست سانس هستی — هزینه رو حضوری به مدیر بده.";

          notifySuccess(
            "ثبت‌نامت قطعی شد",
            balanceNote === null ? copy : `${copy} ${balanceNote}`,
          );
          // Re-read the session on the server: the rail, the counts and the
          // viewer's own row are all server-rendered.
          router.refresh();
          return;
        }

        // §۵.۲: a full سانس is not a refusal — the tap lands in line. And because
        // the seat is not theirs yet, nothing is owed yet either: saying so here is
        // what keeps a waitlisted player from expecting a gateway and a refund.
        const position =
          result.waitlistPosition === null
            ? null
            : waitlistPositionLabel(result.waitlistPosition);

        notifySuccess(
          "ظرفیت پر بود — تو لیست انتظاری",
          [
            position,
            paymentMode === "AT_REGISTRATION" ? `${NOTHING_OWED_YET}.` : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined,
        );
        router.refresh();
        return;
      }

      haptic("error");
      notifyError(
        result.error,
        // A dead cookie is fixed by reopening the app inside Eitaa — say so, don't
        // just fail.
        result.code === "AUTH" ? "سانس‌یار را ببند و از ایتا دوباره باز کن." : undefined,
      );
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="lg"
        variant={joinWaitlist ? "secondary" : "default"}
        className="w-full"
        aria-busy={pending}
        aria-describedby={reason ? reasonId : undefined}
        disabled={pending || blocked}
        onClick={handleClick}
      >
        {pending ? (
          <>
            <Spinner aria-hidden="true" />
            {pendingLabel}
          </>
        ) : (
          <>
            {joinWaitlist ? <IconUserPlus aria-hidden="true" /> : <IconBallFootball aria-hidden="true" />}
            {actionLabel}
          </>
        )}
      </Button>

      {reason ? (
        <p id={reasonId} className="text-caption text-ink-muted">
          {reason}
        </p>
      ) : null}
    </div>
  );
}
