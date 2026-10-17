"use client";

import { useId, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { IconUserCheck } from "@tabler/icons-react";

import { haptic } from "@/components/eitaa/haptics";
import { useEitaaRuntime } from "@/components/eitaa/runtime-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { notifyError, notifySuccess } from "@/lib/toast";
import { saveRealName } from "@/server/actions/profile";

import {
  PHONE_ANSWERED_KEY,
  REAL_NAME_ANSWERED_KEY,
  rememberAnsweredId,
  useAnsweredId,
} from "./first-run-marker";
import { FirstRunSheet } from "./first-run-sheet";

/**
 * The **second** first-run sheet: the player's real name, asked right after the
 * number.
 *
 * Why a second question instead of the Eitaa name: the Eitaa name is a nickname
 * people change freely, and the manager stands at the door checking a list
 * against faces. This pair is stored on its own two columns (`User.firstName` /
 * `User.lastName`), asked **once** and immutable afterwards — that is what the
 * sheet says out loud, because a field people expect to edit and cannot is worse
 * than one they were warned about. «تغییر نام» on the profile stays the
 * *display* name and nothing here.
 *
 * It waits for the phone sheet on purpose (the two arrive in one order): the
 * number is asked first, and this sheet appears the moment it is answered — even
 * before the login payload is refreshed, which is why the phone's `sessionStorage`
 * marker counts as an answer too (`first-run-marker.ts`).
 *
 * Server-render safe: `ready && user` is false until the client is, so it renders
 * `null` on the server and on the first client pass.
 */
export function RealNameGate() {
  const { ready, user } = useEitaaRuntime();
  const router = useRouter();
  const phoneAnsweredId = useAnsweredId(PHONE_ANSWERED_KEY);
  const answeredId = useAnsweredId(REAL_NAME_ANSWERED_KEY);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  /** Field errors and the pair's own refusal — one of them, never both. */
  const [error, setError] = useState<{ first?: string; last?: string; form?: string }>({});
  const [pending, startTransition] = useTransition();
  const firstId = useId();
  const lastId = useId();

  const phoneAnswered =
    user !== null && (user.phone !== null || phoneAnsweredId === user.eitaaId);

  /** Which account the sheet is up for, or `null` when it is not shown at all. */
  const eitaaId =
    ready &&
    user &&
    phoneAnswered &&
    (user.firstName === null || user.lastName === null) &&
    user.eitaaId !== answeredId
      ? user.eitaaId
      : null;

  if (eitaaId === null) return null;

  // The guard above types this as a plain `string`, which is what the transition
  // closure below reads (a captured `string | null` loses the narrowing there).
  const accountId = eitaaId;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setError({});
    startTransition(async () => {
      const result = await saveRealName(firstName, lastName);

      if (result.ok) {
        haptic("success");
        rememberAnsweredId(REAL_NAME_ANSWERED_KEY, accountId);
        notifySuccess("نامت ثبت شد", "مدیر با همین اسم می‌شناسدت.");
        router.refresh();
        return;
      }

      haptic("error");

      if (result.code === "INVALID") {
        // The action checks the first name first, so on a pair whose first half
        // is short the sentence is about that field — never a guess.
        setError(firstName.trim().length < 2 ? { first: result.error } : { last: result.error });
        return;
      }

      if (result.code === "LOCKED") {
        // The pair is already on the account (a legacy row with one half, or a
        // name the manager froze): the sheet could never succeed, so the marker
        // retires it and the toast carries the sentence — and the fix, which is
        // the manager's.
        rememberAnsweredId(REAL_NAME_ANSWERED_KEY, accountId);
        notifyError(result.error);
        router.refresh();
        return;
      }

      setError({ form: result.error });
      notifyError(result.error, "سانس‌یار رو ببند و از ایتا دوباره باز کن.");
    });
  }

  return (
    <FirstRunSheet
      icon={<IconUserCheck aria-hidden="true" className="size-7" stroke={1.75} />}
      title="اسمت رو کامل بنویس"
      description="این اسم رو مدیر برای شناختن تو لازم داره. بعداً قابل تغییر نیست — همون‌طور که تو شناسنامه‌ت هست بنویس."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={firstId}>نام</Label>
          <Input
            id={firstId}
            name="firstName"
            value={firstName}
            onChange={(event) => {
              setFirstName(event.target.value);
              if (error.first) setError({});
            }}
            autoComplete="given-name"
            enterKeyHint="next"
            maxLength={30}
            required
            aria-invalid={error.first ? true : undefined}
            aria-describedby={error.first ? `${firstId}-error` : undefined}
          />
          {error.first ? (
            <p id={`${firstId}-error`} className="text-caption text-destructive">
              {error.first}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={lastId}>نام خانوادگی</Label>
          <Input
            id={lastId}
            name="lastName"
            value={lastName}
            onChange={(event) => {
              setLastName(event.target.value);
              if (error.last) setError({});
            }}
            autoComplete="family-name"
            enterKeyHint="done"
            maxLength={40}
            required
            aria-invalid={error.last ? true : undefined}
            aria-describedby={error.last ? `${lastId}-error` : undefined}
          />
          {error.last ? (
            <p id={`${lastId}-error`} className="text-caption text-destructive">
              {error.last}
            </p>
          ) : null}
        </div>

        {error.form ? (
          <p role="alert" className="text-caption text-destructive">
            {error.form}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? (
            <>
              <Spinner aria-hidden="true" />
              در حال ذخیره…
            </>
          ) : (
            "ذخیره و ادامه"
          )}
        </Button>
      </form>
    </FirstRunSheet>
  );
}
