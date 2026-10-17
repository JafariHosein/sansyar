"use client";

import {
  IconAdjustmentsHorizontal,
  IconBallFootball,
  IconClipboardList,
  IconUser,
  type Icon,
} from "@tabler/icons-react";
import { usePathname } from "next/navigation";

import { Wordmark } from "@/components/brand/wordmark";

import { titleForPath } from "./nav";

/** Icons live here (client) rather than in `nav.ts`, which stays plain data. */
export const TAB_ICONS: Record<string, Icon> = {
  sessions: IconBallFootball,
  my: IconClipboardList,
  profile: IconUser,
  admin: IconAdjustmentsHorizontal,
};

/**
 * Sticky app header. It renders the `h1` on tab roots — except `/`, which shows
 * the wordmark so the home screen can own its own `h1`. `--safe-area-top` keeps
 * it clear of the messenger's status bar.
 */
export function AppHeader({
  title,
  actions,
}: {
  /** Overrides the pathname-derived title (used by nested screens). */
  title?: string | null;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const resolvedTitle = title === undefined ? titleForPath(pathname) : title;

  return (
    <header
      data-chrome
      className="sticky top-0 z-30 border-b border-line bg-surface"
      style={{ paddingTop: "var(--safe-area-top)" }}
    >
      <div className="app-column flex h-14 items-center justify-between gap-3">
        {resolvedTitle ? (
          <h1 className="truncate text-h1 text-ink">{resolvedTitle}</h1>
        ) : (
          <Wordmark />
        )}
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </div>
    </header>
  );
}
