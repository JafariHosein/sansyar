"use client";

import { AppError } from "@/components/common/app-error";

/**
 * Error boundary for the manager's panel: the section strip and the tab bar stay
 * on screen, and the secondary action leads back to the dashboard — every panel
 * section stays one tap away even after a crash (the owner's rule).
 */
export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  return <AppError error={error} retry={retry} homeHref="/admin" homeLabel="داشبورد مدیر" />;
}
