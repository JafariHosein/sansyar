import { Suspense } from "react";

import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { IconCalendarOff, IconCopy, IconShieldLock } from "@tabler/icons-react";

import { SessionForm } from "@/components/admin/session-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import {
  getAdminSessionStatus,
  getSessionFormValues,
  listVenueChoices,
} from "@/server/admin-sessions";
import { getDefaultCancelRules } from "@/server/sessions/queries";

export const metadata = { title: "ویرایش سانس" };

/**
 * The one admin route that renders per request instead of shipping a prerendered
 * shell — the same reason as `/sessions/[id]`: the shared chrome reads
 * `usePathname()` and a dynamic segment has no pathname while a shell is
 * prerendered (`CLIENT_HOOK_DYNAMIC`). Next's documented remedy is this opt-out;
 * the data below stays behind `<Suspense>` + `await connection()` regardless.
 */
export const instant = false;

/**
 * «ویرایش سانس» — the same session form, prefilled (PROMPT.md §۶.۴).
 *
 * The route is dynamic, so the page receives the id as a promise and hands it to
 * the request-time child **after** the Suspense boundary. Three answers wait on
 * the other side:
 *
 *  - **missing** — the row vanished between opening the list and tapping
 *    «ویرایش» — renders the segment's `not-found.tsx` («این سانس پیدا نشد»)
 *    instead of an empty form that would create a second session on save;
 *  - **canceled** — a canceled slot takes no more edits (`saveSession` refuses it
 *    with `CLOSED`), so the page says so and points at the one useful door: a
 *    copy of the same slot, a week later, prefilled by `/admin/sessions/new`;
 *  - **editable** — the form, in edit mode, keeping whatever status the row has.
 */
export default function EditSessionPage(props: PageProps<"/admin/sessions/[id]/edit">) {
  return (
    <Suspense fallback={<SessionFormSkeleton />}>
      <EditSessionScreen params={props.params} />
    </Suspense>
  );
}

async function EditSessionScreen({
  params,
}: {
  params: PageProps<"/admin/sessions/[id]/edit">["params"];
}) {
  await connection();

  const { id } = await params;
  const viewer = await getCurrentUser();
  if (!viewer) return <SessionFormSkeleton />;

  if (viewer.role !== "ADMIN") {
    return (
      <Alert variant="destructive">
        <IconShieldLock aria-hidden="true" />
        <AlertTitle>این بخش برای مدیر سالن است</AlertTitle>
        <AlertDescription>حساب تو بازیکنه، پس ویرایش سانس برات باز نمی‌شه.</AlertDescription>
      </Alert>
    );
  }

  // Four reads in one round: the form's values, the row's status (which is what
  // tells a canceled slot apart from a missing one), the Select's choices, and
  // the rules the override fields mirror.
  const [form, status, venues, defaultRules] = await Promise.all([
    getSessionFormValues(id),
    getAdminSessionStatus(id),
    listVenueChoices(),
    getDefaultCancelRules(),
  ]);

  if (status === null) notFound();

  // The row exists and the form did not open: only one situation is left.
  if (form === null) {
    return (
      <section aria-labelledby="edit-session-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="edit-session-heading" className="text-h2 text-ink">
            ویرایش سانس
          </h2>
          <p className="text-body text-ink-muted">این سانس لغو شده و فقط برای تاریخچه می‌مونه.</p>
        </div>

        <Alert variant="destructive">
          <IconCalendarOff aria-hidden="true" />
          <AlertTitle>سانس لغوشده قابل ویرایش نیست</AlertTitle>
          <AlertDescription>
            سانس لغوشده دیگه عوض نمی‌شه؛ اگه می‌خوای دوباره برگزار بشه، از روش یه کپی برای هفته‌ی
            بعد بساز.
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <Link href={`/admin/sessions/new?from=${id}`}>
              <IconCopy aria-hidden="true" />
              کپی برای هفته‌ی بعد
            </Link>
          </Button>

          <Button variant="outline" asChild>
            <Link href={`/admin/sessions/${id}`}>مشاهده‌ی سانس</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="edit-session-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="edit-session-heading" className="text-h2 text-ink">
          ویرایش سانس
        </h2>
        <p className="text-body text-ink-muted">
          {form.values.status === "PUBLISHED"
            ? `«${form.values.title}» منتشر شده؛ تغییرهاش همون لحظه به بازیکن‌ها اعمال می‌شه.`
            : `«${form.values.title}» پیش‌نویس مونده؛ تا منتشرش نکنی کسی نمی‌بینش.`}
        </p>
      </div>

      <SessionForm
        mode="edit"
        sessionId={form.sessionId}
        initialValues={form.values}
        venues={venues}
        defaultRules={defaultRules}
      />
    </section>
  );
}

/** Five field cards and the submit pair — the form's own rhythm. */
function SessionFormSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <span className="sr-only">در حال بارگذاری فرم سانس</span>

      <div className="flex flex-col gap-6" aria-hidden="true">
        {[0, 1, 2].map((card) => (
          <div
            key={card}
            className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card"
          >
            <Skeleton className="h-5 w-24" />

            <div className="flex flex-col gap-5">
              {[0, 1, 2].map((field) => (
                <div key={field} className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-3.5 w-2/3" />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-2 rounded-xl bg-surface p-4 shadow-card">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  );
}
