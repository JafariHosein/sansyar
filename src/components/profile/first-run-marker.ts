"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The "already answered" markers of the two blocking first-run sheets.
 *
 * Why `sessionStorage` and not the database: the bridge's `user` is captured at
 * login and never refreshed, so right after a save the context still says
 * `phone: null` / `firstName: null`. A marker closes the sheet immediately and
 * keeps it closed when the `(app)` layout remounts within the same WebView
 * session (a detour to `/admin` and back). A fresh app open drops it — where the
 * new login payload carries the answers anyway.
 *
 * Why a store instead of plain local state: the two sheets are siblings in the
 * layout and the second one must appear *the moment* the first is answered —
 * without a page reload, and without the bridge learning about it. Each key has
 * its own listener set; `useAnsweredId` subscribes to one of them.
 *
 * It is written **only** after the server confirmed the save.
 */

/** «شماره‌ی همراه» — written by the phone sheet. */
export const PHONE_ANSWERED_KEY = "sansyar.phone.answered";

/** «نام و نام خانوادگی» — written by the real-name sheet. */
export const REAL_NAME_ANSWERED_KEY = "sansyar.realname.answered";

const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, string | null>();

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // Storage disabled (private mode): the sheet may ask again. Never a crash.
    return null;
  }
}

/** One cached value per key, so React's store check sees a stable snapshot. */
function snapshot(key: string): string | null {
  if (!cache.has(key)) cache.set(key, read(key));
  return cache.get(key) ?? null;
}

function subscribe(key: string, onChange: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(onChange);
  listeners.set(key, set);

  return () => {
    set.delete(onChange);
  };
}

/** Which account already answered `key` in this WebView session, or `null`. */
export function useAnsweredId(key: string): string | null {
  const listen = useCallback((onChange: () => void) => subscribe(key, onChange), [key]);

  return useSyncExternalStore(
    listen,
    () => snapshot(key),
    // The server never knows an answer: both sheets render `null` on the server
    // and on the first client pass, which is what keeps `(app)` a static shell.
    () => null,
  );
}

/** Record an answer for `eitaaId` and wake every reader of this key. */
export function rememberAnsweredId(key: string, eitaaId: string): void {
  try {
    window.sessionStorage.setItem(key, eitaaId);
  } catch {
    // The marker still lives in the cache below: the sheet closes for this mount.
  }

  cache.set(key, eitaaId);
  for (const onChange of listeners.get(key) ?? []) onChange();
}
