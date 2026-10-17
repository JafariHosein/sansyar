import { IconPhone, IconUsers } from "@tabler/icons-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toPersianDigits } from "@/lib/format";
import { formatPhoneForDisplay } from "@/lib/phone";
import { capacityLabel, waitlistLabel, type Registrant } from "@/lib/sessions";

/**
 * A roster row: the shared `Registrant` plus what only a manager payload carries.
 *
 * The extra is **optional by construction** — `getSessionDetail` selects the
 * contact number for an admin and for nobody else, so a player's row simply does
 * not have it. That is the whole privacy story: this component only decides how to
 * draw what the query was allowed to fetch.
 */
type RosterRegistrant = Registrant & {
  phone?: string | null;
};

/**
 * The session roster — **two groups of rows**, not a stack of cards
 * (`DESIGN_SYSTEM.md` §5): hairlines separate names, nothing more.
 *
 * The order is the registration order (`createdAt` ascending, per section), and
 * each row's circle carries its place in that order as a Persian number instead
 * of an initial — a roster is read to find *who is where*, and the sequence is the
 * fact the query fixes. The lists are `<ol>`s so that order is in the markup too.
 *
 * The two groups are the two answers there are: seats people hold, and the line
 * behind a full session. There is deliberately no «در انتظار تأیید» group any
 * more — once the membership gate let a person in, their seat is theirs (the
 * owner's newest round), so a seat is only ever held or queued. Approving people
 * is a different surface entirely (`/admin`, the membership queue).
 *
 * Privacy rule: only a name is ever shown for somebody else. Their payment state
 * and attendance belong to the manager's surface, not to a public list. Rows carry
 * no action of their own.
 *
 * The viewer's own row carries a «تو» badge: colour is never the only cue, and a
 * name alone is not enough to spot yourself at a glance.
 */
export function RegistrantsList({
  confirmed,
  waitlist,
  capacity,
  occupiedCount,
}: {
  confirmed: RosterRegistrant[];
  /** Empty on a session that never filled up — the section is then not rendered. */
  waitlist: RosterRegistrant[];
  capacity: number;
  /** Seats people hold — the number the rail shows. */
  occupiedCount: number;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="registrants-confirmed">
        <h2
          id="registrants-confirmed"
          className="flex flex-wrap items-baseline gap-x-2 text-h2 text-ink"
        >
          ثبت‌نام‌شده‌ها{" "}
          {/* Seats held — the same number as the bench rail above, so the heading
              can never disagree with the meter. */}
          <span className="text-caption text-ink-muted">
            {capacityLabel(occupiedCount, capacity)}
          </span>
        </h2>

        {confirmed.length === 0 ? (
          <Empty className="bg-surface py-8 shadow-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconUsers aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>هنوز کسی ثبت‌نام نکرده</EmptyTitle>
              <EmptyDescription>اولین نفر باش — اسمت همین‌جا میاد.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className="list-none divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
            {confirmed.map((registrant, index) => (
              <RegistrantRow
                key={`${registrant.name}-${index}`}
                registrant={registrant}
                index={index}
              />
            ))}
          </ol>
        )}
      </section>

      {waitlist.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="registrants-waitlist">
          <h2
            id="registrants-waitlist"
            className="flex flex-wrap items-baseline gap-x-2 text-h2 text-ink"
          >
            لیست انتظار{" "}
            <span className="text-caption text-ink-muted">{waitlistLabel(waitlist.length)}</span>
          </h2>
          <ol className="list-none divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
            {waitlist.map((registrant, index) => (
              <RegistrantRow
                key={`${registrant.name}-${index}`}
                registrant={registrant}
                index={index}
              />
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

/**
 * One roster row: its place in the section, then who it is.
 *
 * The circle is `aria-hidden`: its number is the list's own ordinal (the `<ol>`
 * above announces it), so reading it twice would only add noise. The visible name
 * is the **real** name when the player gave one — that is the name the manager
 * checks against the person at the door — and the display name while it is empty.
 */
function RegistrantRow({ registrant, index }: { registrant: RosterRegistrant; index: number }) {
  const name = registrant.fullName ?? registrant.name;

  return (
    <li className="flex flex-wrap items-center gap-3 p-4">
      <Avatar className="size-9" aria-hidden="true">
        <AvatarFallback className="bg-brand-soft text-numeral text-brand-ink">
          {toPersianDigits(index + 1)}
        </AvatarFallback>
      </Avatar>

      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="truncate text-body text-ink">{name}</span>
        {registrant.isMe ? <Badge variant="outline">تو</Badge> : null}
        {registrant.phone ? (
          // Manager-only, and a real action: one tap dials. The label carries the
          // name because a bare number is a poor link name for a screen reader.
          <a
            href={`tel:${registrant.phone}`}
            aria-label={`تماس با ${name} — ${formatPhoneForDisplay(registrant.phone)}`}
            className="inline-flex shrink-0 items-center gap-1 text-caption text-brand-ink underline-offset-4 hover:underline"
          >
            <IconPhone aria-hidden="true" className="size-4" stroke={1.75} />
            <span dir="ltr" className="whitespace-nowrap">
              {formatPhoneForDisplay(registrant.phone)}
            </span>
          </a>
        ) : null}
      </span>

      {registrant.waitlistPosition !== null ? (
        <span className="shrink-0 text-caption text-ink-muted">
          نوبت {toPersianDigits(registrant.waitlistPosition)}
        </span>
      ) : null}
    </li>
  );
}
