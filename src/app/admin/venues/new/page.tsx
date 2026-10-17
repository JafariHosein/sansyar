import { Suspense } from "react";

import { connection } from "next/server";

import { IconShieldLock } from "@tabler/icons-react";

import { VenueForm } from "@/components/admin/venue-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "مکان جدید" };

/**
 * «مکان جدید» — the empty venue form (PROMPT.md §۶.۴).
 *
 * The heading and the lead sentence are static chrome; only the role check and
 * the form wait behind `<Suspense>`, so the page paints immediately and a player
 * who typed the URL gets the same «این بخش برای مدیر سالن است» answer as every
 * other admin screen (the action re-checks too — the proxy is never the guard).
 *
 * The form itself is one client component shared with the edit page: without a
 * `venueId` it creates the row and navigates back to the list on success.
 */
export default function NewVenuePage() {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="new-venue-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="new-venue-heading" className="text-h2 text-ink">
            مکان جدید
          </h2>
          <p className="text-body text-ink-muted">
            اسم و آدرس سالن رو بنویس؛ بعد از ذخیره می‌تونی برای همین مکان سانس بسازی.
          </p>
        </div>

        <Suspense fallback={<VenueFormSkeleton />}>
          <NewVenueForm />
        </Suspense>
      </section>
    </div>
  );
}

/** Request-time work: the viewer's role, then the form. */
async function NewVenueForm() {
  await connection();

  const viewer = await getCurrentUser();
  if (!viewer) return <VenueFormSkeleton />;

  if (viewer.role !== "ADMIN") {
    return (
      <Alert variant="destructive">
        <IconShieldLock aria-hidden="true" />
        <AlertTitle>این بخش برای مدیر سالن است</AlertTitle>
        <AlertDescription>حساب تو بازیکنه، پس پنل مدیریت برات باز نمی‌شه.</AlertDescription>
      </Alert>
    );
  }

  return <VenueForm />;
}

/** Four field blocks and the submit pair — the form's own rhythm. */
function VenueFormSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <span className="sr-only">در حال آماده‌سازی فرم مکان</span>

      <div className="flex flex-col gap-5" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-13 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}
