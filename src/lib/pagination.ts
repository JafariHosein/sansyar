/**
 * Server-side pagination — one small contract for every list that can grow.
 *
 * The owner's rule: a screen must never render an unbounded history («۲۰۰ سانس
 * که همه با هم بیان» lengthens the page and slows it down). Every such list
 * therefore pages in the database — `skip`/`take` — and renders the shared
 * `Pagination` pager, so 20 rows and 20 000 rows cost the same HTML.
 *
 * Deliberately pure and dependency-free: the pages (server) parse `?page=`, the
 * queries take `{ skip, take }`, and nothing here touches Prisma or React.
 */

/** Rows per page. One number for every list, so the app has one page size. */
export const PAGE_SIZE = 20;

/**
 * `?page=` → a whole number ≥ 1. Anything unreadable (a typo in a shared link, a
 * repeated parameter) is page 1 — never an error, never an empty screen.
 */
export function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

/** The Prisma window for one page — clamped so a stale link can't ask for page −۳. */
export function pageRange(page: number, size = PAGE_SIZE): { skip: number; take: number } {
  const safe = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  return { skip: (safe - 1) * size, take: size };
}

/** How many pages `total` rows make. Always ≥ 1: an empty list is «صفحهی ۱ از ۱». */
export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(total, 0) / size));
}

/**
 * Pull a page number back inside the real list: a link to page ۹ after the rows
 * shrank (a filter narrowed, seats were canceled) lands on the last real page,
 * not on an empty screen that looks broken.
 */
export function clampPage(page: number, total: number, size = PAGE_SIZE): number {
  return Math.min(Math.max(page, 1), pageCount(total, size));
}
