"use client";

import { eitaaWebApp, safely } from "./sdk";

/**
 * Haptic feedback — Eitaa only, and never load-bearing.
 *
 * Always paired with a visible change (`DESIGN_SYSTEM.md` §10: never a single
 * channel). Outside Eitaa these are no-ops, so call sites stay unconditional.
 */

export type HapticKind = "light" | "medium" | "heavy" | "success" | "error" | "warning" | "selection";

export function haptic(kind: HapticKind = "light"): void {
  const feedback = eitaaWebApp()?.HapticFeedback;
  if (!feedback) return;

  safely(() => {
    if (kind === "selection") {
      feedback.selectionChanged?.();
      return;
    }
    if (kind === "success" || kind === "error" || kind === "warning") {
      feedback.notificationOccurred?.(kind);
      return;
    }
    feedback.impactOccurred?.(kind);
  });
}
