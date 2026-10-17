/**
 * The manager's **venues** — the read side of `/admin/venues` (PROMPT.md §۶.۴).
 *
 * Two rules, both borrowed from `src/server/sessions/queries.ts`:
 *
 *  - **No counts per row.** The «N سانس» caption of every venue comes from a
 *    single `groupBy` over `Session`, not one query per list item — 3 venues and
 *    300 venues cost the same two round trips.
 *  - **No `getCurrentUser()` here.** The pages resolve the viewer inside their own
 *    `<Suspense>` boundary; a query never reads cookies on its own.
 *
 * `server-only` on purpose: Prisma (and the whole read model) must never be
 * reachable from a client bundle. The types below are structural — the pages and
 * the form import them with `import type`, which is erased at compile time.
 */

import "server-only";

import { prisma } from "@/lib/db";

/** One row of the venues list: the venue itself, plus what sits on it. */
export type VenueListRow = {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
  /**
   * Every session ever attached to this venue — canceled ones included.
   *
   * The caption is about the venue's history, not about what is bookable today:
   * a venue with 40 finished sessions and 0 upcoming ones is a real venue, and
   * hiding that with a filtered count would make the number unreadable.
   */
  sessionCount: number;
};

/** The editable columns of one venue — exactly the fields of the venue form. */
export type VenueDetail = {
  id: string;
  name: string;
  address: string;
  description: string | null;
  mapUrl: string | null;
  isActive: boolean;
};

/**
 * Every venue, ordered by name (the id breaks a tie between two rows that share
 * one, so the list order is stable from one render to the next), each with its
 * session count.
 */
export async function listVenues(): Promise<VenueListRow[]> {
  const venues = await prisma.venue.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, address: true, isActive: true },
  });

  if (venues.length === 0) return [];

  // One read for the whole screen; the ids come from the rows just loaded, so a
  // count can never be about a venue that is not on screen.
  const counts = await prisma.session.groupBy({
    by: ["venueId"],
    where: { venueId: { in: venues.map((venue) => venue.id) } },
    _count: { _all: true },
  });

  const byVenue = new Map(counts.map((row) => [row.venueId, row._count._all]));

  return venues.map((venue) => ({
    ...venue,
    sessionCount: byVenue.get(venue.id) ?? 0,
  }));
}

/**
 * One venue, or `null`. The edit page turns the `null` into `notFound()`, so a
 * deleted venue shows «این مکان پیدا نشد» instead of an empty form that would
 * write a second row on save.
 */
export async function getVenue(id: string): Promise<VenueDetail | null> {
  return prisma.venue.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      description: true,
      mapUrl: true,
      isActive: true,
    },
  });
}
