"use client";

import { useEffect, useRef } from "react";

import {
  IconAdjustmentsHorizontal,
  IconBallFootball,
  IconLayoutDashboard,
  IconMapPin,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { ADMIN_SECTIONS, isAdminSectionActive } from "./nav";

/** Icons live in this client component; `nav.ts` stays plain data. */
const SECTION_ICONS: Record<string, Icon> = {
  overview: IconLayoutDashboard,
  sessions: IconBallFootball,
  users: IconUsers,
  venues: IconMapPin,
  settings: IconAdjustmentsHorizontal,
};

/**
 * The manager's own navigation strip — the owner's rule: inside `/admin` every
 * section is **one tap away**, so the panel never forces the messenger's
 * BackButton. `AdminShell` keeps the bottom tab bar visible right underneath, so
 * the way back to the player screens is always on screen too.
 *
 * Sticks under the header while a long list scrolls. The active pill uses the
 * fill yellow with **ink** text (the brand rule: yellow never carries white) —
 * the in-button language, so a section reads as a pressed control, not a badge.
 *
 * The five pills together are wider than a 375px screen, and the strip stays one
 * row: the active pill is scrolled to the middle whenever the pathname changes,
 * so landing on a section never starts with its marker off-screen.
 */
export function AdminNav() {
  const pathname = usePathname();
  /** The active pill — the effect below keeps it on screen. */
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  // `block: "nearest"` so only the strip moves, never the page; `behavior:
  // "instant"` because this is how the strip should *look*, not a scroll to
  // watch. One effect keyed on the pathname covers both a fresh load and a
  // client-side navigation between sections.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "instant" });
  }, [pathname]);

  return (
    <nav
      data-chrome
      aria-label="بخش‌های مدیریت"
      className="sticky z-20 border-b border-line bg-surface"
      style={{ top: "calc(3.5rem + var(--safe-area-top))" }}
    >
      <ul className="app-column flex items-center gap-1 overflow-x-auto overflow-y-hidden py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ADMIN_SECTIONS.map((section) => {
          const active = isAdminSectionActive(section, pathname);
          const SectionIcon = SECTION_ICONS[section.key];

          return (
            <li key={section.key}>
              <Link
                ref={active ? activeRef : undefined}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-brand text-ink"
                    : "text-ink-muted hover:bg-sunken hover:text-ink",
                )}
              >
                <SectionIcon aria-hidden="true" className="size-4" stroke={1.75} />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
