import { AppHeader } from "./app-header";
import { TabBar } from "./tab-bar";

/**
 * The app chrome shared by every player/manager screen: sticky header → scrolling
 * content → fixed bottom tab bar (DESIGN_SYSTEM.md §5).
 *
 * The document body scrolls (no inner scroll container) so the sticky header and
 * the WebView's own gesture handling behave like a native app.
 */
export function AppShell({
  children,
  isAdmin,
}: {
  children: React.ReactNode;
  /**
   * Server-rendered admin flag. Leave it `undefined` (the default) in the app
   * group: the tab bar then takes the role from the Eitaa bridge context, which
   * keeps every route in this group a static shell (`◐ Partial Prerender`).
   * Passing `false` here would *win* over the context and hide the manager tab.
   */
  isAdmin?: boolean;
}) {
  return (
    <>
      <AppHeader />
      <main id="main" className="app-column pt-6 pb-tabbar">
        {children}
      </main>
      <TabBar isAdmin={isAdmin} />
    </>
  );
}
