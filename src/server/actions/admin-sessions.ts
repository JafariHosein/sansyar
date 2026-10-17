"use server";

/**
 * The manager's **session writes** — `/admin/sessions/new`, `/admin/sessions/[id]/edit`
 * and the status tap on the manage screen (PROMPT.md §۶.۴).
 *
 * Every action is a thin shell that owns exactly what a server action must own:
 *
 *   zod validation (the shared `sessionFormSchema` — the client cannot be trusted
 *   with a rule it enforces itself) → `requireAdmin()` (the proxy is never an auth
 *   boundary, and a player must not be able to invent a session) → the write → the
 *   revalidation that makes it visible.
 *
 * Three facts decide the details below:
 *
 *  - **All twelve override columns are written on every save** — as `rules` or as
 *    the all-null set. A half-written row is unreadable to `resolveCancelRules`,
 *    so "inherit everything" has to be stated, not implied by omissions.
 *  - **A canceled session takes no edits.** The predicate in the `updateMany`
 *    refuses it, and the fallback read names which refusal it was (`CLOSED` vs. a
 *    row that vanished) instead of guessing — a decision is never silent.
 *  - **The write is visible everywhere it is read**: the board, the player's
 *    ledger, the session page and the manager's own screens.
 */

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  firstSessionIssueMessage,
  sessionFormSchema,
  type SessionFormValues,
} from "@/lib/admin-sessions";
import { NO_CANCEL_OVERRIDES } from "@/lib/sessions";

import type { SaveSessionOutcome, SetSessionStatusOutcome } from "./admin-results";

/** Said for a bad payload and for a missing admin session alike — one refusal either way. */
const ADMIN_REQUIRED = "دسترسی مدیر لازمه.";

/** Vanished between opening the form and saving it. */
const SESSION_NOT_FOUND = "این سانس پیدا نشد — یه بار دیگه از فهرست سانس‌ها بازش کن.";

/** A canceled slot is history: the roster is released and nothing may be edited back in. */
const SESSION_CANCELED = "سانس لغوشده قابل ویرایش نیست.";

/** The venue select hands back an id from the list the page just rendered. */
const VENUE_NOT_FOUND = "این مکان پیدا نشد — صفحه رو دوباره باز کن.";

/** The status tap carries one of two words; anything else is not a state. */
const STATUS_INVALID = "وضعیت سانس باید پیش‌نویس یا منتشرشده باشه.";

/** Ids are cuids; anything longer did not come from this app. */
const SessionIdSchema = z.string().min(1).max(64);

/**
 * The two states the manager's own taps write. «لغو شده» is deliberately absent:
 * canceling a session releases every seat and is the manage screen's own decision
 * (`cancelSession`), never a form field that could be saved by accident.
 */
const SessionStatusSchema = z.enum(["DRAFT", "PUBLISHED"], STATUS_INVALID);

/** The form's payload: the values, plus the id when the form is editing a row. */
type SaveSessionInput = SessionFormValues & { sessionId?: string };

/**
 * Every screen whose words one session write changes: the board, the player's
 * ledger, the session page, and the manager's own list + manage screen. The
 * concrete `id` is what the manager is looking at right now; the list is what
 * they return to.
 */
function revalidateSession(sessionId: string): void {
  revalidatePath("/");
  revalidatePath("/my");
  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath(`/sessions/${sessionId}`);
}

/**
 * «ذخیره» / «انتشار» — one session row, created or updated.
 *
 * The payload is the shared `SessionFormValues`, so the very schema the form
 * validated against is re-run here: lengths, ranges, `http(s)`-only map links and
 * the relations between the four timestamps (end after start, at most twelve
 * hours, the window opens before it closes and closes by the start).
 *
 * The answer names the row it wrote (`sessionId`) and whether it is new
 * (`created`) — the form navigates to the manage screen on create and refreshes
 * in place on edit, and neither has to guess.
 */
export async function saveSession(input: SaveSessionInput): Promise<SaveSessionOutcome> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };
  }

  const parsed = sessionFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID", error: firstSessionIssueMessage(parsed.error) };
  }
  const values = parsed.data;

  // The id is validated like every other id that arrives from a browser. Absent =
  // create; present = edit, and only the form knows which.
  let sessionId: string | null = null;
  if (input.sessionId !== undefined) {
    const parsedId = SessionIdSchema.safeParse(input.sessionId);
    if (!parsedId.success) {
      return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };
    }
    sessionId = parsedId.data;
  }

  // A session with no hall is not a slot. The row exists unless the tab was left
  // open while somebody deleted the venue.
  const venue = await prisma.venue.findUnique({
    where: { id: values.venueId },
    select: { id: true },
  });
  if (!venue) {
    return { ok: false, code: "INVALID", error: VENUE_NOT_FOUND };
  }

  const data = {
    title: values.title,
    venueId: values.venueId,
    addressOverride: values.addressOverride,
    mapUrl: values.mapUrl,
    description: values.description,
    startsAt: values.startsAt,
    endsAt: values.endsAt,
    registrationOpensAt: values.registrationOpensAt,
    registrationClosesAt: values.registrationClosesAt,
    capacity: values.capacity,
    priceToman: values.priceToman,
    paymentMode: values.paymentMode,
    status: values.status,
    // Every save states all twelve rules, overridden or inherited — see the file
    // comment: `resolveCancelRules` can only resolve a row that is complete.
    ...(values.rules ?? NO_CANCEL_OVERRIDES),
  };

  if (sessionId === null) {
    const created = await prisma.session.create({ data, select: { id: true } });
    revalidateSession(created.id);
    return { ok: true, sessionId: created.id, created: true };
  }

  // `updateMany` rather than `update`: a canceled session is an expected outcome,
  // not a P2025 to catch, and the predicate states the rule in one place.
  const updated = await prisma.session.updateMany({
    where: { id: sessionId, status: { not: "CANCELED" } },
    data,
  });

  if (updated.count === 0) {
    // Two different refusals wear the same count: the row is gone, or it is
    // canceled. One read names the state so the form can say the right sentence.
    const row = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    if (!row) return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };
    return { ok: false, code: "CLOSED", error: SESSION_CANCELED };
  }

  revalidateSession(sessionId);

  return { ok: true, sessionId, created: false };
}

/**
 * «انتشار» / «برگردون به پیش‌نویس» — the one-field status tap.
 *
 * A draft is invisible to players, a published session is the board. Flipping the
 * status is therefore the one edit that must not go through the whole form (the
 * manager may only want to publish a slot they staged last night), and it is the
 * one edit that is safe as its own compare-and-set: the predicate carries the row
 * and its state, so a session canceled in another tab is refused with `CLOSED`
 * instead of being silently resurrected.
 */
export async function setSessionStatus(
  sessionId: string,
  status: "DRAFT" | "PUBLISHED",
): Promise<SetSessionStatusOutcome> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };
  }

  const parsedId = SessionIdSchema.safeParse(sessionId);
  if (!parsedId.success) {
    return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };
  }

  const parsedStatus = SessionStatusSchema.safeParse(status);
  if (!parsedStatus.success) {
    return { ok: false, code: "INVALID", error: STATUS_INVALID };
  }

  const updated = await prisma.session.updateMany({
    where: { id: parsedId.data, status: { not: "CANCELED" } },
    data: { status: parsedStatus.data },
  });

  if (updated.count === 0) {
    // Same two refusals as above, and the same refusal to guess between them.
    const row = await prisma.session.findUnique({
      where: { id: parsedId.data },
      select: { status: true },
    });
    if (!row) return { ok: false, code: "NOT_FOUND", error: SESSION_NOT_FOUND };
    return { ok: false, code: "CLOSED", error: SESSION_CANCELED };
  }

  revalidateSession(parsedId.data);

  return { ok: true };
}
