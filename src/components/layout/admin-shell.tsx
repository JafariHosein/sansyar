import { AdminNav } from "./admin-nav";
import { AppHeader } from "./app-header";
import { TabBar } from "./tab-bar";

/**
 * The manager panel's chrome: sticky header → section strip → scrolling content
 * → **the same bottom tab bar as the rest of the app**.
 *
 * That last part is the owner's rule: tapping «مدیریت» used to hide the tab bar
 * (the panel sits outside the `(app)` group) and the only way back was the
 * messenger's BackButton. Now the panel keeps its own section strip *and* the
 * tab bar, so no screen in the app is a dead end.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <AdminNav />
      <main id="main" className="app-column pt-6 pb-tabbar">
        {children}
      </main>
      <TabBar />
    </>
  );
}
