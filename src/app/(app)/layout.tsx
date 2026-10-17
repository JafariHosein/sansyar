import { MembershipGate } from "@/components/eitaa/membership-gate";
import { AppShell } from "@/components/layout/app-shell";
import { PhoneGate } from "@/components/profile/phone-gate";
import { RealNameGate } from "@/components/profile/real-name-gate";

/**
 * Layout for player/manager surfaces: adds the app chrome around a screen.
 * The gate overlay and the admin sidebar live outside this group, so they get
 * their own layout without the bottom tab bar.
 *
 * `isAdmin` is deliberately NOT passed: the tab bar reads the verified role from
 * the Eitaa bridge context instead, so this group keeps its static shell
 * (PROMPT.md §6.3).
 *
 * Three blocking overlays are mounted here rather than in the root layout,
 * because each only makes sense over the app itself — and each renders itself
 * only on the client, from the verified session, so this shell stays
 * prerenderable. They are siblings in one deliberate order: the phone sheet, then
 * the real-name sheet (it waits for the number), then the **membership gate**
 * (waiting for the manager's approval — it waits for both answers, because the
 * manager decides about a person they can see: a name and a number). None of them
 * knows which one is up; each reads the markers the one before it writes.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      {children}
      <PhoneGate />
      <RealNameGate />
      <MembershipGate />
    </AppShell>
  );
}
