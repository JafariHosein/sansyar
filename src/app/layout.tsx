import type { Metadata, Viewport } from "next";

// Self-hosted Persian font. Importing the package CSS (rather than a CDN or
// `next/font/google`) keeps the build working without access to Google Fonts —
// a hard requirement for an Iran-hosted app.
import "@fontsource-variable/estedad";
import "./globals.css";

import { EitaaRuntime } from "@/components/eitaa/eitaa-runtime";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { eitaaAppLink } from "@/lib/eitaa";
import { EITAA_DEV_LOGIN } from "@/lib/env";

export const metadata: Metadata = {
  title: {
    default: "سانس‌یار — ثبت‌نام سانس سالن فوتسال",
    template: "%s | سانس‌یار",
  },
  description:
    "سانس‌یار: سانس‌های سالن فوتسال را ببین، ظرفیت را چک کن و ثبت‌نام کن — بدون تماس تلفنی.",
  applicationName: "سانس‌یار",
  // Digits on a screen are dates, prices and times, not contact data: never let
  // the WebView auto-link them as tap-to-call. (The manager's explicit `tel:`
  // link in the registrant list is an anchor we build ourselves — untouched by
  // this flag.) No email or address is collected either.
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  // Fixed light brand chrome (see DESIGN_SYSTEM.md §3): the messenger header is
  // painted the same white as our surfaces, and the UA is told to stay light so
  // it never restyles scrollbars/controls for a dark system theme.
  themeColor: "#FFFFFF",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  // `cover` exposes env(safe-area-inset-*) for the notch and gesture bar.
  viewportFit: "cover",
  // The keyboard resizes the viewport instead of overlaying it, which is what
  // makes keyboard-avoidance (DESIGN_SYSTEM.md §5) possible in a WebView.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Static, build-time values: the app link for the gate page and whether the
  // dev-only simulator is available. Neither reads cookies, so every route keeps
  // its prerenderable shell.
  const appLink = eitaaAppLink();

  return (
    <html lang="fa" dir="rtl" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">
        {/* The official Eitaa SDK is loaded by the bridge (`ensureEitaaSdk` in
            `src/components/eitaa/sdk.ts`), NOT with `next/script`:
            `strategy="beforeInteractive"` puts the tag in the RSC tree, so React
            hydration reports "some attributes of the server rendered HTML didn't
            match" and the client tree never takes over — the splash then never
            advances. The bridge injects the same tag directly and waits for it, and
            it stays the only external script in the project. */}

        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-button focus:shadow-pop"
        >
          پرش به محتوا
        </a>
        <TooltipProvider delayDuration={300}>
          <EitaaRuntime appLink={appLink} devEnabled={EITAA_DEV_LOGIN}>
            {children}
          </EitaaRuntime>
        </TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
