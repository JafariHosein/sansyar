import { Wordmark } from "@/components/brand/wordmark";
import { Spinner } from "@/components/ui/spinner";

/**
 * The preload splash — Eitaa's developer rules require login to finish *before*
 * the app is shown, and a flash of logged-out content is not acceptable.
 *
 * This is rendered on the server as the initial overlay, so the very first paint
 * is already the splash. The `<noscript>` copy is for the one audience that never
 * runs the bridge: without JavaScript the messenger cannot hand us `initData`, so
 * the same sentence and link as the gate page are spelled out in plain HTML.
 */
export function EitaaSplash({ appLink }: { appLink: string | null }) {
  return (
    <div className="app-viewport app-column flex flex-col items-center justify-center gap-6 text-center">
      <Wordmark size="lg" />

      <p
        role="status"
        className="flex items-center gap-2 text-body text-ink-muted"
      >
        <Spinner aria-hidden="true" />
        در حال ورود…
      </p>

      <noscript>
        <div className="flex flex-col items-center gap-3 rounded-xl bg-surface p-4 shadow-card">
          <p className="text-body-lg text-ink">
            سانس‌یار فقط داخل ایتا باز می‌شه.
          </p>
          {appLink ? (
            <a href={appLink} className="text-button text-brand-ink underline-offset-4 hover:underline">
              باز کردن در ایتا
            </a>
          ) : null}
        </div>
      </noscript>
    </div>
  );
}
