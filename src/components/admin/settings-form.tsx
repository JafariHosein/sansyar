"use client";

import { useId, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { IconAlertTriangle, IconDeviceFloppy, IconEye } from "@tabler/icons-react";

import { haptic } from "@/components/eitaa/haptics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { toLatinDigits, toPersianDigits } from "@/lib/format";
import { cancelRulesText, DEFAULT_CANCEL_RULES, type CancelRules } from "@/lib/sessions";
import { notifyError, notifySuccess } from "@/lib/toast";
import { saveSettings } from "@/server/actions/admin-settings";

/**
 * The **default cancel rules** form — the twelve numbers behind every session the
 * manager did not override (PROMPT.md §۶.۴ و §۵.۴).
 *
 * Three ideas shape this component:
 *
 *  - **One row per rule**: a label in the manager's words, the control, and one
 *    plain sentence saying what the rule does. The ranges live in the server
 *    action (`admin-settings.ts`), which re-validates everything — the input's
 *    numeric filtering and the empty-field check only spare a round trip.
 *  - **A switch owns its numbers**: turning «جریمه‌ی انصراف دیرهنگام» off disables
 *    its two day fields instead of hiding them, so the manager can see what will
 *    come back when the switch goes on again. Values are never cleared.
 *  - **The player's own text is the preview**: the card at the bottom renders
 *    `cancelRulesText` — the exact paragraph the session page shows — from the
 *    values currently in the form, so the manager reads the rule the way a player
 *    will before saving it.
 *
 * On success the action has already revalidated the settings page and every
 * screen that prints these rules; `router.refresh()` re-reads the page so the form
 * and the stored row can never drift apart.
 */
export function SettingsForm({ initialRules }: { initialRules: CancelRules }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => toFormState(initialRules));
  /** Field-level refusals (empty numbers only) — the server owns the ranges. */
  const [errors, setErrors] = useState<Partial<Record<NumberKey, string>>>({});
  /** The server's own refusal — one line, above the save button. */
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setNumberField(key: NumberKey, value: string) {
    setState((current) => {
      const next: FormState = { ...current };
      next[key] = value;
      return next;
    });
    setErrors((current) => ({ ...current, [key]: undefined }));
    setFormError(null);
  }

  function setSwitchField(key: SwitchKey, value: boolean) {
    setState((current) => {
      const next: FormState = { ...current };
      next[key] = value;
      return next;
    });
    setFormError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    // The one client-side check: every number is present. A range refusal is the
    // server's sentence to say — it knows the bound the column was built for.
    const missing: Partial<Record<NumberKey, string>> = {};
    for (const rule of NUMBER_RULES) {
      if (state[rule.key].trim().length === 0) missing[rule.key] = "این عدد رو بنویس.";
    }

    if (Object.keys(missing).length > 0) {
      haptic("error");
      setErrors(missing);
      return;
    }

    setErrors({});

    startTransition(async () => {
      const result = await saveSettings(rulesFromForm(state));

      if (result.ok) {
        haptic("success");
        notifySuccess(
          "تنظیمات ذخیره شد",
          "از همین حالا روی انصراف‌ها و صفحه‌ی سانس‌ها اعمال می‌شه.",
        );
        // The settings are server-rendered: re-read the page instead of trusting
        // the local state after a save that may have clamped nothing but did
        // round-trip through the database.
        router.refresh();
        return;
      }

      haptic("error");
      setFormError(result.error);
      notifyError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {GROUPS.map((group) => (
        <section
          key={group.key}
          aria-labelledby={`settings-${group.key}`}
          className="flex flex-col gap-4 rounded-xl bg-surface p-4 shadow-card"
        >
          <h2 id={`settings-${group.key}`} className="text-h3 text-ink">
            {group.title}
          </h2>

          <FieldGroup>
            {group.rules.map((rule) => {
              // A rule whose parent switch is off is still shown — disabled, not
              // hidden — so the whole rule set stays readable at a glance.
              const parentOff = rule.requires?.some((key) => !state[key]) ?? false;

              if (rule.kind === "switch") {
                return (
                  <SwitchRow
                    key={rule.key}
                    rule={rule}
                    checked={state[rule.key]}
                    disabled={parentOff || pending}
                    onChange={(value) => setSwitchField(rule.key, value)}
                  />
                );
              }

              return (
                <NumberRow
                  key={rule.key}
                  rule={rule}
                  value={state[rule.key]}
                  error={errors[rule.key]}
                  disabled={parentOff || pending}
                  pending={pending}
                  onChange={(value) => setNumberField(rule.key, value)}
                />
              );
            })}
          </FieldGroup>
        </section>
      ))}

      <PreviewCard rules={rulesFromForm(state)} />

      {/* The server's own refusal: a number outside its range, a session that
          expired, a role that changed. Above the button that caused it, in the same
          `Alert` block every admin form uses. */}
      {formError ? (
        <Alert variant="destructive">
          <IconAlertTriangle aria-hidden="true" />
          <AlertTitle>ذخیره نشد</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? (
          <>
            <Spinner aria-hidden="true" />
            در حال ذخیره…
          </>
        ) : (
          <>
            <IconDeviceFloppy aria-hidden="true" />
            ذخیره‌ی تنظیمات
          </>
        )}
      </Button>
    </form>
  );
}

/** One switch rule: the label and its sentence on the reading edge, the switch opposite. */
function SwitchRow({
  rule,
  checked,
  disabled,
  onChange,
}: {
  rule: SwitchRule;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();

  return (
    <Field orientation="horizontal" data-disabled={disabled ? true : undefined}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{rule.label}</FieldLabel>
        <FieldDescription>{rule.sentence}</FieldDescription>
      </FieldContent>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </Field>
  );
}

/**
 * One number rule.
 *
 * The field accepts digits only (Latin or Persian — `toLatinDigits` converts on
 * the way in), so a stray letter never reaches the server, and the range is shown
 * as the placeholder (`۰ تا ۱۶۸`) instead of a second sentence: the manager sees
 * the bound before typing, and the server's sentence names it again if the value
 * misses.
 */
function NumberRow({
  rule,
  value,
  error,
  disabled,
  pending,
  onChange,
}: {
  rule: NumberRule;
  value: string;
  error?: string;
  disabled: boolean;
  pending: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;

  return (
    <Field data-invalid={error ? true : undefined} data-disabled={disabled ? true : undefined}>
      <FieldLabel htmlFor={id}>{rule.label}</FieldLabel>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        value={value}
        // Disabled during a save too: the value that is being written must not
        // change under the request.
        disabled={disabled || pending}
        placeholder={toPersianDigits(`${rule.min} تا ${rule.max}`)}
        aria-invalid={error ? true : undefined}
        aria-describedby={descriptionId}
        onChange={(event) =>
          onChange(event.target.value.replace(/[^0-9۰-۹]/g, "").slice(0, 4))
        }
      />
      {error ? (
        <FieldError id={descriptionId}>{error}</FieldError>
      ) : (
        <FieldDescription id={descriptionId}>{rule.sentence}</FieldDescription>
      )}
    </Field>
  );
}

/**
 * «پیش‌نمایش برای بازیکن‌ها» — the manager reads the rule in the player's own
 * words: the same paragraph the session page prints (`cancelRulesText`).
 */
function PreviewCard({ rules }: { rules: CancelRules }) {
  return (
    <section
      aria-labelledby="settings-preview-heading"
      className="flex flex-col gap-2 rounded-xl bg-surface p-4 shadow-card"
    >
      <h2
        id="settings-preview-heading"
        className="flex items-center gap-1.5 text-h3 text-ink"
      >
        <IconEye aria-hidden="true" className="size-4 shrink-0 text-brand-ink" stroke={1.75} />
        پیش‌نمایش برای بازیکن‌ها
      </h2>
      <p className="text-body leading-relaxed text-ink">{cancelRulesText(rules)}</p>
      <p className="text-caption text-ink-muted">
        این متن عیناً روی صفحه‌ی سانس نشون داده می‌شه.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The rule model
// ---------------------------------------------------------------------------

/** A number the manager edits, stored as text so a half-typed field is harmless. */
type NumberKey =
  | "freeCancelHours"
  | "lateCancelPenaltyDays"
  | "lateCancelWarningWindowDays"
  | "noShowPenaltyDays"
  | "lateThresholdMinutes"
  | "lateStrikeCount"
  | "lateStrikeWindowDays"
  | "lateStrikePenaltyDays";

/** A rule that is on or off — and the parent of the numbers it governs. */
type SwitchKey =
  | "lateCancelEnabled"
  | "lateCancelFirstWarning"
  | "noShowEnabled"
  | "lateStrikesEnabled";

type FormState = Record<NumberKey, string> & Record<SwitchKey, boolean>;

type RuleBase = {
  label: string;
  /** One plain sentence: what this rule means for a player. */
  sentence: string;
  /** The switches this rule hangs on — off while any of them is off. */
  requires?: SwitchKey[];
};

type NumberRule = RuleBase & {
  kind: "number";
  key: NumberKey;
  min: number;
  max: number;
};

type SwitchRule = RuleBase & {
  kind: "switch";
  key: SwitchKey;
};

type Rule = NumberRule | SwitchRule;

type RuleGroup = {
  key: string;
  title: string;
  rules: Rule[];
};

/**
 * The three groups the manager meets on the screen — exactly the three ways a
 * player can lose a seat: cancelling («انصراف»), not showing up («غیبت») and
 * arriving late («تاخیر»). Order inside a group is the order the rules build on
 * each other: the switch first, the numbers it governs right after it.
 */
const GROUPS: readonly RuleGroup[] = [
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
        sentence: "انصراف‌های دیرهنگام این چند روز، برای اخطار بار اول شمرده می‌شن.",
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
        sentence: "تاخیرهای چند روز گذشته شمرده می‌شن.",
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

function isNumberRule(rule: Rule): rule is NumberRule {
  return rule.kind === "number";
}

/** Every number rule, flattened — the submit check walks this and nothing else. */
const NUMBER_RULES: NumberRule[] = GROUPS.flatMap((group) => group.rules).filter(isNumberRule);

/** The stored rules → the form's text/boolean state. */
function toFormState(rules: CancelRules): FormState {
  return {
    freeCancelHours: String(rules.freeCancelHours),
    lateCancelPenaltyDays: String(rules.lateCancelPenaltyDays),
    lateCancelWarningWindowDays: String(rules.lateCancelWarningWindowDays),
    noShowPenaltyDays: String(rules.noShowPenaltyDays),
    lateThresholdMinutes: String(rules.lateThresholdMinutes),
    lateStrikeCount: String(rules.lateStrikeCount),
    lateStrikeWindowDays: String(rules.lateStrikeWindowDays),
    lateStrikePenaltyDays: String(rules.lateStrikePenaltyDays),
    lateCancelEnabled: rules.lateCancelEnabled,
    lateCancelFirstWarning: rules.lateCancelFirstWarning,
    noShowEnabled: rules.noShowEnabled,
    lateStrikesEnabled: rules.lateStrikesEnabled,
  };
}

/**
 * The form's state → a `CancelRules` value, used **both** for the live preview and
 * for the save payload. A field the manager has emptied falls back to the factory
 * default for that key so the preview stays readable; the submit check above
 * refuses an empty field before this can ever be saved.
 */
function rulesFromForm(state: FormState): CancelRules {
  const read = (key: NumberKey): number => {
    const parsed = Number.parseInt(toLatinDigits(state[key]).trim(), 10);
    return Number.isFinite(parsed) ? parsed : DEFAULT_CANCEL_RULES[key];
  };

  return {
    freeCancelHours: read("freeCancelHours"),
    lateCancelEnabled: state.lateCancelEnabled,
    lateCancelPenaltyDays: read("lateCancelPenaltyDays"),
    lateCancelFirstWarning: state.lateCancelFirstWarning,
    lateCancelWarningWindowDays: read("lateCancelWarningWindowDays"),
    noShowEnabled: state.noShowEnabled,
    noShowPenaltyDays: read("noShowPenaltyDays"),
    lateStrikesEnabled: state.lateStrikesEnabled,
    lateThresholdMinutes: read("lateThresholdMinutes"),
    lateStrikeCount: read("lateStrikeCount"),
    lateStrikeWindowDays: read("lateStrikeWindowDays"),
    lateStrikePenaltyDays: read("lateStrikePenaltyDays"),
  };
}
