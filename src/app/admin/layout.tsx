import { AdminShell } from "@/components/layout/admin-shell";
import { PhoneGate } from "@/components/profile/phone-gate";
import { RealNameGate } from "@/components/profile/real-name-gate";

/**
 * Layout for the manager's panel.
 *
 * `AdminShell` gives it the panel's own chrome: the header, the section strip
 * (`AdminNav` — every `/admin` section one tap away) and the app's bottom tab
 * bar, so the panel is never a dead end that needs the messenger's BackButton
 * (the owner's rule).
 *
 * The **first-run gates are mounted here too** — the contact number and the
 * immutable real-name pair are the price of admission for every account, the
 * manager's own included, and a deep link into `/admin` must not be the one door
 * that skips them. Both sheets only decide on the client and render `null`
 * otherwise, so this route keeps its prerenderable shell.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminShell>{children}</AdminShell>
      <PhoneGate />
      <RealNameGate />
    </>
  );
}
