import { Suspense } from "react";

import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { IconAlertTriangle, IconCreditCard } from "@tabler/icons-react";

import { PayOnlineButton } from "@/components/sessions/pay-online-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { balanceCoveredNote, seatMoneyLabel, seatOutstanding, type SeatMoney } from "@/lib/balance";
import { formatToman } from "@/lib/format";
import { sessionFullTimeLabel, type SessionDetail } from "@/lib/sessions";
import { getSessionDetail } from "@/server/sessions/queries";

/**
 * The (mock) gateway — «پرداخت» (§۵.۳, §۶.۳).
 *
 * Its own screen on purpose: a payment is a decision with a price and a way out,
 * not a toast on top of a registration. Six ordered states, exactly one of them
 * reachable per render:
 *
 * 1. no live registration → how to get one;
 * 2. the session is gone or over → nothing to pay;
 * 3. waitlisted → the money is not due until a seat is freed (the membership gate
 *    already vetted the person, so a promotion is the only wait left);
 * 4. an `IN_PERSON` slot → the money changes hands at the hall;
 * 5. already paid (online, in person or waived) → what the row says;
 * 6. otherwise → the amount, the test-gateway notice and the two taps.
 *
 * The **amount is the seat's own** — `amountToman − paidFromBalance`
 * (`seatOutstanding`) — never the session's current price: a take keeps the price
 * snapshot it was taken with, and what the account's balance already covered is
 * money the player has already paid. A seat the balance settled entirely is
 * `PAID_BALANCE` and is stated as settled, with no gateway at all; a partly covered
 * one reads the split (`balanceCoveredNote`) right under the amount it charges.
 * Every money sentence is `src/lib/balance.ts`'s.
 *
 * Only a `CONFIRMED` seat reaches the gateway: every other status is explained
 * here instead of charged. Every guard is repeated server-side in
 * `payForRegistration` with a compare-and-set, so this screen can only ever be
 * *presentation* of the state.
 */
export const metadata = { title: "پرداخت" };

/** Same reason as `/sessions/[id]`: the chrome reads `usePathname()` and this
 * segment has no pathname while a shell is being prerendered (`AGENTS.md`). */
export const instant = false;

export default function PayPage(props: PageProps<"/sessions/[id]/pay">) {
  return (
    <Suspense fallback={<PaySkeleton />}>
      <PayScreen params={props.params} />
    </Suspense>
  );
}

async function PayScreen({ params }: { params: PageProps<"/sessions/[id]/pay">["params"] }) {
  // Everything below is request-time: cookie, session row, the clock.
  await connection();

  const { id } = await params;
  // One clock for the whole screen: the query and every guard below read the same
  // instant, so two guards cannot disagree about "now".
  const now = new Date();
  const viewer = await getCurrentUser();
  const session = await getSessionDetail(id, viewer?.id ?? null, now);
  if (!session) notFound();

  // The state machine's one answer: `null` means "nothing to charge here", and
  // anything else is *this seat's money* — so the amount can never come from
  // anywhere but the seat the player holds.
  const gateway = gatewayMoney(session, now);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 text-ink">پرداخت</h1>
        <p className="text-h3 text-ink">{session.title}</p>
        <p className="text-body text-ink-muted">
          {sessionFullTimeLabel(session.startsAt, session.endsAt)}
        </p>
      </header>

      {gateway ? (
        <GatewayCard sessionId={session.id} money={gateway} />
      ) : (
        <BlockedState session={session} now={now} />
      )}
    </div>
  );
}

/**
 * The one state that renders the gateway: the seat's amount, the split the balance
 * already paid (when there is one) and the two taps of the (mock) test gateway.
 *
 * It receives the seat's money rather than the session: the sum charged is
 * `amountToman − paidFromBalance`, so a session whose price was edited after the
 * booking cannot re-price a seat, and a balance-covered half is never charged twice.
 */
function GatewayCard({ sessionId, money }: { sessionId: string; money: SeatMoney }) {
  const coveredNote = balanceCoveredNote(money);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1">
        <h2 className="text-h2 text-ink">مبلغ قابل پرداخت</h2>
        <p className="text-h1 text-ink">{formatToman(seatOutstanding(money))}</p>
        {/* Only a partly covered seat: what the balance already settled, in the one
            sentence `src/lib/balance.ts` writes for it («… از موجودیت حساب شده —
            … مونده.»). */}
        {coveredNote ? <p className="text-caption text-ink-muted">{coveredNote}</p> : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <Alert>
          <IconCreditCard aria-hidden="true" />
          <AlertTitle>درگاه آزمایشی</AlertTitle>
          <AlertDescription>
            این درگاه واقعی نیست و هیچ پولی جابه‌جا نمی‌شه — برای تست، پرداخت موفق را
            بزن.
          </AlertDescription>
        </Alert>

        <div className="flex flex-col gap-2">
          <PayOnlineButton sessionId={sessionId} />
          <Button asChild variant="outline" size="lg" className="w-full">
            <Link href={`/sessions/${sessionId}`}>انصراف از پرداخت</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The state machine: the seat's money when the gateway may open, `null` otherwise.
 *
 * Only a seat a member holds can pay: the membership gate is what turns a person
 * into a payer. A waitlisted or canceled row owes nothing, and
 * `payForRegistration`'s compare-and-set refuses both — so the gateway must not
 * open for them either. A seat the balance settled entirely is not payable either:
 * there is nothing left to charge — and the same goes for a seat whose remainder
 * is **zero** (a session priced ۰, or a balance that covered the whole amount):
 * the action answers `ALREADY_PAID` for it, so the screen must not offer a tap
 * that can only be refused.
 */
function gatewayMoney(session: SessionDetail, now: Date): SeatMoney | null {
  const my = session.myRegistration;

  if (!my || my.status !== "CONFIRMED") return null;
  if (session.status !== "PUBLISHED" || now.getTime() >= session.endsAt.getTime()) {
    return null;
  }
  if (session.paymentMode !== "AT_REGISTRATION") return null;
  if (my.paymentStatus !== "UNPAID") return null;

  const money = {
    amountToman: my.amountToman,
    paidFromBalance: my.paidFromBalance,
    paymentStatus: my.paymentStatus,
  };

  if (seatOutstanding(money) <= 0) return null;

  return money;
}

/** The one reason this screen has nothing to charge, with a way back. */
function BlockedState({ session, now }: { session: SessionDetail; now: Date }) {
  const my = session.myRegistration;
  const back = { href: `/sessions/${session.id}`, label: "برو به سانس" };

  if (!my || my.status === "CANCELED") {
    return (
      <Blocked
        back={back}
        title="ثبت‌نامی برای پرداخت نداری"
        body="اول از صفحه‌ی سانس ثبت‌نام کن؛ برگه‌ی پرداخت همون‌جا برات باز می‌شه."
      />
    );
  }

  // A canceled or finished session dominates every seat state: nothing can be
  // approved, freed or paid once the slot itself is gone.
  if (session.status !== "PUBLISHED" || now.getTime() >= session.endsAt.getTime()) {
    return (
      <Blocked
        tone="danger"
        back={back}
        title="این سانس دیگه قابل پرداخت نیست"
        body={
          session.status === "CANCELED"
            ? "مدیر این سانس را لغو کرده."
            : "پنجره‌ی پرداخت این سانس بسته شده."
        }
      />
    );
  }

  if (my.status === "WAITLIST") {
    return (
      <Blocked
        back={back}
        title="هنوز نوبتت نشده"
        body="تو لیست انتظاری. تا یک جا آزاد نشه و جات قطعی نشه، مبلغی لازم نیست."
      />
    );
  }

  // The seat's own money line — the two settled states below state it, and it is
  // the same sentence the session page and `/my` show for this row.
  const seatLine = seatMoneyLabel({
    ...my,
    registrationStatus: my.status,
    paymentMode: session.paymentMode,
  });

  // A seat the balance settled entirely is settled whatever the session's mode
  // says: `PAID_BALANCE` means the money is already in (`src/lib/sessions.ts`).
  if (my.paymentStatus === "PAID_BALANCE") {
    return <Blocked back={back} title="این مبلغ قبلاً پرداخت شده" body={seatLine} />;
  }

  if (session.paymentMode !== "AT_REGISTRATION") {
    return <Blocked back={back} title="پرداخت حضوری" body={seatLine} />;
  }

  // A seat with nothing left to charge — the zero the action refuses with
  // `ALREADY_PAID` (a session priced ۰). The seat itself is real; there is just
  // no money to hand over.
  if (seatOutstanding(my) <= 0) {
    return <Blocked back={back} title="چیزی برای پرداخت نمونده" body={seatLine} />;
  }

  return <Blocked back={back} title="این مبلغ قبلاً پرداخت شده" body={seatLine} />;
}

function Blocked({
  title,
  body,
  back,
  tone = "muted",
}: {
  title: string;
  body: string;
  back: { href: string; label: string };
  tone?: "muted" | "danger";
}) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant={tone === "danger" ? "destructive" : "default"}>
        <IconAlertTriangle aria-hidden="true" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{body}</AlertDescription>
      </Alert>

      <Button asChild size="lg" className="w-full">
        <Link href={back.href}>{back.label}</Link>
      </Button>
    </div>
  );
}

/** Amount block, a notice line and two buttons — the real rhythm, no jump. */
function PaySkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <span className="sr-only">در حال بارگذاری پرداخت</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-5 w-52" />
      </div>

      <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    </div>
  );
}
