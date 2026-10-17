/**
 * The player's **own wallet** — «موجودی من» on `/profile` (the balance round).
 *
 * One read, one shape: the number and one database page of its ledger. The rules
 * mirror `src/server/admin-users.ts` on purpose, because the manager and the
 * player read the same rows:
 *
 *  - **it pages in the database** — `?balancePage=`, newest first, with the
 *    total travelling, exactly like every other list that can grow;
 *  - **the count decides the clamp** — a stale page number lands on the last real
 *    page instead of an empty screen that looks broken;
 *  - **it only ever reads the signed-in account's rows** — the id comes from the
 *    page's own verified session, never from a URL.
 */

import "server-only";

import type { BalanceLedgerRow } from "@/lib/balance";
import { prisma } from "@/lib/db";
import { clampPage, pageRange } from "@/lib/pagination";

/** What `/profile` renders under the balance: the number and its story. */
export type MyBalance = {
  /** The account's wallet, in Toman — never negative. */
  balance: number;
  /** One page of movements, newest first. */
  entries: BalanceLedgerRow[];
  /** How many movements the ledger holds in total (the captions read it). */
  total: number;
  /** The page that was actually read — already clamped. */
  page: number;
};

/**
 * The account's balance and one page of its ledger.
 *
 * The count and the column go out together; the page of rows follows, because
 * the clamp needs the count first. A fresh account reads back zero rows and
 * `balance: 0` — the empty state is the honest answer, not a special case.
 */
export async function getMyBalance(userId: string, page = 1): Promise<MyBalance> {
  const [user, total] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { balance: true } }),
    prisma.balanceEntry.count({ where: { userId } }),
  ]);

  const clamped = clampPage(page, total);
  const rows = await prisma.balanceEntry.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...pageRange(clamped),
    select: {
      id: true,
      amount: true,
      balanceAfter: true,
      type: true,
      note: true,
      createdAt: true,
      sessionId: true,
      // The session's name is what makes a row readable («ثبت‌نام …» / «برگشت از …»).
      session: { select: { title: true } },
      byAdmin: { select: { name: true } },
    },
  });

  return {
    balance: user?.balance ?? 0,
    entries: rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      type: row.type,
      note: row.note,
      createdAt: row.createdAt,
      sessionId: row.sessionId,
      sessionTitle: row.session?.title ?? null,
      byAdminName: row.byAdmin?.name ?? null,
    })),
    total,
    page: clamped,
  };
}

/**
 * Just the number — for a chip that shows the wallet without its history
 * (the register hint reads it inside `getSessionDetail`; this is the same fact
 * for any screen that only needs one line).
 */
export async function getMyBalanceAmount(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { balance: true } });
  return user?.balance ?? 0;
}
