import { IconCheck, IconCircleX, IconClock } from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { toPersianDigits } from "@/lib/format";
import type { AttendanceStatus } from "@/lib/sessions";

/**
 * How attendance reads on a past registration: «حاضر» · «تاخیر ۱۵ دقیقه» ·
 * «غایب» · «ثبت نشده».
 *
 * The vocabulary is the one `DESIGN_SYSTEM.md` §2 fixes, and `lateMinutes` is
 * optional on purpose: the chip is honest even when the manager recorded a
 * lateness without a number (Eitaa's roster screen may only tick the state),
 * in which case it says «تاخیر» alone instead of inventing «تاخیر ۰ دقیقه».
 *
 * Colour is never the only cue — each state carries its own word **and** icon;
 * `PENDING` stays neutral because "not marked yet" is not a verdict on anyone.
 * `ABSENT` is the one state with a consequence (it feeds the ban rules), so it
 * is the one that gets the danger tint.
 *
 * Server-safe (no `"use client"`): the badges are static markup.
 */
export function AttendanceChip({
  status,
  lateMinutes,
}: {
  status: AttendanceStatus;
  lateMinutes?: number | null;
}) {
  switch (status) {
    case "PRESENT":
      return (
        <Badge variant="success">
          <IconCheck aria-hidden="true" />
          حاضر
        </Badge>
      );

    case "LATE":
      return (
        <Badge variant="default">
          <IconClock aria-hidden="true" />
          {typeof lateMinutes === "number" && lateMinutes > 0
            ? `تاخیر ${toPersianDigits(lateMinutes)} دقیقه`
            : "تاخیر"}
        </Badge>
      );

    case "ABSENT":
      return (
        <Badge variant="destructive">
          <IconCircleX aria-hidden="true" />
          غایب
        </Badge>
      );

    default:
      return <Badge variant="outline">ثبت نشده</Badge>;
  }
}
