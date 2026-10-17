import { IconChevronLeft, IconPointFilled } from "@tabler/icons-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/**
 * «قوانین انصراف» — the penalties of *this* session, one sentence each.
 *
 * The sentences are already resolved (settings row + per-session overrides) by
 * `cancelRuleSentences`; this card only lays them out. Calm on purpose: a rule
 * list is information, not a warning — the alarm styling is reserved for a ban
 * that is actually in force.
 *
 * The card is the **summary** of the rulebook: the footer carries the quiet
 * «همهی قوانین» link to `/rules`, where the same live sentences sit next to the
 * money, attendance and account rules. `/profile` reads the hall's own rules and
 * titles the card «خلاصهی قوانین» (`title`); the session page keeps the default
 * heading, because there the card is about *this* slot.
 *
 * The marker is a bare dot, so it uses `--brand-mark` (≥3:1 on white), never the
 * fill yellow (1.85:1 — `DESIGN_SYSTEM.md` §3).
 */
export function RulesCard({
  rulesSentences,
  title = "قوانین انصراف",
}: {
  rulesSentences: string[];
  /** The card heading. `/profile` passes «خلاصهی قوانین». */
  title?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-h2 text-ink">{title}</h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2.5">
          {rulesSentences.map((sentence, index) => (
            <li key={`${index}-${sentence}`} className="flex items-start gap-2.5 text-sm text-ink">
              <IconPointFilled
                aria-hidden="true"
                className="mt-[0.4em] size-2.5 shrink-0 text-brand-mark"
              />
              <span>{sentence}</span>
            </li>
          ))}
        </ul>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-caption text-ink-muted">این قوانین رو مدیر سالن تعیین می‌کنه.</p>
          <Button asChild variant="link" size="sm" className="px-0">
            <Link href="/rules">
              همه‌ی قوانین
              {/* RTL: a forward chevron points left and sits after the label. */}
              <IconChevronLeft aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
