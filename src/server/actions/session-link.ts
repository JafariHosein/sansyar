"use server";

/**
 * Can this shared link be opened? (PROMPT.md §۱۳.۶)
 *
 * A `?startapp=s_<id>` link travels through chats and can outlive its session, so
 * the Eitaa bridge asks this *before* navigating: a missing or unpublished id must
 * land the player on the board with a toast, never on a page that only says "not
 * found". A canceled session still opens — its page says «لغو شده», which is
 * exactly what the holder of the link needs to know.
 *
 * Deliberately a server action rather than a query: the caller is a Client
 * Component (the bridge), and `src/server/sessions/queries.ts` is `server-only`.
 */

import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/db";

/** Session ids are cuids; anything longer did not come from this app. */
const SessionIdSchema = z.string().min(1).max(64);

export async function canOpenSession(sessionId: string): Promise<boolean> {
  const parsed = SessionIdSchema.safeParse(sessionId);
  if (!parsed.success) return false;

  const session = await prisma.session.findFirst({
    where: { id: parsed.data, status: { not: "DRAFT" } },
    select: { id: true },
  });

  return session !== null;
}
