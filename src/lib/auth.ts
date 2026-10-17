/**
 * Session handling: identity comes from Eitaa `initData` only.
 *
 * There is no password, no OTP and no `/login` — the cookie is simply a signed
 * pointer to the `User` row that a verified `initData` created. The role is
 * decided by `ADMIN_EITAA_ID` at read time as well, so adding your own Eitaa id
 * to the env and restarting is enough to become an admin (PROMPT.md §13.2).
 */

import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

import { prisma } from "@/lib/db";
import { getSessionSecret, isAdminEitaaId, IS_PRODUCTION } from "@/lib/env";

const COOKIE_NAME = "sansyar_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type UserRole = "USER" | "ADMIN";

export type SessionUser = {
  id: string;
  eitaaId: string;
  /** The display name: the Eitaa name, or the player's own «تغییر نام». */
  name: string;
  role: UserRole;
  /**
   * The contact number (`09XXXXXXXXX`), or `null` until the player answers the
   * first-run sheet. Not an auth factor — Eitaa `initData` remains the only way
   * in; this is a detail the manager may need to reach the player on.
   */
  phone: string | null;
  /**
   * The real name pair, asked in the same first-run sheet and immutable after it
   * (a change is the manager's call). `null` until answered — the two columns are
   * deliberately separate from `name`, which is only a display name.
   */
  firstName: string | null;
  lastName: string | null;
  /**
   * The account-level approval (the membership gate). Read straight from the row
   * — the login never changes it, and an admin is approved by construction
   * (login/seed), so no forcing happens here either. `APPROVED` is the only
   * status that lets the client render the app instead of the waiting screen.
   */
  membershipStatus: "PENDING" | "APPROVED" | "REJECTED";
};

/** Thrown by `requireUser`/`requireAdmin`; server actions translate it to Persian. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Sign the session cookie for a `User.id`. */
export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSessionSecret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Drop the session cookie (used by the dev simulator only — the product has no logout). */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * The signed-in user, or `null`.
 *
 * Request-scoped memoized: a page can ask several times (header, tab bar, a card)
 * without repeating the cookie read and the database round-trip.
 *
 * Reads a cookie and the database, so **every caller must sit inside `<Suspense>`**
 * (Cache Components rule) — see the pattern in `src/app/(app)/page.tsx`.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    userId = typeof payload["uid"] === "string" ? payload["uid"] : "";
  } catch {
    // Expired, tampered with, or signed with an older secret.
    return null;
  }
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      eitaaId: true,
      name: true,
      role: true,
      phone: true,
      firstName: true,
      lastName: true,
      membershipStatus: true,
    },
  });
  if (!user) return null;

  return {
    ...user,
    role: user.role === "ADMIN" || isAdminEitaaId(user.eitaaId) ? "ADMIN" : "USER",
  };
});

/** For server actions: throws instead of returning `null`. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("برای این کار باید سانس‌یار را از داخل ایتا باز کنی.");
  return user;
}

/** For admin actions: `requireUser` plus the role check (never trust the client). */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new AuthError("این بخش فقط برای مدیر سالنه.");
  return user;
}
