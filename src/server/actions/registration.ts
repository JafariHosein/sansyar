"use server";

/**
 * «ثبت‌نام در سانس» (PROMPT.md §۵.۲) — the shell around the one transactional
 * write of phase ۳.
 *
 * The transaction itself lives in `src/server/registration-core.ts`
 * (`registerSeat`), so the exact same seat allocation runs in this action and in
 * `scripts/check-registration-race.ts`. This module keeps only what a server
 * action must own: the signed session, the zod id check, the revalidation and the
 * refusal copy.
 *
 * The button state in the UI is a hint, never the rule: the core re-checks the
 * ban, the **membership gate**, the session, the window and occupancy (the
 * `CONFIRMED` seats) inside its transaction, after the session row is locked.
 * Two taps landing in the same millisecond can never both take the last seat.
 *
 * A free seat lands **`CONFIRMED`** — the membership gate already vetted the
 * person, so there is no second approval and this action sends no Eitaa message;
 * a full hall answers `WAITLIST`, and the promotion message is the cancel shell's
 * business.
 */

import "server-only";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { registerSeat, SESSION_NOT_FOUND } from "@/server/registration-core";

import type { RegisterOutcome } from "./results";

/** Session ids are cuids; anything longer did not come from this app. */
const SessionIdSchema = z.string().min(1).max(64);

/**
 * «ثبت‌نام در سانس». Takes the seat when one is free, or puts the player at the
 * end of the waitlist when the hall is full — both inside one transaction.
 */
export async function registerForSession(sessionId: string): Promise<RegisterOutcome> {
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

  // One clock for the whole request, taken by the core: the ban check, the stage
  // and the row all agree on what "now" means.
  const outcome = await registerSeat(prisma, { sessionId: id, userId: viewer.id });

  if (!outcome.ok) return outcome;

  // The seat is committed; tell the screens that show it.
  revalidatePath("/");
  revalidatePath("/my");
  revalidatePath("/profile");
  revalidatePath(`/sessions/${id}`);

  return outcome;
}
