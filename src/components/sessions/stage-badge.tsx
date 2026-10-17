import { Badge } from "@/components/ui/badge";
import { stageBadgeVariant, stageLabel, type SessionStage } from "@/lib/sessions";

/**
 * The one place a session stage becomes visible text.
 *
 * Both halves of the pair live in `src/lib/sessions.ts`: `stageLabel` fixes the
 * wording (`DESIGN_SYSTEM.md` §6 — «در حال ثبت‌نام»، «به‌زودی»، «ظرفیت پر —
 * لیست انتظار»، «لغو شده») and `stageBadgeVariant` picks the tint. Keeping them
 * there means a list row, the detail screen and the manager's screens can never
 * invent a synonym for the same state, and the colour is never the only cue —
 * the badge always carries the word as well.
 *
 * Server-safe on purpose (no `"use client"`): it is rendered inside server
 * components, and it stays out of the client bundle.
 */
export function StageBadge({ stage, className }: { stage: SessionStage; className?: string }) {
  return (
    <Badge variant={stageBadgeVariant(stage)} className={className}>
      {stageLabel(stage)}
    </Badge>
  );
}
