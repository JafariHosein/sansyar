"use server";

/**
 * «لغو ثبت‌نام» (PROMPT.md §۵.۴ + §۵.۶) — the shell around the cancel engine.
 *
 * The transaction itself lives in `src/server/registration-core.ts`
 * (`cancelSeat`), next to the seat allocation it completes: releasing a seat,
 * promoting the first person in line and recording at most one `Penalty` row all
 * happen in one transaction that locks the session row before it reads anything.
 * This module keeps only what a server action must own: the signed session, the
 * zod id check, the revalidation, the **fire-and-forget Eitaa messages** and the
 * mapping down to the shape a browser gets.
 *
 * Two consequences of the membership flow show up here:
 *
 *  - a waitlisted row is free to give up wherever the clock is — the engine
 *    returns `waitlistCancelVerdict()` and writes no `Penalty` row, so the
 *    canceler gets no message about a penalty that never happened;
 *  - the promoted waiter lands **straight in the hall** — the membership gate
 *    already vetted the person — and the message says exactly that: «از لیست
 *    انتظار دراومدی و ثبت‌نامت قطعی شد».
 *
 * The **balance rule** shows up as one field: `refundedToman`. The core sent the
 * seat's money back to the account's balance inside the same transaction (never
 * as cash), and this shell only passes the number through so the toast can say
 * «۲۰٬۰۰۰ به موجودیت برگشت» — the ledger already has the record.
 *
 * The rule the player confirmed in the dialog is recomputed by the core with the
 * **same helper** (`cancelVerdictNow` / `waitlistCancelVerdict`) from the same
 * facts, so the engine can never write something the dialog did not say. If the
 * clock moved between opening the dialog and confirming, the engine is right and
 * the toast reports what actually happened.
 */

import "server-only";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  lateCancelPenaltyMessage,
  lateCancelWarningMessage,
  notifyPlayer,
  notifySessionLabel,
  notifySessionLink,
  promotedMessage,
} from "@/lib/eitaa-notify";
import { cancelSeat, SESSION_NOT_FOUND } from "@/server/registration-core";

import type { CancelOutcome } from "./results";

/** Session ids are cuids; anything longer did not come from this app. */
const SessionIdSchema = z.string().min(1).max(64);

/**
 * «لغو ثبت‌نام». Releases the viewer's own seat, promotes the first waiter when
 * the seat was really held, and records the late-cancel event as §۵.۶ requires.
 */
export async function cancelRegistration(sessionId: string): Promise<CancelOutcome> {
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

  // One clock for the whole request, handed to the core and to the messages:
  // the guards, the verdict and the penalty window all agree on what "now" means.
  const now = new Date();
  const outcome = await cancelSeat(prisma, { sessionId: id, userId: viewer.id, now });

  if (!outcome.ok) return outcome;

  // The write is committed; tell the screens that show it. `/profile` carries
  // «سابقه‌ی من», which a warning or a ban just changed.
  revalidatePath("/");
  revalidatePath("/my");
  revalidatePath(`/sessions/${id}`);
  revalidatePath("/profile");

  // The messages go out **after** the commit and never block it: `notifyPlayer`
  // swallows every refusal (Eitaa's per-user credit runs out, a player may have
  // closed the program, the API may be down) and logs it instead. One message per
  // player per event, and none of them knows about the other.
  const label = notifySessionLabel(outcome.sessionTitle, outcome.startsAt);

  if (outcome.promotedEitaaId) {
    void notifyPlayer(
      outcome.promotedEitaaId,
      promotedMessage({ label, link: notifySessionLink(id) }),
    );
  }

  if (outcome.kind === "LATE_WARNING") {
    void notifyPlayer(viewer.eitaaId, lateCancelWarningMessage({ label }));
  } else if (outcome.kind === "LATE_PENALTY") {
    void notifyPlayer(
      viewer.eitaaId,
      lateCancelPenaltyMessage({ label, days: outcome.penaltyDays }),
    );
  }

  // The engine's extra fields (the promoted player's Eitaa id, the session title)
  // stay on this side of the wire.
  return {
    ok: true,
    kind: outcome.kind,
    penaltyDays: outcome.penaltyDays,
    promoted: outcome.promoted,
    refundedToman: outcome.refundedToman,
  };
}
