/**
 * Result shapes shared by server actions and the client components that call
 * them. Kept in their own module so a `"use server"` file only exports actions.
 */

import type { CancelVerdictKind, MembershipStatus, PaymentStatus } from "@/lib/sessions";

export type UserRole = "USER" | "ADMIN";

/** The minimum the client needs to render chrome (name, admin tab). */
export type SessionUserPayload = {
  /** The display name: the Eitaa name, or the one the player set («تغییر نام»). */
  name: string;
  role: UserRole;
  eitaaId: string;
  /**
   * The contact number, or `null` while the account has not answered yet. It
   * rides in the login payload so the first-run sheet can decide without a
   * second request — and it is the *viewer's own* number, never somebody else's.
   * Asked **once** and immutable: the sheet that collects it is the last word.
   */
  phone: string | null;
  /**
   * The player's real name pair — the same first-run sheet's second answer.
   * `null` until it is given: the sheet renders while either half is missing, so
   * the client never needs a second query to decide. `name` above stays the
   * display name; these two are what the manager reads on the roster.
   */
  firstName: string | null;
  lastName: string | null;
  /**
   * The account-level approval (the membership gate). `APPROVED` is the only
   * status that lets the app be used; the client gate renders the waiting or
   * rejection screen for the other two, and an admin is approved by definition.
   */
  membershipStatus: MembershipStatus;
};

export type ActionFailure = { ok: false; error: string };

export type EitaaLoginSuccess = {
  ok: true;
  user: SessionUserPayload;
  /** Verified `start_param` from the signed payload; `s_<sessionId>` for a share link. */
  startParam: string | null;
};

export type EitaaLoginResult = EitaaLoginSuccess | ActionFailure;

// ---------------------------------------------------------------------------
// Registration (§۵.۲)
// ---------------------------------------------------------------------------

/**
 * Why a registration was refused. The screen switches on this, never on the
 * Persian message, so the wording can change without touching a `switch`.
 *
 *  - `AUTH`      — no verified session (the app was opened outside Eitaa).
 *  - `NOT_FOUND` — no such session, or it is still a draft.
 *  - `NOT_OPEN`  — the registration window has not opened yet.
 *  - `CLOSED`    — the window is over, the session is running/finished, or the
 *                  manager canceled it.
 *  - `BANNED`    — an active penalty blocks every registration.
 *  - `NOT_APPROVED` — the account has not passed the membership gate: the client
 *                  shows the waiting/rejection screen and the engine refuses here,
 *                  so the gate holds even for a hand-made request.
 *  - `ALREADY`   — the player is already on this session's list: holding a seat or
 *                  queued. The sentence says which.
 */
export type RegisterFailureCode =
  | "AUTH"
  | "NOT_FOUND"
  | "NOT_OPEN"
  | "CLOSED"
  | "BANNED"
  | "NOT_APPROVED"
  | "ALREADY";

/**
 * The result of tapping «ثبت‌نام در سانس».
 *
 * Success carries where the player landed: a free seat is **`CONFIRMED`** — the
 * membership gate already vetted the person, so there is no second approval — and
 * a full hall answers `WAITLIST` with the 1-based queue position (the session page
 * shows the whole line, so the number is a fact, not a promise). A ban carries
 * `bannedUntil` as an ISO instant so the card can say «محروم تا …» without
 * re-deriving it from the message text.
 *
 * The money of the moment rides along too — the seat's snapshotted price, how
 * much of it the balance covered (`fromBalance`) and where the rest stands
 * (`paymentStatus`) — so the confirmation toast can say «۲۰٬۰۰۰ از موجودیت کم
 * شد» without waiting for the screen behind it to re-render. A waitlisted row
 * spends nothing: `fromBalance` is 0 there by definition.
 */
export type RegisterOutcome =
  | {
      ok: true;
      status: "CONFIRMED" | "WAITLIST";
      waitlistPosition: number | null;
      amountToman: number;
      fromBalance: number;
      paymentStatus: PaymentStatus;
    }
  | { ok: false; code: RegisterFailureCode; error: string; bannedUntil?: string };

// ---------------------------------------------------------------------------
// Cancel (§۵.۴) and the mock gateway (§۵.۳) — phase ۴
// ---------------------------------------------------------------------------

/**
 * Why a cancel was refused.
 *
 *  - `AUTH`           — no verified session (opened outside Eitaa).
 *  - `NOT_FOUND`      — no such session, or it is still a draft.
 *  - `NOT_REGISTERED` — the player has no seat here (already released or never had one).
 *  - `ALREADY_CANCELED` — the seat was already given up; a second tap is not an event.
 *  - `CLOSED`         — the manager canceled the session, or it is not published.
 *  - `STARTED`        — the session began; attendance (§۵.۵) takes over from cancelling.
 */
export type CancelFailureCode =
  | "AUTH"
  | "NOT_FOUND"
  | "NOT_REGISTERED"
  | "ALREADY_CANCELED"
  | "CLOSED"
  | "STARTED";

/**
 * The result of «لغو ثبت‌نام».
 *
 * Success carries the verdict the dialog already showed (`kind` + `penaltyDays`)
 * so the toast can confirm exactly what the player agreed to, plus whether the
 * freed seat went to the first person in line — the visible consequence of §۵.۲ —
 * and the money the cancel sent back to the balance (`refundedToman`, 0 when the
 * seat carried none). Deliberately *only* those fields: the engine's richer
 * answer (the promoted player's Eitaa id, the session title) exists for the
 * shell's notifications and must never be shipped to a browser.
 */
export type CancelOutcome =
  | {
      ok: true;
      kind: CancelVerdictKind;
      penaltyDays: number;
      promoted: boolean;
      refundedToman: number;
    }
  | { ok: false; code: CancelFailureCode; error: string };

// ---------------------------------------------------------------------------
// The manager's decision on a membership request (the membership gate)
// ---------------------------------------------------------------------------

/**
 * Why a membership decision was refused.
 *
 *  - `AUTH`             — no verified admin session (the proxy is never the boundary).
 *  - `NOT_FOUND`        — no such account.
 *  - `ALREADY_APPROVED` — the account is already a member; nothing to decide.
 *  - `NOT_PENDING`      — the account is not waiting for a decision: it is already
 *                         rejected. A rejection is not re-decidable — it is
 *                         **re-approvable**, which is the button that matters.
 */
export type MembershipFailureCode = "AUTH" | "NOT_FOUND" | "ALREADY_APPROVED" | "NOT_PENDING";

/**
 * The result of tapping «تأیید» / «رد عضویت» in the membership queue.
 *
 * A rejection is **not final**: the manager can re-approve the account from the
 * «ردشده‌ها» list, and the decision message goes to the player either way.
 */
export type MembershipOutcome =
  | { ok: true; decision: "APPROVED" | "REJECTED" }
  | { ok: false; code: MembershipFailureCode; error: string };

/**
 * The result of the membership gate's «دوباره چک کن» — a fresh read of the
 * viewer's own status, so an approval that landed while the app was open becomes
 * visible without a reload.
 */
export type MembershipCheckOutcome =
  | { ok: true; status: MembershipStatus }
  | { ok: false; code: "AUTH"; error: string };

/**
 * Why a (mock) payment was refused.
 *
 *  - `NOT_REGISTERED` — nothing to pay for (never registered, or canceled — the
 *                       row is not a live seat).
 *  - `NOT_CONFIRMED`  — the seat is not the player's yet: waitlisted. Pay when a
 *                       seat opens and the row is promoted.
 *  - `NOT_PAYABLE`    — the session collects money in person.
 *  - `ALREADY_PAID`   — the money is already recorded; never charge twice.
 *  - `CLOSED`         — the session is not published (manager canceled it).
 */
export type PayFailureCode =
  | "AUTH"
  | "NOT_FOUND"
  | "NOT_REGISTERED"
  | "NOT_CONFIRMED"
  | "NOT_PAYABLE"
  | "ALREADY_PAID"
  | "CLOSED";

export type PayOutcome =
  | { ok: true; amountToman: number; paidAt: string }
  | { ok: false; code: PayFailureCode; error: string };

// ---------------------------------------------------------------------------
// Profile (§۶.۳) — phase ۴
// ---------------------------------------------------------------------------

/**
 * The result of «تغییر نام». `INVALID` carries the sentence the input shows
 * under itself, so the rule lives in one place (the zod schema) and the screen
 * never restates it.
 */
export type RenameOutcome =
  | { ok: true; name: string }
  | { ok: false; code: "AUTH" | "INVALID"; error: string };

/**
 * Why saving a number was refused.
 *
 *  - `AUTH`        — no verified session (the app was opened outside Eitaa).
 *  - `LOCKED`      — the account already has a number. The number is collected
 *                    **once** and immutable (the owner's rule): the same digits
 *                    are a no-op, different ones a refusal the manager arbitrates.
 *  - `UNAVAILABLE` — `EITAA_BOT_TOKEN` is not configured, so Eitaa cannot be asked.
 *  - `BAD_HASH`    — the contact payload's signature did not check out.
 *  - `STALE`       — signed, but its `auth_date` is too old (or in the future).
 *  - `MISMATCH`    — the payload belongs to another Eitaa account: never stored.
 *  - `NO_PHONE`    — verified, but it carried no usable number.
 *  - `MISSING`     — nothing arrived from Eitaa at all.
 */
export type PhoneFailureCode =
  | "AUTH"
  | "LOCKED"
  | "UNAVAILABLE"
  | "BAD_HASH"
  | "STALE"
  | "MISMATCH"
  | "NO_PHONE"
  | "MISSING";

/**
 * The result of saving the contact number — asked once, on the first-run sheet,
 * and reachable no other way: `savePhoneFromEitaa` is the only producer, so the
 * number always came from Eitaa itself and is immutable afterwards (typed entry
 * was removed by the owner's rule; the sheet cannot be sidestepped). A refusal
 * carries the reason the payload was not good enough, so the sheet and the
 * action can never disagree about what a valid number is.
 */
export type PhoneOutcome =
  | { ok: true; phone: string }
  | { ok: false; code: PhoneFailureCode; error: string };

/**
 * The result of saving the player's **real name** pair — the second answer of the
 * same first-run sheet the number comes from.
 *
 * `INVALID` carries the sentence the field shows under itself (the rule lives in
 * the zod schema, and the screen never restates it), and `LOCKED` is the pair's
 * own version of the number's immutability: asked once, then the manager's
 * business. Same digits — sorry, same *characters* — are a no-op, not a refusal.
 */
export type RealNameOutcome =
  | { ok: true; firstName: string; lastName: string }
  | { ok: false; code: "AUTH" | "INVALID" | "LOCKED"; error: string };
