/**
 * The login core, shared by the real Eitaa path and the dev simulator so both
 * go through exactly the same upsert and cookie code.
 *
 * Not a `"use server"` module: it is server-only plumbing, and a `"use server"`
 * file may only export async actions.
 */

import "server-only";

import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAdminEitaaId } from "@/lib/env";
import { eitaaDisplayName, type VerifiedEitaaInitData } from "@/lib/eitaa-signature";
import type { SessionUserPayload } from "@/server/actions/results";

/** Used when Eitaa gives us no name at all. */
const FALLBACK_NAME = "بازیکن ایتا";

/**
 * Names **we** wrote when we knew nothing better — the seed's defaults. They are
 * placeholders, not identities: a real login replaces them with the Eitaa name.
 * A name the person typed themselves is in no set here and is never touched.
 */
const PLACEHOLDER_NAMES = new Set([FALLBACK_NAME, "مدیر سانس", "مدیر سالن"]);

type UserRow = {
  id: string;
  eitaaId: string;
  name: string;
  role: "USER" | "ADMIN";
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  membershipStatus: "PENDING" | "APPROVED" | "REJECTED";
};

/** Prisma unique-constraint violation, checked without depending on error classes. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

async function upsertUser(eitaaId: string, name: string, role: UserRow["role"]): Promise<UserRow> {
  const select = {
    id: true,
    eitaaId: true,
    name: true,
    role: true,
    phone: true,
    firstName: true,
    lastName: true,
    membershipStatus: true,
  } as const;

  const existing = await prisma.user.findUnique({ where: { eitaaId }, select });
  if (existing) {
    // The role is **promoted, never demoted**: an id in `ADMIN_EITAA_ID` becomes
    // ADMIN on every login, but a row that is already ADMIN (the seeded demo
    // manager, a future panel's grant) survives a login from an id the env does
    // not list — otherwise the demo manager loses its key the first time it logs
    // in. Revoking is a deliberate DB write, not a login side effect.
    //
    // The **membership gate** follows the exact same rule, in both directions:
    // a login never approves a waiting account (only the manager does) and never
    // takes a decision back — with one exception, the admin above, who is
    // approved on sight because the manager must not sit behind their own gate.
    //
    // The name is kept **unless it is one of our placeholders**: `ADMIN_EITAA_ID`
    // holds a real person's id, so a row the seed created as «مدیر سانس» must not
    // wear that label forever — the first real login swaps in the Eitaa name. A
    // name the person edited never matches the set, so it is never overwritten.
    const data: { role?: "ADMIN"; name?: string; membershipStatus?: "APPROVED" } = {};
    if (role === "ADMIN" && existing.role !== "ADMIN") data.role = "ADMIN";
    if ((role === "ADMIN" || existing.role === "ADMIN") && existing.membershipStatus !== "APPROVED") {
      data.membershipStatus = "APPROVED";
    }
    if (name !== FALLBACK_NAME && PLACEHOLDER_NAMES.has(existing.name) && existing.name !== name) {
      data.name = name;
    }
    if (!data.role && !data.name && !data.membershipStatus) return existing;
    return prisma.user.update({ where: { id: existing.id }, data, select });
  }

  try {
    return await prisma.user.create({
      data: {
        eitaaId,
        name,
        role,
        // A fresh account waits for the manager — unless the env makes it an
        // admin, who is approved on sight.
        membershipStatus: role === "ADMIN" ? "APPROVED" : "PENDING",
      },
      select,
    });
  } catch (error) {
    // Two preloads at once (or a dev hot reload) can race the unique index.
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.user.findUnique({ where: { eitaaId }, select });
    if (!raced) throw error;
    return raced;
  }
}

/**
 * Turn a verified `initData` into a session. Idempotent — the bridge calls it on
 * every app open, which is what Eitaa's developer rules require (preload login).
 *
 * The payload carries the whole first-run picture — the contact number, the
 * real name pair (asked once and immutable) and the **membership status** (the
 * gate: `APPROVED` renders the app, the other two render the waiting screen) —
 * so the client can decide without a second round trip. It is always the
 * viewer's *own* row.
 */
export async function completeLogin(verified: VerifiedEitaaInitData): Promise<SessionUserPayload> {
  const eitaaId = verified.user.id;
  const name = eitaaDisplayName(verified.user) || FALLBACK_NAME;
  const role: UserRow["role"] = isAdminEitaaId(eitaaId) ? "ADMIN" : "USER";

  const user = await upsertUser(eitaaId, name, role);
  await createSession(user.id);

  return {
    name: user.name,
    role: user.role,
    eitaaId: user.eitaaId,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    membershipStatus: user.membershipStatus,
  };
}
