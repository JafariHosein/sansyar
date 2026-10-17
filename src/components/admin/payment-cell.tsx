"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { IconCircleCheck } from "@tabler/icons-react";

import { haptic } from "@/components/eitaa/haptics";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { seatBalanceSplitLabel, type SeatMoney } from "@/lib/balance";
import { paymentLabel, type PaymentMode, type PaymentStatus } from "@/lib/sessions";
import { notifyError, notifySuccess } from "@/lib/toast";
import { setPaymentStatus } from "@/server/actions/admin-session-manage";

/**
 * «تغییر وضعیت پرداخت» — the hall's ledger line on one seat (PROMPT.md §۵.۳ و
 * §۶.۴).
 *
 * The manager's vocabulary, not the player's: the choices are the sentences a
 * manager writes in their own notebook («آنلاین پرداخت شده»، «حضوری دریافت شده»)،
 * while the confirmation toast repeats the sentence the *player* reads on their own
 * screen (`paymentLabel`) — the two people end up knowing the same fact in the
 * words each of them uses.
 *
 * It is offered on a `CONFIRMED` and on a `WAITLIST` row alike: paying in line is
 * real (the manager may take the money early). The write is a compare-and-set in
 * `src/server/actions/admin-session-manage.ts`, so a row that is already in the
 * chosen state — or one that was canceled meanwhile — is refused with its own
 * sentence instead of being written twice.
 *
 * Two facts about the seat's **balance money** shape this cell:
 *
 *  - the split line (`seatBalanceSplitLabel`) sits under the chip, so a manager
 *    collecting at the door reads what came off the balance and what is left —
 *    the same sentence the player's own screens draw from the same numbers;
 *  - a seat the balance already settled (`PAID_BALANCE`) is a **chip and no
 *    select**: the money left the account, the ledger has a row for it, and the
 *    server answers `FROM_BALANCE` to any manual re-mark. Offering a select that
 *    can only fail is worse than saying where the correction happens.
 *
 * Server-rendered row, client island: the labels live here because a client
 * module cannot import a `"use client"` file's constants into a server component —
 * and the chip re-renders from local state, so the row answers the tap before
 * `router.refresh()` lands.
 */

/** The manager's ledger words — the same ones the account record uses. */
const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  UNPAID: "پرداخت نشده",
  PAID_ONLINE: "آنلاین پرداخت شده",
  PAID_IN_PERSON: "حضوری دریافت شده",
  PAID_BALANCE: "از موجودی پرداخت شده",
  WAIVED: "پرداخت لازم نیست",
};

/** In the order a manager settles a night's books — never `PAID_BALANCE`. */
const PAYMENT_OPTIONS: readonly PaymentStatus[] = [
  "UNPAID",
  "PAID_ONLINE",
  "PAID_IN_PERSON",
  "WAIVED",
];

const AUTH_HINT = "سانس‌یار را ببند و از ایتا دوباره باز کن.";

/** Why there is no select on a balance-settled seat — the server's own reason, shortened. */
const FROM_BALANCE_HINT = "دستی تغییرش نمی‌کنیم — اصلاحش از پرونده‌ی خودشه.";

/** The state pill: a paid seat and a waived one read differently, and both say so in words. */
function PaymentChip({ status }: { status: PaymentStatus }) {
  if (status === "PAID_ONLINE" || status === "PAID_IN_PERSON" || status === "PAID_BALANCE") {
    return (
      <Badge variant="success">
        <IconCircleCheck aria-hidden="true" />
        {PAYMENT_LABELS[status]}
      </Badge>
    );
  }

  if (status === "WAIVED") {
    return <Badge variant="secondary">{PAYMENT_LABELS.WAIVED}</Badge>;
  }

  return <Badge variant="outline">{PAYMENT_LABELS.UNPAID}</Badge>;
}

export function PaymentCell({
  registrationId,
  paymentStatus,
  amountToman,
  paidFromBalance,
  paymentMode,
  playerLabel,
}: {
  registrationId: string;
  /** The state on the row right now — the server's value, the state's starting point. */
  paymentStatus: PaymentStatus;
  /** What **this seat** costs — the price snapshot, not the session's price today. */
  amountToman: number;
  /** How much of it the account's balance covered. */
  paidFromBalance: number;
  paymentMode: PaymentMode;
  /** The name the aria labels read. */
  playerLabel: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<PaymentStatus>(paymentStatus);
  const [pending, startTransition] = useTransition();

  // The manager's split of *this* seat's money, drawn from the same three
  // columns the engine wrote (`seatBalanceSplitLabel`), and from the local state
  // so a fresh payment re-reads the split before the server lands.
  const money: SeatMoney = { amountToman, paidFromBalance, paymentStatus: status };
  const splitLabel = seatBalanceSplitLabel(money);
  const settledFromBalance = status === "PAID_BALANCE";

  function change(next: string) {
    // Radix hands back a string; only the four known states can come out of this
    // list, and anything else is dropped instead of sent.
    const parsed = PAYMENT_OPTIONS.find((option) => option === next);
    if (!parsed || pending || parsed === status) return;

    startTransition(async () => {
      const result = await setPaymentStatus(registrationId, parsed);

      if (result.ok) {
        haptic("success");
        setStatus(parsed);
        notifySuccess(
          "وضعیت پرداخت ثبت شد",
          `${playerLabel} — ${paymentLabel(amountToman, paymentMode, parsed)}.`,
        );
        // The «دریافت‌نشده» tile and every chip on the board are server-rendered.
        router.refresh();
        return;
      }

      haptic("error");
      // `FROM_BALANCE` (the seat was settled from the account and the write never
      // happened) is refused with the server's own sentence, like every other
      // refusal — the manager must not be left guessing which tap was ignored.
      notifyError(result.error, result.code === "AUTH" ? AUTH_HINT : undefined);
      // A canceled row, a stale state, a double tap: re-read instead of leaving a
      // select that can only keep failing.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <PaymentChip status={status} />

      {splitLabel ? <span className="text-caption text-ink-muted">{splitLabel}</span> : null}

      {settledFromBalance ? (
        <p className="text-caption text-ink-muted">{FROM_BALANCE_HINT}</p>
      ) : (
        <Select value={status} onValueChange={change} disabled={pending}>
          <SelectTrigger
            // The stock trigger is 32px; a tap target in this app is 44px. The
            // variant-scoped class wins over the base one in `cn`'s merge tables.
            className="w-full data-[size=default]:h-11"
            aria-label={`وضعیت پرداخت ${playerLabel}`}
            aria-busy={pending}
          >
            <SelectValue />
            {pending ? <Spinner aria-hidden="true" className="ms-auto" /> : null}
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {PAYMENT_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
