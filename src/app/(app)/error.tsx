"use client";

import { AppError } from "@/components/common/app-error";

/**
 * Error boundary for the player/manager screens. It renders inside
 * `(app)/layout.tsx`, so the header and the bottom tab bar stay put and the
 * fallback never becomes a dead end — the person can walk somewhere else
 * instead of losing the whole app.
 *
 * Only this group's children are covered; a throwing `(app)` layout itself
 * bubbles to the root boundary.
 */
export default function ScreensError({ error, retry }: { error: unknown; retry: () => void }) {
  return <AppError error={error} retry={retry} />;
}
