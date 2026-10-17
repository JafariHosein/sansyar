import { Suspense } from "react";

import { notFound } from "next/navigation";
import { connection } from "next/server";

import { IconShieldLock } from "@tabler/icons-react";

import { VenueForm } from "@/components/admin/venue-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { getVenue } from "@/server/admin-venues";

export const metadata = { title: "ویرایش مکان" };

/**
 * The one admin route that renders per request instead of shipping a prerendered
 * shell — the same reason as `/sessions/[id]`: the shared chrome reads
 * `usePathname()` and a dynamic segment has no pathname while a shell is
 * prerendered (`CLIENT_HOOK_DYNAMIC`). Next's documented remedy is this opt-out;
 * the data below stays behind `<Suspense>` + `await connection()` regardless.
 */
export const instant = false;

/**
 * «ویرایش مکان» — the same venue form, prefilled (PROMPT.md §۶.۴).
 *
 * The route is dynamic, so the page receives the id as a promise and hands it to
 * the request-time child **after** the Suspense boundary. A venue that vanished
 * between opening the list and tapping «ویرایش» renders the segment's own
 * `not-found.tsx` («این مکان پیدا نشد») instead of an empty form that would
 * create a second venue on save.
 */
export default function EditVenuePage(props: PageProps<"/admin/venues/[id]/edit">) {
  return (
    <Suspense fallback={<VenueFormSkeleton />}>
      <EditVenueScreen params={props.params} />
    </Suspense>
  );
}

async function EditVenueScreen({
  params,
}: {
  params: PageProps<"/admin/venues/[id]/edit">["params"];
}) {
  await connection();

  const { id } = await params;
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

  const venue = await getVenue(id);
  if (!venue) notFound();

  return (
    <section aria-labelledby="edit-venue-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="edit-venue-heading" className="text-h2 text-ink">
          ویرایش مکان
        </h2>
        <p className="text-body text-ink-muted">
          اسم، آدرس و لینک نقشه‌ی «{venue.name}» رو از همین‌جا عوض کن.
        </p>
      </div>

      <VenueForm
        venueId={venue.id}
        initial={{
          name: venue.name,
          address: venue.address,
          description: venue.description ?? "",
          mapUrl: venue.mapUrl ?? "",
          isActive: venue.isActive,
        }}
      />
    </section>
  );
}

/** Four field blocks and the submit pair — the form's own rhythm. */
function VenueFormSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <span className="sr-only">در حال بارگذاری فرم مکان</span>

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
