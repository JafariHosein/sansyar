/**
 * The app's route model — one source of truth for the tab bar, the header title
 * and (later) the Eitaa BackButton, so navigation can never drift apart between
 * the three.
 *
 * Plain data only (no icon components): both a Server Component and a Client
 * Component read this file, and icon components cannot cross that boundary.
 */

export type TabKey = "sessions" | "my" | "profile" | "admin";

export type Tab = {
  key: TabKey;
  href: string;
  label: string;
  /** The manager gets a fourth destination (DESIGN_SYSTEM.md §6). */
  adminOnly?: boolean;
};

export const TABS: readonly Tab[] = [
  { key: "sessions", href: "/", label: "سانس‌ها" },
  { key: "my", href: "/my", label: "ثبت‌نام‌های من" },
  { key: "profile", href: "/profile", label: "پروفایل" },
  { key: "admin", href: "/admin", label: "مدیریت", adminOnly: true },
] as const;

/** Pages with their own header title. The root shows the wordmark instead. */
const TITLES: Record<string, string> = {
  "/my": "ثبت‌نام‌های من",
  "/profile": "پروفایل",
  // The rulebook — a player screen, not a tab: reachable from the profile and
  // from the rules card on a session page (so its own title, no tab-bar item).
  "/rules": "قوانین",
  "/admin": "مدیریت سالن",
  // The admin sections own the `h1` of every page beneath them, sub-pages
  // included (see `titleForPath`) — so no admin screen has to invent a title.
  "/admin/sessions": "سانس‌ها",
  "/admin/users": "کاربران",
  "/admin/venues": "مکان‌ها",
  "/admin/settings": "تنظیمات",
};

/**
 * The header title for a pathname.
 *
 * Returns `null` for the root route — there the header shows the brand wordmark
 * and the home screen supplies its own `h1` — and for any nested route whose
 * subtree is not registered above (e.g. `/sessions/abc`), whose screen supplies
 * its own title, so exactly one `h1` exists per screen (DESIGN_SYSTEM.md §11).
 *
 * A nested route *inside a registered subtree* (`/admin/sessions/<id>`) walks up
 * to the nearest registered ancestor: the section owns the title, and its pages
 * lead with their own sub-headings.
 */
export function titleForPath(pathname: string): string | null {
  let path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  while (path.length > 0) {
    const title = TITLES[path];
    if (title) return title;
    if (path === "/" || !path.includes("/")) return null;
    path = path.slice(0, path.lastIndexOf("/")) || "/";
  }

  return null;
}

// ---------------------------------------------------------------------------
// The manager's panel — its own section model (the owner's rule)
// ---------------------------------------------------------------------------

export type AdminSectionKey = "overview" | "sessions" | "users" | "venues" | "settings";

export type AdminSection = {
  key: AdminSectionKey;
  href: string;
  label: string;
};

/**
 * `/admin`'s own navigation, in one place like `TABS`: the manager must be able
 * to reach every section **without the messenger's BackButton** (the owner's
 * rule) — the strip is rendered by `AdminNav`, and `AdminShell` keeps the bottom
 * tab bar visible underneath it as the way back to the player screens.
 */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { key: "overview", href: "/admin", label: "داشبورد" },
  { key: "sessions", href: "/admin/sessions", label: "سانس‌ها" },
  { key: "users", href: "/admin/users", label: "کاربران" },
  { key: "venues", href: "/admin/venues", label: "مکان‌ها" },
  { key: "settings", href: "/admin/settings", label: "تنظیمات" },
] as const;

/** Whether a section is the active destination (its subtree counts as active). */
export function isAdminSectionActive(section: AdminSection, pathname: string): boolean {
  if (section.href === "/admin") return pathname === "/admin" || pathname === "/admin/";
  return pathname === section.href || pathname.startsWith(`${section.href}/`);
}

/** Whether a tab is the active destination (its subtree counts as active). */
export function isTabActive(tab: Tab, pathname: string): boolean {
  if (tab.href === "/") return pathname === "/";
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

/**
 * True when the pathname is one of the tab roots. The Eitaa BackButton is hidden
 * on roots (the messenger closes the mini app) and shown on every deeper route.
 */
export function isTabRoot(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return TABS.some((tab) => tab.href === normalized);
}
