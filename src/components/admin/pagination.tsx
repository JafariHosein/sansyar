import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { formatCount, toPersianDigits } from "@/lib/format";
import { PAGE_SIZE, pageCount } from "@/lib/pagination";

/**
 * The shared pager for every list that can grow (`src/lib/pagination.ts`).
 *
 * A plain Server Component on purpose: the page number lives in the URL, so the
 * links *are* the state and nothing here needs client JS — a list that can hold
 * hundreds of rows must not pay for a hydrated pager as well.
 *
 * RTL reading order: «قبلی» on the right (pointer right), «بعدی» on the left.
 */
export function Pagination({
  page,
  total,
  basePath,
  query = {},
  itemLabel,
  pageSize = PAGE_SIZE,
  pageParam = "page",
}: {
  /** The current 1-based page (already clamped by the caller). */
  page: number;
  /** Total rows across all pages. */
  total: number;
  /** e.g. `/admin/sessions` — where the page links point. */
  basePath: string;
  /** The rest of the URL state (filters, search) that must survive paging. */
  query?: Record<string, string | undefined>;
  /** What one row is called: «سانس» · «کاربر» · «ثبت‌نام». */
  itemLabel: string;
  pageSize?: number;
  /**
   * The query key the page number rides in. Defaults to `page`; a screen that
   * carries a second pager (the balance ledger beside a list of registrations)
   * gives its own key so the two never overwrite each other.
   */
  pageParam?: string;
}) {
  const totalPages = pageCount(total, pageSize);
  // One page is no choice at all: no pager, and a caption would be noise.
  if (totalPages <= 1) return null;

  const href = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, value);
    }
    // Page 1 is the bare URL: the plain list is the canonical link.
    if (target > 1) params.set(pageParam, String(target));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav aria-label="صفحه‌بندی" className="flex items-center justify-between gap-3 pt-1">
      {page > 1 ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(page - 1)} rel="prev">
            <IconChevronRight aria-hidden="true" />
            قبلی
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          <IconChevronRight aria-hidden="true" />
          قبلی
        </Button>
      )}

      <p className="text-center text-caption text-ink-muted">
        {toPersianDigits(from)} تا {toPersianDigits(to)} از {formatCount(total, itemLabel)}
        <span className="block">
          صفحه‌ی {toPersianDigits(page)} از {toPersianDigits(totalPages)}
        </span>
      </p>

      {page < totalPages ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(page + 1)} rel="next">
            بعدی
            <IconChevronLeft aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          بعدی
          <IconChevronLeft aria-hidden="true" />
        </Button>
      )}
    </nav>
  );
}
