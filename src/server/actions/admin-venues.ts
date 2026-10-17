"use server";

/**
 * The manager's **venue writes** — `/admin/venues/new` and `/admin/venues/[id]/edit`
 * (PROMPT.md §۶.۴: «CRUD مکان‌ها»).
 *
 * Every action here is a thin shell around one Prisma write and owns exactly what
 * a server action must own:
 *
 *   zod validation → `requireAdmin()` (the proxy is never an auth boundary, and a
 *   player must not be able to add a hall) → the write → the revalidation that
 *   makes it visible.
 *
 * Two facts about venues decide the details below:
 *
 *  - a venue's **name and address are what players read**: every session card and
 *    every session page print them (unless the session overrides the address), so
 *    a save revalidates the board, the ledger and the session pages — not just the
 *    admin list;
 *  - `description` and `mapUrl` are optional, and the database stores them as
 *    `NULL` — the form's empty string is turned into `null` here, in one place, so
 *    no screen ever has to treat `""` as two different things.
 *
 * Deletes are deliberately absent: `Session.venueId` is `onDelete: Restrict`, and a
 * hall with history must not be erasable by one tap. Taking a venue out of service
 * is the `isActive` switch.
 *
 * The result shapes are frozen in `./admin-results` (imported, never redeclared):
 * the client control and this module read one definition.
 */

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizePersianText } from "@/lib/format";

import type { SaveVenueOutcome } from "./admin-results";

/** Said for a bad payload and for a missing admin session alike — one refusal either way. */
const ADMIN_REQUIRED = "دسترسی مدیر لازمه.";

/** Vanished between opening the form and saving it. */
const VENUE_NOT_FOUND = "این مکان پیدا نشد — یه بار دیگه از فهرست مکان‌ها بازش کن.";

/** The last-resort sentence, when zod returns an issue without a message. */
const VENUE_INVALID = "این اطلاعات قابل ثبت نیست — فیلدها رو یه بار دیگه چک کن.";

/** Ids are cuids; anything longer did not come from this app. */
const VenueIdSchema = z.string().min(1).max(64);

/**
 * What the venue form submits: every field the manager edits, as a string (or a
 * boolean) straight from the DOM. The ranges below mirror the form's own
 * `maxLength`s — and the database columns stay well above both, so a value that
 * passes here can never be truncated on the way in.
 */
type VenueInput = {
  name: string;
  address: string;
  description: string;
  mapUrl: string;
  isActive: boolean;
};

/**
 * The three human strings go through `normalizePersianText` — the same rule every
 * other human-entered string in this app follows (Persian ی/ک, collapsed
 * whitespace, trimmed) — while the URL does **not**: `mapUrl` is a Latin address,
 * and the Persian normalizer would rewrite its digits and letters.
 */
const VenueNameSchema = z
  .string()
  .transform((value) => normalizePersianText(value))
  .refine((value) => value.length >= 2, { message: "اسم مکان باید حداقل ۲ حرف باشه." })
  .refine((value) => value.length <= 80, { message: "اسم مکان می‌تونه حداکثر ۸۰ حرف باشه." });

const VenueAddressSchema = z
  .string()
  .transform((value) => normalizePersianText(value))
  .refine((value) => value.length >= 5, { message: "آدرس باید حداقل ۵ حرف باشه." })
  .refine((value) => value.length <= 200, { message: "آدرس می‌تونه حداکثر ۲۰۰ حرف باشه." });

const VenueDescriptionSchema = z
  .string()
  .transform((value) => normalizePersianText(value))
  .refine((value) => value.length <= 500, { message: "توضیح می‌تونه حداکثر ۵۰۰ حرف باشه." });

/**
 * `http(s)` only: the field is pasted from Neshan, and a `javascript:` payload in
 * an anchor's `href` is not a map link. Empty stays empty — the venue's address
 * then becomes the search fallback (`src/lib/neshan.ts`).
 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const VenueMapUrlSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length <= 300, { message: "لینک نقشه می‌تونه حداکثر ۳۰۰ حرف باشه." })
  .refine((value) => value.length === 0 || isHttpUrl(value), {
    message: "لینک نقشه باید با http یا https شروع بشه.",
  });

const VenueInputSchema = z.object({
  name: VenueNameSchema,
  address: VenueAddressSchema,
  description: VenueDescriptionSchema,
  mapUrl: VenueMapUrlSchema,
  isActive: z.boolean(),
});

/** The first refusal zod produced — one sentence, the whole answer a toast can carry. */
function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? VENUE_INVALID;
}

/** `""` and `null` are the same fact for an optional column. */
function emptyToNull(value: string): string | null {
  return value.length > 0 ? value : null;
}

/**
 * The paths one venue write changes: the admin list and the venue's own form, plus
 * every surface that prints the venue's name or address — the board, the player's
 * ledger and the session pages (the ledger and the session page read the venue row
 * on every render, so a rename must not sit in a client cache).
 */
function revalidateVenue(venueId: string): void {
  revalidatePath("/admin/venues");
  revalidatePath(`/admin/venues/${venueId}/edit`);
  revalidatePath("/");
  revalidatePath("/my");
  revalidatePath("/sessions/[id]", "page");
}

/** «مکان جدید» — one row in `Venue`. */
export async function createVenue(input: VenueInput): Promise<SaveVenueOutcome> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };
  }

  const parsed = VenueInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID", error: firstIssueMessage(parsed.error) };
  }

  const venue = await prisma.venue.create({
    data: {
      name: parsed.data.name,
      address: parsed.data.address,
      description: emptyToNull(parsed.data.description),
      mapUrl: emptyToNull(parsed.data.mapUrl),
      isActive: parsed.data.isActive,
    },
    select: { id: true },
  });

  revalidateVenue(venue.id);

  return { ok: true, venueId: venue.id };
}

/**
 * «ذخیره» on an existing venue.
 *
 * The id is validated like every other id that arrives from a browser — never
 * trusted — and a venue that no longer exists answers `NOT_FOUND` instead of
 * throwing: the form was open while somebody else's tab changed the row.
 */
export async function updateVenue(id: string, input: VenueInput): Promise<SaveVenueOutcome> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, code: "AUTH", error: ADMIN_REQUIRED };
  }

  const parsedId = VenueIdSchema.safeParse(id);
  if (!parsedId.success) {
    return { ok: false, code: "NOT_FOUND", error: VENUE_NOT_FOUND };
  }

  const parsed = VenueInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID", error: firstIssueMessage(parsed.error) };
  }

  // `updateMany` rather than `update`: a missing row is an expected outcome, not
  // a P2025 to catch, and `count === 0` is the honest `NOT_FOUND`.
  const updated = await prisma.venue.updateMany({
    where: { id: parsedId.data },
    data: {
      name: parsed.data.name,
      address: parsed.data.address,
      description: emptyToNull(parsed.data.description),
      mapUrl: emptyToNull(parsed.data.mapUrl),
      isActive: parsed.data.isActive,
    },
  });

  if (updated.count === 0) {
    return { ok: false, code: "NOT_FOUND", error: VENUE_NOT_FOUND };
  }

  revalidateVenue(parsedId.data);

  return { ok: true, venueId: parsedId.data };
}
