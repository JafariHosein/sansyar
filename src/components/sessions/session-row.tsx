import Link from "next/link";

import { IconCheck, IconCircleX, IconHourglassLow, IconMapPin } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import { formatToman } from "@/lib/format";
import { formatDuration } from "@/lib/jalali";
import {
  paymentModeLabel,
  sessionTimeLabel,
  waitlistPositionLabel,
  type MyRegistration,
  type RegistrationStatus,
  type SessionCard as SessionCardData,
} from "@/lib/sessions";

import { CapacityRail } from "./capacity-rail";
import { LiveCountdown } from "./live-countdown";
import { StageBadge } from "./stage-badge";

/**
 * What the player's own line on a row says, per state — one entry per status,
 * because a row that answers "where do I stand" cannot have an unhandled case.
 *
 * The vocabulary is shared with the ledger: «در لیست انتظار» is the same phrase
 * the badge on `/my` and the session page use. The tone is the colour half of that
 * pair; the label and the icon are never colour-only.
 */
const MY_STATE: Record<
  RegistrationStatus,
  { label: string; tone: string; icon: typeof IconCheck }
> = {
  CONFIRMED: { label: "ثبت‌نام کردی", tone: "text-success-strong", icon: IconCheck },
  WAITLIST: { label: "در لیست انتظار", tone: "text-ink", icon: IconHourglassLow },
  CANCELED: { label: "لغو شده", tone: "text-ink-muted", icon: IconCircleX },
};

/**
 * One session as a **fixture line** on the board — «تابلوی سانس»
 * (`DESIGN_SYSTEM.md` §2).
 *
 * A row, not a card: §5 fixes lists as rows in a group separated by a `--line`
 * hairline, and the board is the list this design is built around ("sessions
 * read like fixture lines separated by *court-line* hairlines rather than
 * stacked cards", §2). The **group** in `page.tsx` owns the surface and the
 * elevation; this component owns the row's rhythm and nothing else.
 *
 * The whole row is a single `<Link>` to the session screen (§5: "list → detail
 * is the core pattern"), so it holds **no nested buttons**: the one thing that
 * moves inside it is the countdown, a small client island whose first paint is
 * identical to the server's.
 *
 * Reading order is fixed and matches every other surface: what it is (title +
 * stage) → where → when → how much → how full → what is left to wait for →
 * whether you are already in. Every quantity goes through the pure helpers in
 * `src/lib/sessions.ts` (Persian digits, no inlined formatting).
 *
 * Server-rendered on purpose; the alternative (a client row) would ship the
 * whole list twice.
 */
export function SessionRow({
  session,
  nowIso,
}: {
  session: SessionCardData;
  /** The server's `new Date().toISOString()` — the countdown's first "now". */
  nowIso: string;
}) {
  const mine = session.myRegistration;
  const duration = formatDuration(session.endsAt.getTime() - session.startsAt.getTime());

  return (
    <Link
      href={`/sessions/${session.id}`}
      className={cn(
        "flex flex-col gap-3 p-4 transition-colors",
        "hover:bg-sunken/50 active:bg-sunken",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-h3 text-ink">{session.title}</h3>
        <StageBadge stage={session.stage} />
      </div>

      <p className="flex items-start gap-1.5 text-caption text-ink-muted">
        <IconMapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" stroke={1.75} />
        {session.venueName}
      </p>

      {/* When + how long: the fixture's clock, set like a scoreboard line. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-numeral text-ink">
          {sessionTimeLabel(session.startsAt, session.endsAt)}
        </p>
        <p className="text-caption text-ink-muted">{duration}</p>
      </div>

      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-numeral text-ink">{formatToman(session.priceToman)}</span>
        <span className="text-caption text-ink-muted">
          {paymentModeLabel(session.paymentMode)}
        </span>
      </p>

      <CapacityRail
        // Seats people hold. A waitlisted row is not in the hall — that is why it
        // has its own line.
        confirmed={session.occupiedCount}
        capacity={session.capacity}
        waitlist={session.waitlistCount}
      />

      {/* Only the not-yet-open stage needs a countdown on a row — from there,
          what is left is waiting, not deciding. */}
      {session.stage === "upcoming" ? (
        <LiveCountdown
          targetIso={session.registrationOpensAt.toISOString()}
          initialNowIso={nowIso}
          variant="opens"
        />
      ) : null}

      {mine ? <MyLine mine={mine} /> : null}
    </Link>
  );
}

/**
 * The viewer's own line: the state word, and — only for a place in line — where in
 * that line it is.
 *
 * A three-state sentence rather than a lookup of icons at random: a canceled row
 * says so, a waitlisted one says where it stands, and only a held seat can claim
 * «ثبت‌نام کردی».
 */
function MyLine({ mine }: { mine: MyRegistration }) {
  const state = MY_STATE[mine.status];
  const Icon = state.icon;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3">
      <span className={cn("flex items-center gap-1.5 text-caption", state.tone)}>
        <Icon aria-hidden="true" className="size-4 shrink-0" stroke={1.75} />
        {state.label}
      </span>
      {mine.status === "WAITLIST" && mine.waitlistPosition !== null ? (
        <span className="text-caption text-ink-muted">
          {waitlistPositionLabel(mine.waitlistPosition)}
        </span>
      ) : null}
    </div>
  );
}
