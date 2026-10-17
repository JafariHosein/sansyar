"use server";

/**
 * The (mock) online gateway — «پرداخت موفق (تست)» (PROMPT.md §۵.۳).
 *
 * There is no real gateway here and there will not be one in this version: the
 * action only **records** the payment the player just simulated. That is also why
 * it needs no transaction and no row lock — the one thing that must never happen
 * twice is the write itself, and the state lives in the `WHERE` clause of a single
 * conditional update (`UNPAID` → `PAID_ONLINE`). Two taps cannot both "charge":
 * the second one matches no row and is answered as already paid.
 *
 * The amount is the **seat's own**: what the row snapshotted at registration time
 * minus whatever the balance already covered. A seat the balance settled entirely
 * is `PAID_BALANCE` and never reaches this action; should a hand-made call try,
 * the zero remainder answers `ALREADY_PAID` instead of "charging" nothing.
 */

import "server-only";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

import type { PayOutcome } from "./results";

/** Session ids are cuids; anything longer did not come from this app. */
const SessionIdSchema = z.string().min(1).max(64);

/** Said for a bad id and a missing session alike — a draft is not a session yet. */
const SESSION_NOT_FOUND = "این سانس رو پیدا نکردیم.";

/** The money is recorded once; every later tap is this answer, not a new charge. */
const ALREADY_PAID = "این مبلغ قبلاً پرداخت شده.";

/**
 * «پرداخت موفق (تست)». Marks the viewer's confirmed, unpaid seat as paid online
 * and returns the amount that was (pretend-)collected.
 */
export async function payForRegistration(sessionId: string): Promise<PayOutcome> {
  const parsed = SessionIdSchema.safeParse(sessionId);
  if (!parsed.success) {
    return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };
  }
  const id = parsed.data;

  // The proxy in `proxy.ts` only shapes requests; it is not an auth boundary.
  // Every action reads the signed session itself.
  const viewer = await getCurrentUser();
  if (!viewer) {
    return { ok: false, code: "AUTH", error: "نشستت منقضی شده — برنامک رو دوباره باز کن." };
  }
  const userId = viewer.id;

  // One clock for the request: the guards and the recorded `paidAt` agree on
  // what "now" means.
  const now = new Date();

  // One read for everything the guards need: the slot, plus *this* player's seat
  // (filtered by `userId`, `take: 1`, because `@@unique([sessionId, userId])`
  // allows exactly one row).
  const session = await prisma.session.findUnique({
    where: { id },
    select: {
      status: true,
      startsAt: true,
      endsAt: true,
      paymentMode: true,
      registrations: {
        where: { userId },
        take: 1,
        select: {
          status: true,
          paymentStatus: true,
          amountToman: true,
          paidFromBalance: true,
        },
      },
    },
  });

  if (!session || session.status === "DRAFT") {
    return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };
  }
  // The only non-published status left is CANCELED: the manager released this
  // slot, so nothing about it is payable any more.
  if (session.status !== "PUBLISHED") {
    return { ok: false, code: "CLOSED", error: "این سانس رو مدیر لغو کرده — پرداختی لازم نیست." };
  }
  // Money can be recorded while the session is ahead (or running); once it is
  // over the ledger is the manager's business, not a gateway's.
  if (now.getTime() >= session.endsAt.getTime()) {
    return { ok: false, code: "CLOSED", error: "این سانس برگزار شده — پرداخت دیگه ممکن نیست." };
  }

  const registration = session.registrations[0];
  // A canceled seat is not a seat: answer it like "no registration" instead of
  // claiming the player is queued. (No screen offers payment for a canceled row —
  // `needsPayment` requires `CONFIRMED` — so this is a stale tap, not a path.)
  if (!registration || registration.status === "CANCELED") {
    return { ok: false, code: "NOT_REGISTERED", error: "برای این سانس ثبت‌نامی نداری." };
  }
  // A waitlisted row holds no seat and owes nothing: the gateway opens when a
  // seat frees and the promotion moves the row into the hall. The wording names
  // the wait so the tap reads as a sequence, not as a refusal.
  if (registration.status !== "CONFIRMED") {
    return {
      ok: false,
      code: "NOT_CONFIRMED",
      error: "تو لیست انتظار هستی — تا جا آزاد نشه، پرداختی لازم نیست.",
    };
  }
  if (session.paymentMode !== "AT_REGISTRATION") {
    return { ok: false, code: "NOT_PAYABLE", error: "این سانس حضوری دریافت می‌شه." };
  }
  // `UNPAID` is the only state that is not "already recorded": `PAID_ONLINE` and
  // `PAID_IN_PERSON` came from a real tap, `PAID_BALANCE` off the account's own
  // balance, and `WAIVED` from the manager.
  if (registration.paymentStatus !== "UNPAID") {
    return { ok: false, code: "ALREADY_PAID", error: ALREADY_PAID };
  }

  // What is genuinely left to collect: the seat's snapshot minus the part the
  // balance already covered. Zero means the balance settled it and only a stale
  // status (a hand-made revert) is talking — never "charge" nothing.
  const outstandingToman = Math.max(
    0,
    registration.amountToman - registration.paidFromBalance,
  );
  if (outstandingToman <= 0) {
    return { ok: false, code: "ALREADY_PAID", error: ALREADY_PAID };
  }

  // The whole "charge" is one conditional write: the state it requires lives in
  // the `WHERE` clause, so two taps can never both match the same `UNPAID` row.
  // `count === 0` means the other tap — or the manager, or a cancel — got there
  // first, and the honest answer is the same as any other re-tap.
  const flip = await prisma.registration.updateMany({
    where: {
      sessionId: id,
      userId,
      status: "CONFIRMED",
      paymentStatus: "UNPAID",
    },
    data: { paymentStatus: "PAID_ONLINE", paidAt: now },
  });

  if (flip.count === 0) {
    return { ok: false, code: "ALREADY_PAID", error: ALREADY_PAID };
  }

  // The write is committed; tell the screens that show it.
  revalidatePath("/");
  revalidatePath("/my");
  revalidatePath(`/sessions/${id}`);

  return { ok: true, amountToman: outstandingToman, paidAt: now.toISOString() };
}
