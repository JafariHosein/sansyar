"use client";

import { useId, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { IconPlusMinus } from "@tabler/icons-react";

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
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatToman, toLatinDigits } from "@/lib/format";
import { notifyError, notifySuccess } from "@/lib/toast";
import { adjustBalance } from "@/server/actions/admin-balance";

/**
 * «تغییر موجودی» — the manager's hand on one account's balance (the balance
 * round), next to the number it moves.
 *
 * The movement itself is `adjustBalance` → `adjustBalanceByAdmin`, which locks the
 * account, refuses to take more than the wallet holds (`INSUFFICIENT`) and writes
 * one ledger row naming this manager — this dialog only decides *what the manager
 * hands over*. Two consequences are stated before the tap because they cannot be
 * undone by tapping again: the movement is written into the ledger, and the
 * account is told in Eitaa.
 *
 * The amount is a **Toman** field and the sign lives in the «افزودن/کسر» choice,
 * not in the typed characters: the field takes Persian or Latin digits (every
 * number the app draws is Persian, so a manager copies what they see) and the
 * trimmed value is sent as one signed `delta` — the exact shape the action's own
 * schema re-validates. An amount the server refuses keeps the dialog open so the
 * number can be corrected; a stale page (no session, no such account) closes it
 * and re-reads, because there is nothing left to fix here.
 */

/** The server's typo protector, mirrored here only to catch it before the round trip. */
const MAX_ADJUST_TOMAN = 10_000_000;

/** The note cap the action's schema enforces — the field's own `maxLength`. */
const MAX_NOTE_LENGTH = 200;

/** The one sentence this dialog owns; every money sentence the server writes is its own. */
const AMOUNT_INVALID = `مبلغ باید یه عدد درست بین ۱ تا ${formatToman(
  MAX_ADJUST_TOMAN,
)} باشه.`;

const AUTH_HINT = "سانس‌یار را ببند و از ایتا دوباره باز کن.";

/** Which way the money moves — the sign of the `delta` the action receives. */
type AdjustMode = "add" | "deduct";

/**
 * The typed amount → a whole positive number, or `null`.
 *
 * Persian digits, Latin digits, and the thousands separator a manager may paste
 * from a message are all accepted (`۰`, `0`, `,`, `٬`); anything else — letters, a
 * decimal point, a sign, an empty field — is a typo and never reaches the wire.
 */
function parseAmount(raw: string): number | null {
  const latin = toLatinDigits(raw).replace(/[,\u066C\u066B\s\u00A0]/g, "");
  if (!/^\d+$/.test(latin)) return null;

  const value = Number.parseInt(latin, 10);
  if (!Number.isFinite(value) || value < 1 || value > MAX_ADJUST_TOMAN) return null;
  return value;
}

export function BalanceAdjust({
  userId,
  playerLabel,
  balance,
}: {
  userId: string;
  /** The name the dialog title and the aria labels read — the page's own heading. */
  playerLabel: string;
  /** The wallet right now, in Toman — shown as the field's own hint, never trusted as the final word. */
  balance: number;
}) {
  const router = useRouter();
  const amountId = useId();
  const noteId = useId();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AdjustMode>("add");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setMode("add");
    setAmount("");
    setNote("");
    setAmountError(null);
  }

  function handleSubmit(event: React.MouseEvent<HTMLButtonElement>) {
    // Keep the dialog open while the request is in flight: closing it first would
    // hide the spinner and leave the manager with no feedback at all.
    event.preventDefault();
    if (pending) return;

    const parsed = parseAmount(amount);
    if (parsed === null) {
      haptic("error");
      setAmountError(AMOUNT_INVALID);
      return;
    }
    setAmountError(null);

    const delta = mode === "add" ? parsed : -parsed;
    const trimmedNote = note.trim();

    startTransition(async () => {
      const result = await adjustBalance(userId, {
        delta,
        ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
      });

      if (result.ok) {
        haptic("success");
        setOpen(false);
        reset();
        notifySuccess("موجودی تغییر کرد", `موجودی به ${formatToman(result.balance)} رسید.`);
        // The card, the ledger and every other surface that reads the number are
        // server-rendered: re-read them instead of patching the DOM.
        router.refresh();
        return;
      }

      haptic("error");
      notifyError(result.error, result.code === "AUTH" ? AUTH_HINT : undefined);

      // `INSUFFICIENT`/`INVALID` are about the number that was typed — the dialog
      // stays open so it can be fixed. A stale page closes and re-reads.
      if (result.code === "AUTH" || result.code === "NOT_FOUND") {
        setOpen(false);
        router.refresh();
      }
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
        <Button type="button" variant="outline" disabled={pending}>
          <IconPlusMinus aria-hidden="true" />
          تغییر موجودی
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>تغییر موجودی {playerLabel}</AlertDialogTitle>
          <AlertDialogDescription>
            این جابه‌جایی تو دفتر موجودی ثبت می‌شه و از تو ایتا هم به خودش می‌رسه.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <FieldGroup className="gap-4">
          <Field>
            {/* A titled group, not a labelled field: the two buttons below *are* the
                control. Plain `Button`s with `aria-pressed` (the attendance cell's
                own pattern) instead of a stock `ToggleGroup`, whose 32px items the
                design contract's 44px tap target forbids. */}
            <FieldTitle>جهت تغییر</FieldTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={mode === "add" ? "secondary" : "outline"}
                aria-pressed={mode === "add"}
                disabled={pending}
                onClick={() => setMode("add")}
              >
                افزودن
              </Button>
              <Button
                type="button"
                variant={mode === "deduct" ? "secondary" : "outline"}
                aria-pressed={mode === "deduct"}
                disabled={pending}
                onClick={() => setMode("deduct")}
              >
                کسر
              </Button>
            </div>
          </Field>

          <Field data-invalid={amountError ? true : undefined}>
            <FieldLabel htmlFor={amountId}>مبلغ (تومان)</FieldLabel>
            <Input
              id={amountId}
              name="amount"
              inputMode="numeric"
              autoComplete="off"
              placeholder="۲۰۰۰۰"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                if (amountError) setAmountError(null);
              }}
              aria-invalid={amountError ? true : undefined}
              disabled={pending}
            />
            {amountError ? (
              <FieldError>{amountError}</FieldError>
            ) : (
              <FieldDescription>موجودی الآن: {formatToman(balance)}.</FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor={noteId}>توضیح (اختیاری)</FieldLabel>
            <Textarea
              id={noteId}
              name="note"
              rows={3}
              maxLength={MAX_NOTE_LENGTH}
              placeholder="مثلاً: بابت تسویه‌ی حضوری سانس پنجشنبه"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={pending}
            />
            <FieldDescription>
              همین جمله تو دفتر موجودی می‌مونه و تو پیام ایتا هم به خودش می‌رسه.
            </FieldDescription>
          </Field>
        </FieldGroup>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>بی‌خیال</AlertDialogCancel>
          <AlertDialogAction aria-busy={pending} disabled={pending} onClick={handleSubmit}>
            {pending ? (
              <>
                <Spinner aria-hidden="true" />
                در حال ثبت…
              </>
            ) : (
              "ثبت کن"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
