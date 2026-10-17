"use client";

import { useId, useRef, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { IconAlertTriangle, IconDeviceFloppy, IconSend } from "@tabler/icons-react";

import { JalaliDateTimeField } from "@/components/admin/jalali-date-time-field";
import { haptic } from "@/components/eitaa/haptics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  sessionFormSchema,
  type SessionFormValues,
  type VenueChoice,
} from "@/lib/admin-sessions";
import { formatToman, toLatinDigits, toPersianDigits } from "@/lib/format";
import type { CancelRules, PaymentMode } from "@/lib/sessions";
import { notifyError, notifySuccess } from "@/lib/toast";
import { saveSession } from "@/server/actions/admin-sessions";

/**
 * The session form — «سانس جدید» and «ویرایش سانس» (PROMPT.md §۶.۴).
 *
 * One component, two modes: without `sessionId` it creates a row, with one it
 * updates it. The server action re-validates everything (`sessionFormSchema` — the
 * very schema this component validates with, so the manager can never read one rule
 * here and meet another one there) and re-checks `requireAdmin`; what this
 * component owns is what the manager sees while typing and what the toast says
 * afterwards.
 *
 * Four decisions shape it:
 *
 *  - **One shared rule set.** Before anything is sent, the form builds a
 *    `SessionFormValues` and runs the shared schema; the first issue is the
 *    sentence in the inline alert. Only values no schema can see — a date that was
 *    never picked, a number field left empty — get their own local sentence. A tap
 *    is therefore never a silent no-op.
 *  - **The intent is the button.** «ذخیرهی پیشنویس» and «انتشار سانس» are the same
 *    save with a different status, tracked in a ref (`statusRef`) that the buttons
 *    set *before* the submit handler reads it. Editing an already published session
 *    offers one primary button instead: it keeps the status it has.
 *  - **The registration window follows the session.** «بسته شدن ثبتنام» mirrors the
 *    start until the manager picks a close time of their own, which is what makes
 *    the hint under it («پیشفرض: لحظهی شروع سانس») true rather than decorative. On
 *    an existing session it never follows — a saved close time must not move
 *    because somebody nudged the start.
 *  - **The rules block is the default rules' own twin.** When «قوانین اختصاصی» is on,
 *    the twelve fields open pre-filled from the current `/admin/settings` values and
 *    are edited with the same labels, sentences and groups, so the override reads
 *    like the rule set it overrides.
 */

/** The twelve override fields, in the same three groups `/admin/settings` uses. */
type NumberKey =
  | "freeCancelHours"
  | "lateCancelPenaltyDays"
  | "lateCancelWarningWindowDays"
  | "noShowPenaltyDays"
  | "lateThresholdMinutes"
  | "lateStrikeCount"
  | "lateStrikeWindowDays"
  | "lateStrikePenaltyDays";

type SwitchKey =
  | "lateCancelEnabled"
  | "lateCancelFirstWarning"
  | "noShowEnabled"
  | "lateStrikesEnabled";

type FormState = {
  title: string;
  venueId: string;
  startsAt: Date | null;
  endsAt: Date | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  /** Numbers are held as text so a half-typed field is harmless. */
  capacityText: string;
  priceText: string;
  addressOverride: string;
  mapUrl: string;
  description: string;
  paymentMode: PaymentMode;
  /** «قوانین اختصاصی داشته باشه» — off means inherit every rule. */
  rulesEnabled: boolean;
  rulesNumbers: Record<NumberKey, string>;
  rulesSwitches: Record<SwitchKey, boolean>;
};

export function SessionForm({
  mode,
  initialValues,
  venues,
  defaultRules,
  sessionId,
}: {
  mode: "create" | "edit";
  /** The values the form opens with — from the row, or the new-slot defaults. */
  initialValues: SessionFormValues;
  venues: VenueChoice[];
  /** The `/admin/settings` rules, pre-filling the override fields. */
  defaultRules: CancelRules;
  /** The row being edited. Absent = the form creates a new session. */
  sessionId?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => toFormState(initialValues, defaultRules));
  /** «ثبتنام از همین حالا باز باشه» — create mode only, on by default. */
  const [opensNow, setOpensNow] = useState(mode === "create");
  /**
   * Whether the manager picked a close time themselves. Create mode starts
   * following the start; an existing session does not (see the file comment).
   */
  const [closesTouched, setClosesTouched] = useState(mode === "edit");
  /** The server's refusal, or this form's own sentence — one line, above the buttons. */
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** Which button is the intent: the pair sets it in `onClick`, the submit reads it. */
  const statusRef = useRef<"DRAFT" | "PUBLISHED">(
    mode === "edit" && initialValues.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
  );
  /** The same intent as state, so only the pressed button says «در حال…». */
  const [intent, setIntent] = useState<"DRAFT" | "PUBLISHED">(
    mode === "edit" && initialValues.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
  );

  const titleId = useId();
  const venueId_ = useId();
  const addressId = useId();
  const mapUrlId = useId();
  const descriptionId = useId();
  const opensNowId = useId();
  const capacityId = useId();
  const priceId = useId();
  const paymentId = useId();
  const rulesId = useId();

  const selectedVenue = venues.find((venue) => venue.id === state.venueId) ?? null;
  const priceToman = readNumber(state.priceText);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  function updateRuleNumber(key: NumberKey, value: string) {
    setState((current) => ({
      ...current,
      rulesNumbers: { ...current.rulesNumbers, [key]: value },
    }));
    setFormError(null);
  }

  function updateRuleSwitch(key: SwitchKey, value: boolean) {
    setState((current) => ({
      ...current,
      rulesSwitches: { ...current.rulesSwitches, [key]: value },
    }));
    setFormError(null);
  }

  /**
   * The values with the session's own start… and the registration close that
   * follows it until the manager picks one.
   */
  function handleStartChange(value: Date | null) {
    setState((current) => ({
      ...current,
      startsAt: value,
      registrationClosesAt:
        closesTouched ? current.registrationClosesAt : (value ?? current.registrationClosesAt),
    }));
    setFormError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const built = buildValues(state, { opensNow, status: statusRef.current });
    if (!built.ok) {
      haptic("error");
      setFormError(built.error);
      return;
    }

    // The shared schema, run on the client for the sentence's sake only: the
    // action re-parses the same payload and is the gate that counts.
    const parsed = sessionFormSchema.safeParse(built.values);
    if (!parsed.success) {
      haptic("error");
      setFormError(parsed.error.issues[0]?.message ?? "این اطلاعات قابل ثبت نیست.");
      return;
    }

    setFormError(null);

    startTransition(async () => {
      const result = await saveSession({ ...parsed.data, ...(sessionId ? { sessionId } : {}) });

      if (result.ok) {
        haptic("success");

        // The status the form actually wrote decides the wording: a draft save
        // must not read like a publication.
        const published = statusRef.current === "PUBLISHED";
        const becamePublished =
          published && (mode === "create" || initialValues.status !== "PUBLISHED");

        notifySuccess(
          becamePublished ? "سانس منتشر شد" : "سانس ذخیره شد",
          becamePublished
            ? "از همین حالا بازیکن‌ها می‌تونن ثبت‌نام کنن."
            : published
              ? "تغییرات روی همین سانس اعمال شد."
              : "پیش‌نویس ذخیره شد؛ تا منتشرش نکنی بازیکنی نمی‌بینش.",
        );

        if (mode === "create") {
          // The new row's own screen: «سانس جدید» has nothing left to show, and
          // the manage screen is where the next decision lives.
          router.push(`/admin/sessions/${result.sessionId}?created=1`);
        } else {
          router.refresh();
        }
        return;
      }

      haptic("error");
      setFormError(result.error);
      notifyError(result.error);
    });
  }

  const published = mode === "edit" && initialValues.status === "PUBLISHED";

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <section
        aria-labelledby="session-basics"
        className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card"
      >
        <h2 id="session-basics" className="text-h3 text-ink">
          مشخصات
        </h2>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={titleId}>
              عنوان سانس
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
            </FieldLabel>
            <Input
              id={titleId}
              value={state.title}
              maxLength={80}
              autoComplete="off"
              enterKeyHint="next"
              placeholder="مثلاً سانس چهارشنبه شب"
              onChange={(event) => update("title", event.target.value)}
            />
            <FieldDescription>همین عنوان روی کارت سانس و تو پیام‌ها می‌آد.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={venueId_}>مکان سانس</FieldLabel>
            {/* `dir="rtl"` is set on the Root (not on the trigger) so the popover's
                own positioning and animations read the Persian direction — there
                is no `DirectionProvider` above this component. */}
            <Select
              dir="rtl"
              value={state.venueId}
              onValueChange={(value) => update("venueId", value)}
            >
              <SelectTrigger
                id={venueId_}
                disabled={pending}
                className="h-11 w-full"
                aria-label={selectedVenue ? `مکان سانس: ${selectedVenue.name}` : undefined}
              >
                {/* A custom child keeps the trigger on **one** line: the items carry
                    the address as a second line, which must not land here. */}
                <SelectValue placeholder="مکان رو انتخاب کن">
                  {selectedVenue ? (
                    <span className="truncate">
                      {selectedVenue.name}
                      {selectedVenue.isActive ? "" : " (غیرفعال)"}
                    </span>
                  ) : (
                    "مکان رو انتخاب کن"
                  )}
                </SelectValue>
              </SelectTrigger>

              <SelectContent>
                {venues.map((venue) => (
                  <SelectItem key={venue.id} value={venue.id}>
                    <span className="flex flex-col items-start gap-0.5">
                      <span>
                        {venue.name}
                        {venue.isActive ? "" : " (غیرفعال)"}
                      </span>
                      <span className="text-caption text-ink-muted">{venue.address}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              سانس روی این مکان برگزار می‌شه — آدرس کارت سانس از همین‌جا می‌آد.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={addressId}>آدرس این سانس</FieldLabel>
            <Input
              id={addressId}
              value={state.addressOverride}
              maxLength={255}
              autoComplete="off"
              enterKeyHint="next"
              placeholder={selectedVenue ? selectedVenue.address : "خیابان، کوچه، پلاک"}
              onChange={(event) => update("addressOverride", event.target.value)}
            />
            <FieldDescription>
              اختیاری — فقط وقتی بنویس که این سانس جای دقیق‌تری داره، مثلاً «درب شماره‌ی ۳». خالی
              بذاری، آدرس مکان نشون داده می‌شه.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={mapUrlId}>لینک نقشه‌ی این سانس</FieldLabel>
            {/* A URL is Latin text: `dir="ltr"` keeps «https://» at the start of
                the line instead of letting the RTL paragraph reorder it. */}
            <Input
              id={mapUrlId}
              type="url"
              inputMode="url"
              dir="ltr"
              value={state.mapUrl}
              maxLength={500}
              autoComplete="off"
              placeholder="https://neshan.org/maps/share/…"
              onChange={(event) => update("mapUrl", event.target.value)}
            />
            <FieldDescription>
              اختیاری — لینک اشتراک نشان. خالی بذاری، از لینک مکان استفاده می‌شه و در نهایت
              مسیریابی روی همین آدرس جست‌وجو می‌کنه.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={descriptionId}>توضیح</FieldLabel>
            {/* Player-facing copy: it keeps the 16px floor of `DESIGN_SYSTEM.md` §۴
                instead of the stock Textarea's 14px. */}
            <Textarea
              id={descriptionId}
              value={state.description}
              maxLength={2000}
              rows={3}
              placeholder="اختیاری — مثلاً وسایل لازم، رختکن یا توضیح ورودی سالن"
              className="min-h-24 text-base md:text-base"
              onChange={(event) => update("description", event.target.value)}
            />
            <FieldDescription>اختیاری؛ روی صفحه‌ی سانس زیر آدرس نشون داده می‌شه.</FieldDescription>
          </Field>
        </FieldGroup>
      </section>

      <Separator />

      <section
        aria-labelledby="session-times"
        className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card"
      >
        <h2 id="session-times" className="text-h3 text-ink">
          زمان
        </h2>

        <FieldGroup>
          <JalaliDateTimeField
            label="شروع سانس"
            value={state.startsAt}
            disabled={pending}
            onChange={handleStartChange}
          />

          <JalaliDateTimeField
            label="پایان سانس"
            value={state.endsAt}
            disabled={pending}
            hint="سانس می‌تونه حداکثر ۱۲ ساعت باشه."
            onChange={(value) => update("endsAt", value)}
          />

          {/* The opens switch only exists while creating: on an existing session the
              window is a fact of the row, not a default. */}
          {mode === "create" ? (
            <Field orientation="horizontal" data-disabled={pending ? true : undefined}>
              <FieldContent>
                <FieldLabel htmlFor={opensNowId}>ثبت‌نام از همین حالا باز باشه</FieldLabel>
                <FieldDescription>
                  روشن بذاری، ثبت‌نام از لحظه‌ی ذخیره بازه. خاموشش کنی، خودت زمان باز شدن رو انتخاب
                  می‌کنی.
                </FieldDescription>
              </FieldContent>
              <Switch
                id={opensNowId}
                checked={opensNow}
                disabled={pending}
                onCheckedChange={(checked) => {
                  setOpensNow(checked);
                  setFormError(null);
                }}
              />
            </Field>
          ) : null}

          {opensNow ? null : (
            <JalaliDateTimeField
              label="باز شدن ثبت‌نام"
              value={state.registrationOpensAt}
              disabled={pending}
              hint="از این لحظه بازیکن‌ها می‌تونن ثبت‌نام کنن."
              onChange={(value) => update("registrationOpensAt", value)}
            />
          )}

          <JalaliDateTimeField
            label="بسته شدن ثبت‌نام"
            value={state.registrationClosesAt}
            disabled={pending}
            hint="پیش‌فرض: لحظه‌ی شروع سانس."
            onChange={(value) => {
              setClosesTouched(true);
              update("registrationClosesAt", value);
            }}
          />
        </FieldGroup>
      </section>

      <Separator />

      <section
        aria-labelledby="session-capacity"
        className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card"
      >
        <h2 id="session-capacity" className="text-h3 text-ink">
          ظرفیت و قیمت
        </h2>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={capacityId}>ظرفیت</FieldLabel>
            <Input
              id={capacityId}
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              className="text-center"
              value={state.capacityText}
              maxLength={2}
              placeholder={toPersianDigits(12)}
              onChange={(event) =>
                update("capacityText", digitsOnly(event.target.value, 2))
              }
            />
            <FieldDescription>چند نفر تو این سانس جا می‌شن — از ۱ تا ۶۰ نفر.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={priceId}>قیمت هر نفر</FieldLabel>
            <Input
              id={priceId}
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              className="text-center"
              value={state.priceText}
              maxLength={8}
              placeholder={toPersianDigits(0)}
              onChange={(event) => update("priceText", digitsOnly(event.target.value, 8))}
            />
            <FieldDescription>
              {priceToman === null
                ? "مبلغ به تومان؛ صفر یعنی این سانس رایگانه."
                : `بازیکن‌ها این مبلغ رو می‌بینن: ${formatToman(priceToman)}`}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={paymentId}>پرداخت</FieldLabel>
            <Select
              dir="rtl"
              value={state.paymentMode}
              onValueChange={(value) => update("paymentMode", value as PaymentMode)}
            >
              <SelectTrigger id={paymentId} disabled={pending} className="h-11 w-full">
                <SelectValue>
                  {state.paymentMode === "AT_REGISTRATION"
                    ? "آنلاین موقع ثبت‌نام"
                    : "حضوری به مدیر"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AT_REGISTRATION">آنلاین موقع ثبت‌نام</SelectItem>
                <SelectItem value="IN_PERSON">حضوری به مدیر</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              «آنلاین» یعنی بازیکن موقع ثبت‌نام پرداخت می‌کنه؛ «حضوری» یعنی پول رو خودت می‌گیری و
              بعداً تیکش رو می‌زنی.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </section>

      <Separator />

      <section
        aria-labelledby="session-rules"
        className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card"
      >
        <h2 id="session-rules" className="text-h3 text-ink">
          قوانین این سانس
        </h2>

        <Field orientation="horizontal" data-disabled={pending ? true : undefined}>
          <FieldContent>
            <FieldLabel htmlFor={rulesId}>قوانین اختصاصی داشته باشه</FieldLabel>
            <FieldDescription>
              خاموش بذاری، همین قوانین پیش‌فرضِ «تنظیمات» روی این سانس اعمال می‌شه.
            </FieldDescription>
          </FieldContent>
          <Switch
            id={rulesId}
            checked={state.rulesEnabled}
            disabled={pending}
            onCheckedChange={(checked) => update("rulesEnabled", checked)}
          />
        </Field>

        {state.rulesEnabled ? (
          <>
            <Separator />

            <p className="text-caption text-ink-muted">این‌ها فقط برای همین سانس ذخیره می‌شن.</p>

            {RULE_GROUPS.map((group) => (
              <FieldSet key={group.key}>
                {/* A `legend`, not a heading: the three groups are one rule set's
                    sections, and the section's own `h2` is above them. */}
                <FieldLegend variant="label" className="text-caption text-ink-muted">
                  {group.title}
                </FieldLegend>

                <FieldGroup>
                  {group.rules.map((rule) => {
                    // A rule whose parent switch is off is shown — disabled, not
                    // hidden — so the whole rule set stays readable at a glance
                    // (the same behaviour as `/admin/settings`).
                    const parentOff =
                      rule.requires?.some((key) => !state.rulesSwitches[key]) ?? false;

                    if (rule.kind === "switch") {
                      const id = `${rulesId}-${rule.key}`;

                      return (
                        <Field
                          key={rule.key}
                          orientation="horizontal"
                          data-disabled={parentOff || pending ? true : undefined}
                        >
                          <FieldContent>
                            <FieldLabel htmlFor={id}>{rule.label}</FieldLabel>
                            <FieldDescription>{rule.sentence}</FieldDescription>
                          </FieldContent>
                          <Switch
                            id={id}
                            checked={state.rulesSwitches[rule.key]}
                            disabled={parentOff || pending}
                            onCheckedChange={(checked) => updateRuleSwitch(rule.key, checked)}
                          />
                        </Field>
                      );
                    }

                    const id = `${rulesId}-${rule.key}`;

                    return (
                      <Field
                        key={rule.key}
                        data-disabled={parentOff || pending ? true : undefined}
                      >
                        <FieldLabel htmlFor={id}>{rule.label}</FieldLabel>
                        <Input
                          id={id}
                          inputMode="numeric"
                          autoComplete="off"
                          dir="ltr"
                          className="text-center"
                          value={state.rulesNumbers[rule.key]}
                          maxLength={4}
                          disabled={parentOff || pending}
                          placeholder={toPersianDigits(`${rule.min} تا ${rule.max}`)}
                          onChange={(event) =>
                            updateRuleNumber(rule.key, digitsOnly(event.target.value, 4))
                          }
                        />
                        <FieldDescription>{rule.sentence}</FieldDescription>
                      </Field>
                    );
                  })}
                </FieldGroup>
              </FieldSet>
            ))}
          </>
        ) : null}
      </section>

      <Separator />

      <section
        aria-labelledby="session-publish"
        className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card"
      >
        <h2 id="session-publish" className="text-h3 text-ink">
          انتشار
        </h2>

        <p className="text-body text-ink-muted">
          پیش‌نویس برای بازیکن‌ها دیده نمی‌شه؛ تا منتشرش نکنی هیچ‌کس ثبت‌نام نمی‌کنه.
        </p>

        {/* The one refusal line: this form's own check, the shared schema, or the
            server's answer. Above the buttons, never a silent no-op. */}
        {formError ? (
          <Alert variant="destructive">
            <IconAlertTriangle aria-hidden="true" />
            <AlertTitle>ذخیره نشد</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-2">
          {published ? (
            // Already live: one primary button, and the status stays what it is.
            <Button
              type="submit"
              size="lg"
              disabled={pending}
              aria-busy={pending}
              onClick={() => {
                statusRef.current = "PUBLISHED";
              }}
            >
              {pending ? (
                <>
                  <Spinner aria-hidden="true" />
                  در حال ذخیره…
                </>
              ) : (
                <>
                  <IconDeviceFloppy aria-hidden="true" />
                  ذخیره‌ی تغییرات
                </>
              )}
            </Button>
          ) : (
            <>
              <Button
                type="submit"
                variant="outline"
                size="lg"
                disabled={pending}
                aria-busy={pending}
                onClick={() => {
                  statusRef.current = "DRAFT";
                  setIntent("DRAFT");
                }}
              >
                {pending && intent === "DRAFT" ? (
                  <>
                    <Spinner aria-hidden="true" />
                    در حال ذخیره…
                  </>
                ) : (
                  <>
                    <IconDeviceFloppy aria-hidden="true" />
                    ذخیره‌ی پیش‌نویس
                  </>
                )}
              </Button>

              <Button
                type="submit"
                size="lg"
                disabled={pending}
                aria-busy={pending}
                onClick={() => {
                  statusRef.current = "PUBLISHED";
                  setIntent("PUBLISHED");
                }}
              >
                {pending && intent === "PUBLISHED" ? (
                  <>
                    <Spinner aria-hidden="true" />
                    در حال انتشار…
                  </>
                ) : (
                  <>
                    <IconSend aria-hidden="true" />
                    انتشار سانس
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </section>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Building the payload
// ---------------------------------------------------------------------------

/** Digits only — Latin or Persian on the way in, a plain digit run on the way out. */
function digitsOnly(value: string, maxLength: number): string {
  return toLatinDigits(value)
    .replace(/[^0-9]/g, "")
    .slice(0, maxLength);
}

/** A field's text as a whole number, or `null` when it is empty or not a number. */
function readNumber(value: string): number | null {
  const digits = toLatinDigits(value.trim());
  if (!/^\d{1,9}$/.test(digits)) return null;
  return Number(digits);
}

/** `""` and `null` are the same fact for an optional column. */
function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The form's state → the payload, or the one sentence that stops it.
 *
 * Everything the shared schema can see is deliberately left to it; what is
 * checked here is what no schema can: a moment that was never picked (the picker
 * hands back a `Date`, and "nothing chosen" is its absence), and a number field
 * whose text is not a number yet. Both would otherwise be a tap that does
 * nothing.
 */
function buildValues(
  state: FormState,
  options: { opensNow: boolean; status: "DRAFT" | "PUBLISHED" },
): { ok: true; values: SessionFormValues } | { ok: false; error: string } {
  if (state.startsAt === null || state.endsAt === null) {
    return { ok: false, error: "زمان شروع و پایان سانس رو انتخاب کن." };
  }

  const opens = options.opensNow ? new Date() : state.registrationOpensAt;
  if (opens === null) {
    return {
      ok: false,
      error: "زمان باز شدن ثبت‌نام رو انتخاب کن — یا «ثبت‌نام از همین حالا باز باشه» رو روشن کن.",
    };
  }

  if (state.registrationClosesAt === null) {
    return { ok: false, error: "زمان بسته شدن ثبت‌نام رو انتخاب کن." };
  }

  const capacity = readNumber(state.capacityText);
  if (capacity === null) {
    return { ok: false, error: "ظرفیت سانس رو با عدد بنویس." };
  }

  const priceToman = readNumber(state.priceText);
  if (priceToman === null) {
    return { ok: false, error: "قیمت هر نفر رو با عدد بنویس — صفر یعنی رایگان." };
  }

  let rules: CancelRules | null = null;
  if (state.rulesEnabled) {
    for (const rule of RULE_NUMBERS) {
      const raw = state.rulesNumbers[rule.key];
      if (raw.trim().length === 0) {
        return { ok: false, error: `عدد «${rule.label}» رو بنویس.` };
      }
      if (readNumber(raw) === null) {
        return { ok: false, error: `«${rule.label}» باید یه عدد باشه.` };
      }
    }

    rules = {
      freeCancelHours: readNumber(state.rulesNumbers.freeCancelHours) ?? 0,
      lateCancelEnabled: state.rulesSwitches.lateCancelEnabled,
      lateCancelPenaltyDays: readNumber(state.rulesNumbers.lateCancelPenaltyDays) ?? 0,
      lateCancelFirstWarning: state.rulesSwitches.lateCancelFirstWarning,
      lateCancelWarningWindowDays:
        readNumber(state.rulesNumbers.lateCancelWarningWindowDays) ?? 0,
      noShowEnabled: state.rulesSwitches.noShowEnabled,
      noShowPenaltyDays: readNumber(state.rulesNumbers.noShowPenaltyDays) ?? 0,
      lateStrikesEnabled: state.rulesSwitches.lateStrikesEnabled,
      lateThresholdMinutes: readNumber(state.rulesNumbers.lateThresholdMinutes) ?? 0,
      lateStrikeCount: readNumber(state.rulesNumbers.lateStrikeCount) ?? 1,
      lateStrikeWindowDays: readNumber(state.rulesNumbers.lateStrikeWindowDays) ?? 0,
      lateStrikePenaltyDays: readNumber(state.rulesNumbers.lateStrikePenaltyDays) ?? 0,
    };
  }

  return {
    ok: true,
    values: {
      title: state.title,
      venueId: state.venueId,
      startsAt: state.startsAt,
      endsAt: state.endsAt,
      registrationOpensAt: opens,
      registrationClosesAt: state.registrationClosesAt,
      capacity,
      priceToman,
      paymentMode: state.paymentMode,
      status: options.status,
      addressOverride: emptyToNull(state.addressOverride),
      mapUrl: emptyToNull(state.mapUrl),
      description: emptyToNull(state.description),
      rules,
    },
  };
}

/** The row (or the defaults) → the form's state. */
function toFormState(initial: SessionFormValues, defaultRules: CancelRules): FormState {
  const rules = initial.rules ?? defaultRules;

  return {
    title: initial.title,
    venueId: initial.venueId,
    startsAt: initial.startsAt,
    endsAt: initial.endsAt,
    registrationOpensAt: initial.registrationOpensAt,
    registrationClosesAt: initial.registrationClosesAt,
    capacityText: String(initial.capacity),
    priceText: String(initial.priceToman),
    addressOverride: initial.addressOverride ?? "",
    mapUrl: initial.mapUrl ?? "",
    description: initial.description ?? "",
    paymentMode: initial.paymentMode,
    rulesEnabled: initial.rules !== null,
    rulesNumbers: {
      freeCancelHours: String(rules.freeCancelHours),
      lateCancelPenaltyDays: String(rules.lateCancelPenaltyDays),
      lateCancelWarningWindowDays: String(rules.lateCancelWarningWindowDays),
      noShowPenaltyDays: String(rules.noShowPenaltyDays),
      lateThresholdMinutes: String(rules.lateThresholdMinutes),
      lateStrikeCount: String(rules.lateStrikeCount),
      lateStrikeWindowDays: String(rules.lateStrikeWindowDays),
      lateStrikePenaltyDays: String(rules.lateStrikePenaltyDays),
    },
    rulesSwitches: {
      lateCancelEnabled: rules.lateCancelEnabled,
      lateCancelFirstWarning: rules.lateCancelFirstWarning,
      noShowEnabled: rules.noShowEnabled,
      lateStrikesEnabled: rules.lateStrikesEnabled,
    },
  };
}

// ---------------------------------------------------------------------------
// The twelve rules — the manager's own rule set, in `/admin/settings`' order
// ---------------------------------------------------------------------------

/**
 * The labels, sentences and bounds are deliberately **the same** as
 * `/admin/settings`': a session's override and the default it overrides are the
 * same rule, and one rule must not read two ways on two screens.
 */
type RuleBase = {
  label: string;
  /** One plain sentence: what this rule means for a player. */
  sentence: string;
  /** The switches this rule hangs on — off while any of them is off. */
  requires?: SwitchKey[];
};

type NumberRule = RuleBase & { kind: "number"; key: NumberKey; min: number; max: number };
type SwitchRule = RuleBase & { kind: "switch"; key: SwitchKey };
type Rule = NumberRule | SwitchRule;

const RULE_GROUPS: readonly { key: string; title: string; rules: Rule[] }[] = [
  {
    key: "cancel",
    title: "انصراف",
    rules: [
      {
        kind: "number",
        key: "freeCancelHours",
        label: "ساعت انصراف آزاد",
        sentence: "چند ساعت قبل از شروع سانس، انصراف هنوز آزاده.",
        min: 0,
        max: 168,
      },
      {
        kind: "switch",
        key: "lateCancelEnabled",
        label: "جریمه‌ی انصراف دیرهنگام",
        sentence: "اگه روشن باشه، انصراف دیرهنگام محرومیت داره.",
      },
      {
        kind: "number",
        key: "lateCancelPenaltyDays",
        label: "محرومیت انصراف دیرهنگام",
        sentence: "چند روز محرومیت برای انصراف دیرهنگام.",
        min: 0,
        max: 365,
        requires: ["lateCancelEnabled"],
      },
      {
        kind: "switch",
        key: "lateCancelFirstWarning",
        label: "اخطار بار اول",
        sentence:
          "اگه روشن باشه، اولین انصراف دیرهنگام تو بازه‌ی زیر فقط اخطار می‌گیره، بدون محرومیت.",
        requires: ["lateCancelEnabled"],
      },
      {
        kind: "number",
        key: "lateCancelWarningWindowDays",
        label: "بازه‌ی اخطار بار اول",
        sentence: "انصراف‌های دیرهنگام چند روز گذشته، واسه اخطار بار اول شمرده می‌شن.",
        min: 0,
        max: 365,
        requires: ["lateCancelEnabled", "lateCancelFirstWarning"],
      },
    ],
  },
  {
    key: "no-show",
    title: "غیبت",
    rules: [
      {
        kind: "switch",
        key: "noShowEnabled",
        label: "جریمه‌ی غیبت",
        sentence: "اگه روشن باشه، نیومدن بدون انصراف محرومیت داره.",
      },
      {
        kind: "number",
        key: "noShowPenaltyDays",
        label: "محرومیت غیبت",
        sentence: "چند روز محرومیت برای کسی که بدون انصراف نیومد.",
        min: 0,
        max: 365,
        requires: ["noShowEnabled"],
      },
    ],
  },
  {
    key: "late",
    title: "تاخیر",
    rules: [
      {
        kind: "switch",
        key: "lateStrikesEnabled",
        label: "جریمه‌ی تاخیر",
        sentence: "اگه روشن باشه، رسیدن به آستانه‌ی تاخیر محرومیت داره.",
      },
      {
        kind: "number",
        key: "lateThresholdMinutes",
        label: "آستانه‌ی تاخیر",
        sentence: "از این دقیقه به بعدِ شروع سانس، «تاخیر» حساب می‌شه.",
        min: 0,
        max: 240,
        requires: ["lateStrikesEnabled"],
      },
      {
        kind: "number",
        key: "lateStrikeCount",
        label: "تعداد تاخیر تا محرومیت",
        sentence: "بعد از چند تاخیر، محرومیت فعال می‌شه.",
        min: 1,
        max: 20,
        requires: ["lateStrikesEnabled"],
      },
      {
        kind: "number",
        key: "lateStrikeWindowDays",
        label: "بازه‌ی شمردن تاخیرها",
        sentence: "تاخیرها تو چند روز گذشته شمرده می‌شن.",
        min: 0,
        max: 365,
        requires: ["lateStrikesEnabled"],
      },
      {
        kind: "number",
        key: "lateStrikePenaltyDays",
        label: "محرومیت تاخیرها",
        sentence: "چند روز محرومیت وقتی تاخیرها به این تعداد می‌رسن.",
        min: 0,
        max: 365,
        requires: ["lateStrikesEnabled"],
      },
    ],
  },
];

/** Every number rule, flattened — the submit check walks this and nothing else. */
const RULE_NUMBERS: NumberRule[] = RULE_GROUPS.flatMap((group) => group.rules).filter(
  (rule): rule is NumberRule => rule.kind === "number",
);
