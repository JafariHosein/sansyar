"use client";

// `global-error` replaces the root layout, so it must bring its own document,
// global styles and font (Next 16 docs: file-conventions/error.md §Global Error).
import "@fontsource-variable/estedad";
import "./globals.css";

import { useEffect } from "react";

import { AppError } from "@/components/common/app-error";

/**
 * Last line of defence: the root layout (or the template) threw. There is no
 * Eitaa bridge, no providers, no verified session here — only a document, the
 * brand font, the tokens, and one working action: `retry()`, plus a plain-anchor
 * hard reload into the board (`homeHard` — the router stack may be what failed).
 *
 * `metadata` is not supported in a client boundary; React's own <title> rides
 * along instead (Next 16 docs, same page).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("[global] render failed", error);
  }, [error]);

  return (
    <html lang="fa" dir="rtl" className="h-full antialiased">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body className="min-h-full bg-background text-foreground">
        <title>مشکلی پیش آمد | سانس‌یار</title>
        <main className="grid min-h-dvh place-items-center px-4">
          <AppError error={error} retry={retry} homeHard />
        </main>
      </body>
    </html>
  );
}
