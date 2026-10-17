import {
  IconAlertTriangle,
  IconDeviceMobileMessage,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react";

import { Wordmark } from "@/components/brand/wordmark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The gate: everything outside Eitaa renders this instead of the app.
 *
 * Requirements it must keep (PROMPT.md §5.7 / §6.3, EitaaYar panel §13.2):
 *  - **HTTP 200, never a 30x** — the registered destination URL is the site root.
 *  - no `/login`, no OTP, no login by number, no alternative way in;
 *  - a real, branded screen (not an error page) with one clear sentence, a primary
 *    «باز کردن در ایتا» button and a three-step guide.
 *
 * Client-safe on purpose: the bridge (a Client Component) renders it, so the link
 * arrives as a prop rather than being read from the server-only env module.
 *
 * The screen has **two stories**, picked by `error`:
 *  - no error → «بیرون از ایتا»: the person is in a plain browser, so the appLink
 *    button and the three-step guide are the way in;
 *  - an error → the login was **rejected** (a stale `auth_date`, a bad signature,
 *    a server that is not configured). The person is very often *inside* Eitaa
 *    already, where «باز کردن در ایتا» and the guide are nonsense — so the screen
 *    switches to one retry action and keeps the server's own reason visible.
 */
export function OutsideEitaa({
  appLink,
  error,
  devSlot,
}: {
  /** Built by `src/lib/eitaa-link.ts`; `null` when the app is not configured yet. */
  appLink: string | null;
  /** Verification failure from the login action, if any. */
  error?: string | null;
  /** Development-only simulator panel. */
  devSlot?: React.ReactNode;
}) {
  const steps = [
    "ایتا را باز کن.",
    "برنامک سانس‌یار را از پیام یا کارتِ «ثبت‌نام در سانس» باز کن.",
    "سانس را انتخاب کن و ثبت‌نام کن.",
  ];

  const rejected = Boolean(error);

  return (
    <div className="app-viewport app-column flex flex-col items-center justify-center gap-8 py-10 text-center">
      <div className="flex flex-col items-center gap-4">
        <span
          className={cn(
            "flex size-16 items-center justify-center rounded-2xl",
            rejected ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand-ink",
          )}
        >
          {rejected ? (
            <IconAlertTriangle aria-hidden="true" className="size-8" stroke={1.75} />
          ) : (
            <IconDeviceMobileMessage aria-hidden="true" className="size-8" stroke={1.75} />
          )}
        </span>
        <Wordmark size="lg" />
        <p className="text-body-lg text-ink">
          {rejected ? "ورودت تأیید نشد." : "سانس‌یار فقط داخل ایتا باز می‌شه."}
        </p>
        <p className="max-w-md text-caption text-ink-muted">
          {rejected
            ? "یک‌بار دیگه امتحان کن؛ اگر باز هم همین شد، ایتا را ببند و از نو باز کن."
            : "برای دیدن سانس‌ها و ثبت‌نام، برنامک سانس‌یار را از داخل ایتا باز کن. این‌جا شماره تلفن و رمز لازم نیست؛ حساب تو همان حساب ایتاست."}
        </p>
      </div>

      {rejected ? (
        <>
          <Alert variant="destructive" className="max-w-md text-start">
            <AlertDescription>{error}</AlertDescription>
          </Alert>

          <Button size="lg" onClick={() => window.location.reload()}>
            <IconRefresh aria-hidden="true" />
            دوباره امتحان کن
          </Button>
        </>
      ) : (
        <>
          {appLink ? (
            <Button asChild size="lg">
              <a href={appLink} rel="noreferrer">
                <IconExternalLink aria-hidden="true" />
                باز کردن در ایتا
              </a>
            </Button>
          ) : (
            <p className="max-w-md text-caption text-ink-muted">
              نشانی برنامک آماده نیست — از همون پیام یا کارت داخل ایتا بازش کن.
            </p>
          )}

          <Card className="w-full max-w-md text-start">
            <CardHeader>
              <CardTitle className="text-h3">چطور بازش کنم؟</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3">
                {steps.map((step, index) => (
                  <li key={step} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-sunken text-caption font-[650] text-ink"
                    >
                      {["۱", "۲", "۳"][index]}
                    </span>
                    <span className="text-body text-ink">{step}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </>
      )}

      {devSlot}
    </div>
  );
}
