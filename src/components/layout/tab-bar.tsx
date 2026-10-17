"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

import { useEitaaRuntime } from "@/components/eitaa/runtime-context";

import { isTabActive, TABS } from "./nav";
import { TAB_ICONS } from "./app-header";

/**
 * The fixed bottom tab bar — the Android-style primary navigation.
 *
 * 3 destinations for players, 4 for the manager (`adminOnly`). Active state is
 * amber icon + ink label + a 2px `--brand-mark` marker: never the fill yellow,
 * which is only 1.85:1 on white and would be invisible to low-vision users.
 *
 * Safe-area aware. The admin tab appears from the Eitaa bridge context (the role
 * of the verified session) rather than from a server read in the layout, so no
 * route has to give up its static shell.
 */
export function TabBar({ isAdmin }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const { user } = useEitaaRuntime();
  const showAdmin = isAdmin ?? user?.role === "ADMIN";
  const tabs = TABS.filter((tab) => !tab.adminOnly || showAdmin);

  return (
    <nav
      data-chrome
      aria-label="منوی اصلی"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface"
      style={{
        paddingBottom: "var(--safe-area-bottom)",
        boxShadow: "var(--elevation-bar)",
      }}
    >
      <ul
        className="mx-auto flex w-full items-stretch"
        style={{ maxWidth: "var(--content-max)" }}
      >
        {tabs.map((tab) => {
          const active = isTabActive(tab, pathname);
          const TabIcon = TAB_ICONS[tab.key];

          return (
            <li key={tab.key} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-1 transition-colors",
                  active ? "text-ink" : "text-ink-muted",
                )}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-brand-mark"
                  />
                ) : null}
                <TabIcon
                  aria-hidden="true"
                  className={cn("size-6", active && "text-brand-ink")}
                  stroke={1.75}
                />
                <span className="text-caption">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
