import { Suspense } from "react";

import { connection } from "next/server";

import { IconPointFilled } from "@tabler/icons-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cancelRuleSentences } from "@/lib/sessions";
import { getDefaultCancelRules } from "@/server/sessions/queries";

export const metadata = { title: "قوانین" };

/**
 * «قوانین» — the whole rulebook on one page, in the player's words.
 *
 * The owner asked for the app's rules to be written down somewhere; this is
 * that page. Its place is the `(app)` group: a player reads it before a
 * registration or after a penalty, and the header already owns the route's `h1`
 * through `nav.ts` — so the screen only adds `h2` sections.
 *
 * Three of the four sections are **prose about the product** (money, attendance
 * marks, the account) and therefore static: they ship in the shell and need no
 * query. The «لغو ثبت‌نام» section is the **live** one — its numbers come from
 * the single `Setting` row through `cancelRuleSentences`, the *same* sentences
 * the session page and `/profile` show — so it sits inside its own `<Suspense>`
 * with a row-rhythm skeleton, behind `await connection()` (`AGENTS.md`, Cache
 * Components). The manager's numbers can change; this page can never disagree
 * with the card that enforces them.
 *
 * Layout: one raised surface, sections separated by `--line` hairlines (the
 * roster-group pattern of `/my` and «سابقه‌ی من») — no card-in-card, no wall of
 * text. The only mark is the `--brand-mark` dot every bullet carries, never the
 * fill yellow (1.85:1 — `DESIGN_SYSTEM.md` §3).
 */
export default function RulesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
        <Section
          id="rules-money"
          title="پول و موجودی"
          lead="پولی که برای یک جا دادی، اگه انصراف بدی به موجودیت برمی‌گرده — نقدی برنمی‌گرده."
        >
          <Bullet>
            ثبت‌نام بعدی — آنلاین یا حضوری — خودکار از موجودیت کم می‌کنه؛ فقط مابقی رو میدی.
          </Bullet>
          <Bullet>
            مدیر هم می‌تونه موجودیت رو دستی اصلاح کنه؛ هر حرکت با تاریخ و مبلغش تو «گردش
            موجودی» پروفایلت می‌مونه.
          </Bullet>
          <Bullet>موجودیت هیچ‌وقت منفی نمی‌شه.</Bullet>
          <Bullet>
            تا وقتی تو لیست انتظاری، پرداختی لازم نیست؛ پول مال وقتیه که جات تو سانس قطعی بشه.
          </Bullet>
        </Section>

        <Suspense fallback={<CancelRulesSkeleton />}>
          <CancelRulesSection />
        </Suspense>

        <Section
          id="rules-attendance"
          title="حضور و غیاب"
          lead="بعد از هر سانس، مدیر حضورت رو ثبت می‌کنه: حاضر، تاخیر یا غایب."
        >
          <Bullet>
            <span className="font-medium">حاضر:</span> سر وقت رسیدی.
          </Bullet>
          <Bullet>
            <span className="font-medium">تاخیر:</span> دیر رسیدی — دقیقه‌هاش هم کنار اسمت ثبت
            می‌شه.
          </Bullet>
          <Bullet>
            <span className="font-medium">غایب:</span> نیومدی و انصراف هم ندادی.
          </Bullet>
          <Bullet>
            اگه «جریمه‌ی غیبت» روشن باشه، نیومدن بدون انصراف محرومیت می‌آره.
          </Bullet>
          <Bullet>
            تاخیرهای تکراری تو یه بازه هم محرومیت داره، اگه «جریمه‌ی تاخیر» روشن باشه.
          </Bullet>
        </Section>

        <Section
          id="rules-account"
          title="عضویت و حساب"
          lead="حسابت با همون ایتا ساخته می‌شه — ورود جدا و رمزی نداریم."
        >
          <Bullet>
            تا وقتی مدیر تأییدت نکرده، «در انتظار تأیید» می‌مونی و نمی‌تونی ثبت‌نام کنی.
          </Bullet>
          <Bullet>رد شدی هم تموم نیست — مدیر می‌تونه از پنلش دوباره تأییدت کنه.</Bullet>
          <Bullet>
            شماره‌ی همراهت فقط با دکمه‌ی خود ایتا ثبت می‌شه؛ دستی تایپ نمی‌شه.
          </Bullet>
          <Bullet>
            شماره و نام واقعی یه‌بار ثبت می‌شن و بعد از اون عوض نمی‌شن — فقط اسم نمایشی رو
            خودت می‌تونی عوض کنی.
          </Bullet>
          <Bullet>شماره‌تو فقط مدیر سالن می‌بینه.</Bullet>
        </Section>
      </div>

      <p className="text-caption text-ink-muted">
        هر سانس می‌تونه قانون خودش رو داشته باشه — قانون همون سانس تو صفحه‌ی خودش نوشته شده.
      </p>
    </div>
  );
}

/**
 * «لغو ثبت‌نام» — the one section whose numbers are the hall's, not the
 * product's: the same `cancelRuleSentences` the session card and `/profile`
 * render, resolved against the single `Setting` row (with the factory defaults
 * as the safety net). Disabled rules are stated honestly by that helper; this
 * section lays them out, states what a ban actually does (a suspended account
 * cannot register anywhere) and credits the numbers to the manager — the
 * attendance marks themselves are the section below.
 */
async function CancelRulesSection() {
  // Marks the read below as request-time work (Cache Components): the shell —
  // the three static sections around this one — stays prerenderable.
  await connection();

  const rules = await getDefaultCancelRules();
  const sentences = cancelRuleSentences(rules);

  return (
    <Section
      id="rules-cancel"
      title="لغو ثبت‌نام"
      lead="همین قوانین موقع ثبت‌نام و لغو اجرا می‌شن."
      footnote="این عددها رو مدیر سالن تعیین می‌کنه و هر وقت بخواد عوضشون می‌کنه."
    >
      {sentences.map((sentence) => (
        <Bullet key={sentence}>{sentence}</Bullet>
      ))}
      <Bullet>
        محرومیت یعنی تا تموم شدنش نمی‌تونی تو هیچ سانسی ثبت‌نام کنی — حتی اگه جا خالی باشه.
      </Bullet>
    </Section>
  );
}

/** One section of the surface: heading, optional lead, bullet list, footnote. */
function Section({
  id,
  title,
  lead,
  footnote,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  footnote?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1.5">
        <h2 id={id} className="text-h2 text-ink">
          {title}
        </h2>
        {lead ? <p className="text-body text-ink-muted">{lead}</p> : null}
      </div>

      <ul className="flex flex-col gap-2.5">{children}</ul>

      {footnote ? <p className="text-caption text-ink-muted">{footnote}</p> : null}
    </section>
  );
}

/** One rule sentence: a `--brand-mark` dot (≥3:1 on white) and the line. */
function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-body text-ink">
      <IconPointFilled
        aria-hidden="true"
        className="mt-[0.4em] size-2.5 shrink-0 text-brand-mark"
      />
      <span>{children}</span>
    </li>
  );
}

/** The live section's own rhythm: a heading line, a lead line, four rules. */
function CancelRulesSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-hidden="true">
      <span className="sr-only">در حال بارگذاری قوانین</span>

      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>

      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-1 h-4 w-1/2" />
      </div>
    </div>
  );
}
