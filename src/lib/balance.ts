/**
 * The **balance** display logic — pure, shared by server and client.
 *
 * Three facts describe one seat's money: what it costs (`amountToman`, the
 * snapshot the engine wrote when the seat was taken), how much of it came off
 * the account's balance (`paidFromBalance`) and where the rest stands
 * (`paymentStatus`). Every screen — the player's ledger, the session page, the
 * pay screen, the manager's roster — reads those three through the helpers here,
 * so «۲۰٬۰۰۰ از موجودیات کم شده · حضوری بده ۲۵٬۰۰۰» can never be worded two ways.
 *
 * The engine that writes the money lives in `src/server/balance-core.ts`; the
 * numbers are written once and these helpers only *read* them. The one rule the
 * whole feature rests on is the owner's:
 *
 *  - money paid for a seat that is given up lands on the balance — **not in
 *    cash** — and the next seat spends it automatically before asking for money.
 */

import { formatToman } from "./format";
import {
  isPaidSeat,
  NOTHING_OWED_YET,
  paymentLabel,
  type BalanceEntryType,
  type PaymentMode,
  type PaymentStatus,
  type RegistrationStatus,
} from "./sessions";

/** The three money columns of one registration, as every reader gets them. */
export type SeatMoney = {
  /** What this seat costs — the snapshot taken at registration time. */
  amountToman: number;
  /** How much of it was covered by the account's balance. */
  paidFromBalance: number;
  paymentStatus: PaymentStatus;
};

/** The part of the balance actually spent on this seat, clamped to the price. */
export function seatBalanceUsed(money: SeatMoney): number {
  return Math.min(Math.max(money.paidFromBalance, 0), money.amountToman);
}

/**
 * What the seat still owes, in Toman: only an `UNPAID` seat owes, and it owes
 * the part the balance did not cover. A fully covered seat owes nothing even if
 * a manager later flips its status by hand, because the balance money is a fact.
 */
export function seatOutstanding(money: SeatMoney): number {
  if (money.paymentStatus !== "UNPAID") return 0;
  return Math.max(0, money.amountToman - seatBalanceUsed(money));
}

/** Whether the balance alone settled the whole seat. */
export function seatCoveredByBalance(money: SeatMoney): boolean {
  return money.amountToman > 0 && seatBalanceUsed(money) >= money.amountToman;
}

/**
 * What giving this seat up hands back to the balance (the engine's formula, in
 * one place so the confirm dialog promises exactly what the transaction pays):
 * a paid seat returns its whole price, and a still-unpaid one returns only the
 * balance money it had already spent.
 */
export function cancelRefundToman(money: SeatMoney): number {
  return isPaidSeat(money.paymentStatus) ? money.amountToman : seatBalanceUsed(money);
}

/**
 * The money line of one seat, for the player's eyes.
 *
 * The vocabulary is the owner's: the balance money is **stated** (so a player
 * knows what happened without asking), the remainder says how it will be
 * collected (`حضوری بده` / `آنلاین بده`), and a canceled seat says out loud that
 * its money went to the balance — «نقدی برنمی‌گرده» is answered here, in the
 * same sentence that says where it *did* go.
 */
export function seatMoneyLabel(
  money: SeatMoney & { registrationStatus: RegistrationStatus; paymentMode: PaymentMode },
): string {
  const amount = formatToman(money.amountToman);
  const used = seatBalanceUsed(money);

  // A place in line costs nothing — same sentence the waitlist toast uses.
  if (money.registrationStatus === "WAITLIST" && money.paymentStatus === "UNPAID") {
    return `${amount} — ${NOTHING_OWED_YET}`;
  }

  // A seat that was given up: the money is on the balance now, and this is the
  // one place the player reads that fact on a history row.
  if (money.registrationStatus === "CANCELED") {
    const refunded = cancelRefundToman(money);
    return refunded > 0
      ? `${formatToman(refunded)} — لغو شد؛ به موجودیات برگشت`
      : paymentLabel(money.amountToman, money.paymentMode, money.paymentStatus);
  }

  // Nothing from the balance: the ordinary sentence, unchanged.
  if (used <= 0) {
    return paymentLabel(money.amountToman, money.paymentMode, money.paymentStatus);
  }

  if (money.paymentStatus === "WAIVED") {
    return `${amount} — پرداخت لازم نیست (${formatToman(used)} از موجودیات)`;
  }

  if (seatCoveredByBalance(money)) {
    return `${amount} — از موجودیات پرداخت شد`;
  }

  if (money.paymentStatus === "PAID_ONLINE") {
    return `${amount} — پرداخت شد (${formatToman(used)} از موجودیات)`;
  }
  if (money.paymentStatus === "PAID_IN_PERSON") {
    return `${amount} — حضوری دریافت شد (${formatToman(used)} از موجودیات)`;
  }

  const owed = formatToman(seatOutstanding(money));
  const how = money.paymentMode === "AT_REGISTRATION" ? "آنلاین بده" : "حضوری بده";
  return `${amount} — ${formatToman(used)} از موجودیات کم شد · ${how} ${owed}`;
}

/**
 * The sentence a player reads at the door. The owner's rule: the person shows
 * this to the manager, and the manager — whose own roster line states the same
 * balance deduction — can see that the remainder is the only money to collect.
 * `null` when there is nothing to show (nothing paid, or nothing left to pay).
 */
export function inPersonRemainderNote(money: SeatMoney): string | null {
  const used = seatBalanceUsed(money);
  const owed = seatOutstanding(money);
  if (used <= 0 || owed <= 0) return null;

  return `حضوری فقط ${formatToman(owed)} بده — ${formatToman(
    used,
  )} از موجودیات حساب شده. همین رو به مدیر نشون بده.`;
}

/** The hint a player with a balance reads before registering a seat. */
export function myBalanceHint(balance: number): string {
  return `موجودیت: ${formatToman(balance)} — هنگام ثبت‌نام خودکار ازش کم می‌شه.`;
}

/**
 * The manager's compact version of the same facts, for a roster row: half the
 * sentence, twice the information — what came off the balance and what is left
 * to collect. `null` when the balance played no part (the payment chip says it).
 */
export function seatBalanceSplitLabel(money: SeatMoney): string | null {
  const used = seatBalanceUsed(money);
  if (used <= 0) return null;

  if (seatCoveredByBalance(money)) {
    return `کامل از موجودی (${formatToman(money.amountToman)})`;
  }

  if (money.paymentStatus === "UNPAID") {
    return `از موجودی ${formatToman(used)} · مانده ${formatToman(seatOutstanding(money))}`;
  }

  return `از موجودی ${formatToman(used)} · بقیه دریافت شده`;
}

/**
 * The one-line answer right after a registration, when the balance played a
 * part: what came off it, and what is left for the player to hand over. `null`
 * when the balance was not involved (the toast's existing copy says it all) or
 * when the row is only a place in line — a waitlisted row spends nothing.
 */
export function balanceRegisterNote(input: {
  status: "CONFIRMED" | "WAITLIST";
  amountToman: number;
  fromBalance: number;
  paymentStatus: PaymentStatus;
  paymentMode: PaymentMode;
}): string | null {
  if (input.status !== "CONFIRMED" || input.fromBalance <= 0) return null;

  const used = `${formatToman(input.fromBalance)} از موجودیت کم شد`;
  if (input.paymentStatus !== "UNPAID") return `${used} — کامل حساب شد.`;

  const how = input.paymentMode === "AT_REGISTRATION" ? "آنلاین بده" : "حضوری بده";
  return `${used} — ${how} ${formatToman(Math.max(0, input.amountToman - input.fromBalance))}.`;
}

/**
 * The money clause of a **manual promotion**'s success toast, appended to «…
 * حالا صاحب صندلیه». The balance pays the moment the seat becomes theirs, so a
 * promoted seat may be settled on the spot (`PAID_BALANCE`), half-paid, or
 * wholly due — and the manager's sentence says which, from the action's own
 * numbers, never a guess.
 */
export function promotedSeatNote(input: {
  chargedToman: number;
  outstandingToman: number;
}): string {
  if (input.outstandingToman <= 0) {
    return input.chargedToman > 0
      ? " و کل مبلغش از موجودیش حساب شد."
      : " و چیزی برای پرداخت نمونده.";
  }
  if (input.chargedToman > 0) {
    return `؛ ${formatToman(input.chargedToman)} از موجودیش کم شد و ${formatToman(
      input.outstandingToman,
    )} مونده.`;
  }
  return " و باید پرداخت کنه.";
}

/**
 * What the cancel dialog promises before the player confirms: the seat's money
 * lands on the balance (never in cash), and the next registration spends it
 * automatically. `null` when the seat carries no money (`cancelRefundToman` = 0).
 */
export function cancelRefundNote(refundToman: number): string | null {
  if (refundToman <= 0) return null;

  return `${formatToman(
    refundToman,
  )} به موجودیت برمی‌گرده (نقدی برنمی‌گرده) — ثبت‌نام بعدی خودکار ازش کم می‌شه.`;
}

/**
 * The half-covered sentence for the pay screen: how much of the seat the balance
 * already settled, and what is still to pay. `null` when the balance paid nothing
 * (the row and the amount already say the whole story).
 */
export function balanceCoveredNote(money: SeatMoney): string | null {
  const used = seatBalanceUsed(money);
  if (used <= 0) return null;

  return `${formatToman(used)} از موجودیت حساب شده — ${formatToman(
    seatOutstanding(money),
  )} مونده.`;
}

// ---------------------------------------------------------------------------
// The ledger — words for `BalanceEntry` rows
// ---------------------------------------------------------------------------

/** The four words the manager's ledger reads. */
export const BALANCE_ENTRY_LABELS: Record<BalanceEntryType, string> = {
  REGISTRATION_DEDUCT: "استفاده در ثبت‌نام",
  CANCEL_REFUND: "برگشت از لغو",
  ADMIN_ADJUST: "تنظیم مدیر",
};

/**
 * One row of a balance ledger, as both readers hand it over — the player's own
 * history and the manager's view of an account read the **same shape**, so a
 * movement can never be described two ways on two screens. `amount` is signed
 * (a spend is negative), `balanceAfter` is where the account stood right after
 * it, and the session's name / the manager's name are what make a row readable
 * without a join on the screen.
 */
export type BalanceLedgerRow = {
  id: string;
  amount: number;
  balanceAfter: number;
  type: BalanceEntryType;
  note: string | null;
  createdAt: Date;
  sessionId: string | null;
  sessionTitle: string | null;
  /** The manager behind a manual adjustment; `null` on the engine's own rows. */
  byAdminName: string | null;
};

/** `+۴۵٬۰۰۰ تومان` / `−۲۰٬۰۰۰ تومان` — a movement's direction lives in its sign. */
export function signedTomanLabel(amount: number): string {
  return `${amount >= 0 ? "+" : "−"}${formatToman(Math.abs(amount))}`;
}
