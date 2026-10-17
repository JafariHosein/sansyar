/**
 * Result shapes for the manager's actions (phases ۵ و ۶) — kept here for the
 * same reason `results.ts` exists: a `"use server"` file only exports actions,
 * and the client components that call them read the shapes from a plain module.
 *
 * Declared up front and shared: every phase-۵/۶ action shell, the client
 * controls and the verification harnesses all read one definition, so a success
 * payload can never mean two different things on two screens.
 */

import type { AttendanceStatus } from "@/lib/sessions";
import type { PenaltyType } from "@/lib/penalties";

// ---------------------------------------------------------------------------
// Attendance — the manager's mark on one seat (phase ۵، §۵.۵)
// ---------------------------------------------------------------------------

/**
 * Why an attendance mark was refused.
 *
 *  - `AUTH`                  — no verified admin session.
 *  - `NOT_FOUND`             — no such registration.
 *  - `NOT_CONFIRMED`         — the row is waiting in line (or was canceled):
 *                              only a seat in the hall takes attendance.
 *  - `NOT_STARTED`           — attendance is about a session that has begun.
 *  - `SESSION_CANCELED`      — a canceled session has no attendance.
 *  - `SESSION_NOT_PUBLISHED` — a draft is not a session yet.
 *  - `INVALID`               — bad input (a late mark without minutes).
 */
export type AttendanceFailureCode =
  | "AUTH"
  | "NOT_FOUND"
  | "NOT_CONFIRMED"
  | "NOT_STARTED"
  | "SESSION_CANCELED"
  | "SESSION_NOT_PUBLISHED"
  | "INVALID";

/**
 * The result of «حاضر» / «تاخیر (دقیقه)» / «غایب» on one registration.
 *
 * `lateStrikes` is the strike count inside the window *after* this mark (late
 * marks only; `null` otherwise) — the screenshot the toast wants: «دومین
 * تاخیرت تو ۳۰ روز». `penalty` names the ban this very mark wrote — a re-mark
 * never writes a second one for the same event.
 */
export type MarkAttendanceOutcome =
  | {
      ok: true;
      attendance: Exclude<AttendanceStatus, "PENDING">;
      lateMinutes: number | null;
      lateStrikes: number | null;
      penalty: { type: Extract<PenaltyType, "NO_SHOW" | "LATE_STRIKES">; days: number } | null;
    }
  | { ok: false; code: AttendanceFailureCode; error: string };

/**
 * The result of «بستن حضور و غیاب»: the remaining `PENDING` seats of a session
 * become `ABSENT`, and each no-show is charged once. `closed` is how many rows
 * the sweep touched, `penalized` how many of them got a ban.
 */
export type CloseAttendanceOutcome =
  | { ok: true; closed: number; penalized: number }
  | {
      ok: false;
      code: Exclude<AttendanceFailureCode, "NOT_CONFIRMED" | "INVALID">;
      error: string;
    };

// ---------------------------------------------------------------------------
// The manager's users surface (phase ۶، §۵.۶ / §۶.۴)
// ---------------------------------------------------------------------------

export type BanUserOutcome =
  | { ok: true; until: Date }
  | { ok: false; code: "AUTH" | "NOT_FOUND" | "INVALID"; error: string };

export type WaiveBanOutcome =
  | { ok: true }
  | { ok: false; code: "AUTH" | "NOT_FOUND" | "ALREADY"; error: string };

// ---------------------------------------------------------------------------
// Venues (phase ۶) and the default rules (phase ۶)
// ---------------------------------------------------------------------------

export type SaveVenueOutcome =
  | { ok: true; venueId: string }
  | { ok: false; code: "AUTH" | "NOT_FOUND" | "INVALID"; error: string };

export type SaveSettingsOutcome =
  | { ok: true }
  | { ok: false; code: "AUTH" | "INVALID"; error: string };

// ---------------------------------------------------------------------------
// Sessions — the full admin form and the per-session management (phase ۶)
// ---------------------------------------------------------------------------

export type SaveSessionOutcome =
  | { ok: true; sessionId: string; created: boolean }
  | { ok: false; code: "AUTH" | "NOT_FOUND" | "INVALID" | "CLOSED"; error: string };

export type SetSessionStatusOutcome =
  | { ok: true }
  | { ok: false; code: "AUTH" | "NOT_FOUND" | "CLOSED" | "INVALID"; error: string };

/**
 * Why a per-seat edit was refused.
 *
 *  - `NOT_FOUND`    — no such registration (or session).
 *  - `ALREADY`      — the row already is in the target state (canceled, paid …).
 *  - `NOT_WAITLIST` — «ارتقا» is only for a row waiting in line.
 *  - `FROM_BALANCE` — the seat was settled from the account's balance, and that
 *                     money already moved; the payment select never re-marks it.
 *  - `CLOSED`       — the session is canceled; it takes no more edits.
 */
export type RegistrationAdminFailureCode =
  | "AUTH"
  | "NOT_FOUND"
  | "ALREADY"
  | "NOT_WAITLIST"
  | "FROM_BALANCE"
  | "CLOSED"
  | "INVALID";

export type SetPaymentOutcome =
  | { ok: true }
  | { ok: false; code: RegistrationAdminFailureCode; error: string };

/**
 * Removing a held seat frees it — `promoted` says whether a waiter moved up, and
 * `refundedToman` is what the removed seat sent back to its player's balance
 * (0 when the seat carried no money).
 */
export type RemoveRegistrationOutcome =
  | { ok: true; promoted: boolean; refundedToman: number }
  | { ok: false; code: RegistrationAdminFailureCode; error: string };

/**
 * A manual promotion hands a seat over: `chargedToman` is what the account's
 * balance paid right then, and `outstandingToman` is what is still due — `۰`
 * when the balance settled it whole (the seat lands `PAID_BALANCE`).
 */
export type PromoteWaiterOutcome =
  | { ok: true; chargedToman: number; outstandingToman: number }
  | { ok: false; code: RegistrationAdminFailureCode; error: string };

/** «لغو کل سانس»: everyone released, nobody penalized; `canceled` is how many rows. */
export type CancelSessionOutcome =
  | { ok: true; canceled: number }
  | { ok: false; code: "AUTH" | "NOT_FOUND" | "CLOSED"; error: string };

// ---------------------------------------------------------------------------
// The account's balance (the balance round) — «تغییر موجودی»
// ---------------------------------------------------------------------------

/**
 * Why a manual balance change was refused.
 *
 *  - `AUTH`         — no verified admin session.
 *  - `NOT_FOUND`    — no such account.
 *  - `INVALID`      — the amount (or the note) did not pass the schema.
 *  - `INSUFFICIENT` — a subtraction larger than the balance: the account never
 *                     goes negative, the manager gets told instead.
 */
export type AdjustBalanceFailureCode = "AUTH" | "NOT_FOUND" | "INVALID" | "INSUFFICIENT";

/**
 * The result of «تغییر موجودی» on the account's page: the balance after the
 * movement, so the card can show the new number without a reload.
 */
export type AdjustBalanceOutcome =
  | { ok: true; balance: number }
  | { ok: false; code: AdjustBalanceFailureCode; error: string };
