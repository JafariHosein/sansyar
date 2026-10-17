"use client";

import { AppError } from "@/components/common/app-error";

/**
 * Root error boundary — anything below the root layout that no nearer boundary
 * caught (the `(app)` group's own layout throwing, an outside-group route, the
 * 404 shell). It renders **inside** the root layout, without any screen chrome,
 * so the block centres itself on the paper background.
 *
 * If the root layout itself fails, `global-error.tsx` takes over instead.
 * `metadata` cannot be exported from a client boundary — the title simply stays
 * the default one.
 */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <AppError error={error} retry={retry} />
    </main>
  );
}
