"use client";

import { useState, useTransition } from "react";

import { IconHourglassHigh, IconUserX } from "@tabler/icons-react";

import { CloseAppButton } from "@/components/eitaa/close-app-button";
import { haptic } from "@/components/eitaa/haptics";
import { useEitaaRuntime } from "@/components/eitaa/runtime-context";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { MembershipStatus } from "@/lib/sessions";
import { notifyError, notifyInfo, notifySuccess } from "@/lib/toast";
import { checkMembership } from "@/server/actions/membership";

import {
  PHONE_ANSWERED_KEY,
  REAL_NAME_ANSWERED_KEY,
  useAnsweredId,
} from "../profile/first-run-marker";
import { FirstRunSheet } from "../profile/first-run-sheet";

/**
 * The **membership gate** — the one screen an account sees until the manager
 * approves it (the owner's newest round: approval is about the person, not the
 * seat).
 *
 * It is an overlay, not a route (exactly like the «فقط داخل ایتا» gate and the
 * two first-run sheets): the app behind it is fully rendered and completely
 * hidden, HTTP stays 200, and no link can dodge it. The server is the real door —
 * `registerSeat` refuses an unapproved account with `NOT_APPROVED` — so this
 * screen only states the truth the engine already enforces.
 *
 * It comes **after** the two first-run sheets on purpose: the manager decides
 * about a person they can see (real name + contact number), so the number and the
 * name are asked first and this screen waits for both (`sessionStorage` markers
 * count, so it appears the instant the name is saved). An admin never sees it —
 * the manager approves people, they don't wait to be approved.
 *
 * «دوباره چک کن» asks the server for the viewer's *fresh* status — an approval
 * that lands while the app is open shows up without closing the messenger. When
 * it comes back `APPROVED` the overlay retires on the spot: the content behind
 * it is already rendered and waiting.
 *
 * Server-render safe: `ready && user` is false until the client is, so it renders
 * `null` on the server and on the first client pass — every `(app)` route stays a
 * prerenderable shell.
 */
export function MembershipGate() {
  const { ready, user } = useEitaaRuntime();
  const phoneAnsweredId = useAnsweredId(PHONE_ANSWERED_KEY);
  const nameAnsweredId = useAnsweredId(REAL_NAME_ANSWERED_KEY);
  /** The status the last «دوباره چک کن» fetched, or `null` before any tap. */
  const [checked, setChecked] = useState<MembershipStatus | null>(null);
  const [pending, startTransition] = useTransition();

  const status = checked ?? user?.membershipStatus ?? null;

  // Both first-run questions must be answered before this sheet appears: the
  // manager's queue lists the person, and the queue is only useful with a name
  // and a number on it. The markers count as answers (the layout's sheets write
  // them the moment the server confirms a save).
  const phoneAnswered =
    user !== null && (user.phone !== null || phoneAnsweredId === user.eitaaId);
  const nameAnswered =
    user !== null &&
    ((user.firstName !== null && user.lastName !== null) || nameAnsweredId === user.eitaaId);

  const blocked =
    ready &&
    user !== null &&
    user.role !== "ADMIN" &&
    (status === "PENDING" || status === "REJECTED") &&
    phoneAnswered &&
    nameAnswered;

  if (!blocked) return null;

  const rejected = status === "REJECTED";

  function handleCheck() {
    if (pending) return;

    startTransition(async () => {
      const result = await checkMembership();

      if (!result.ok) {
        haptic("error");
        notifyError(result.error, "سانس‌یار رو ببند و از ایتا دوباره باز کن.");
        return;
      }

      // Show what the server just said. `APPROVED` retires the overlay (the
      // `blocked` guard above goes false); the other two keep it up — with the
      // right face, in case a pending request just turned into a rejection.
      setChecked(result.status);

      if (result.status === "APPROVED") {
        haptic("success");
        notifySuccess("عضویتت تأیید شد", "از الآن می‌تونی تو سانس‌ها ثبت‌نام کنی.");
        return;
      }

      if (result.status === "REJECTED") {
        haptic("error");
        notifyError("درخواستت تأیید نشد", "اگه فکر می‌کنی اشتباهه با مدیر سالن هماهنگ کن.");
        return;
      }

      haptic("light");
      notifyInfo("هنوز تأیید نشدی", "تأیید که شد، از تو ایتا هم خبرت می‌کنیم.");
    });
  }

  return (
    <FirstRunSheet
      icon={
        rejected ? (
          <IconUserX aria-hidden="true" className="size-7" stroke={1.75} />
        ) : (
          <IconHourglassHigh aria-hidden="true" className="size-7" stroke={1.75} />
        )
      }
      title={rejected ? "درخواستت تأیید نشد" : "درخواستت ثبت شد"}
      description={
        rejected
          ? "مدیر سالن درخواستت رو تأیید نکرده. اگه فکر می‌کنی اشتباهه با مدیر هماهنگ کن — بعد از تأییدش همین‌جا باز می‌شه."
          : "درخواستت رفت برای تأیید مدیر سالن. تا تأییدت نکنه نمی‌تونی از سانس‌یار استفاده کنی — تأیید که شد، از پیام ایتا خبرت می‌کنیم."
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-caption text-ink-muted">
          {rejected
            ? "این صفحه باز می‌مونه تا مدیر تصمیمش رو عوض کنه — هر وقت خواستی دوباره چک کن."
            : "این صفحه باز می‌مونه — هر وقت خواستی دوباره چک کن."}
        </p>

        <Button size="lg" className="w-full" onClick={handleCheck} disabled={pending} aria-busy={pending}>
          {pending ? (
            <>
              <Spinner aria-hidden="true" />
              در حال بررسی…
            </>
          ) : (
            "دوباره چک کن"
          )}
        </Button>

        <CloseAppButton />
      </div>
    </FirstRunSheet>
  );
}
