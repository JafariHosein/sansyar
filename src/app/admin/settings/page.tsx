import { Suspense } from "react";

import { connection } from "next/server";

import { IconShieldLock } from "@tabler/icons-react";

import { SettingsForm } from "@/components/admin/settings-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { getDefaultCancelRules } from "@/server/sessions/queries";

export const metadata = { title: "تنظیمات" };

/**
 * «تنظیمات» — the manager's **default cancel rules** (PROMPT.md §۶.۴ و §۵.۴).
 *
 * One row (`Setting.id = 1`) governs every session that does not override it: the
 * free-cancel window, the late-cancel penalty and its first-time warning, the
 * no-show penalty and the late-strike rule. The form below states each rule in
 * the manager's words and previews the exact paragraph players read on a session
 * page.
 *
 * Shape (Cache Components, `AGENTS.md`): the lead sentence is static chrome; the
 * cookie, the role and the stored rules stream in behind one `<Suspense>` whose
 * fallback keeps the form's rhythm (`getDefaultCancelRules` reads the database, so
 * it cannot run in the prerender).
 */
export default function AdminSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-ink-muted">
        این‌ها قوانین پیش‌فرضن؛ هر سانس می‌تونه برای خودش بازنویسی‌شون کنه.
      </p>

      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsSection />
      </Suspense>
    </div>
  );
}

/** Request-time work: the viewer's role, then the stored rules. */
async function SettingsSection() {
  await connection();

  const viewer = await getCurrentUser();
  if (!viewer) return <SettingsSkeleton />;

  if (viewer.role !== "ADMIN") {
    return (
      <Alert variant="destructive">
        <IconShieldLock aria-hidden="true" />
        <AlertTitle>این بخش برای مدیر سالن است</AlertTitle>
        <AlertDescription>حساب تو بازیکنه، پس پنل مدیریت برات باز نمی‌شه.</AlertDescription>
      </Alert>
    );
  }

  const rules = await getDefaultCancelRules();

  return <SettingsForm initialRules={rules} />;
}

/** Same rhythm as the real form: three rule cards, the preview card, the button. */
function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <span className="sr-only">در حال بارگذاری تنظیمات</span>

      <div className="flex flex-col gap-6" aria-hidden="true">
        {[0, 1, 2].map((group) => (
          <div key={group} className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card">
            <Skeleton className="h-6 w-24" />
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            ))}
          </div>
        ))}

        <div className="flex flex-col gap-2 rounded-xl bg-surface p-4 shadow-card">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-3.5 w-56" />
        </div>

        <Skeleton className="h-13 w-full" />
      </div>
    </div>
  );
}
