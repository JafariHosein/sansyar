"use client";

import { useId, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import Link from "next/link";

import { IconAlertTriangle } from "@tabler/icons-react";

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
import { Textarea } from "@/components/ui/textarea";
import { notifyError, notifySuccess } from "@/lib/toast";
import { createVenue, updateVenue } from "@/server/actions/admin-venues";

/**
 * The venue form — one component for «مکان جدید» and «ویرایش مکان».
 *
 * Two states, one shape: without `venueId` it creates a row, with one it updates
 * it. The server action re-validates everything (the input's `maxLength` is only a
 * hint for the keyboard, and `requireAdmin` is re-checked there — never here), so
 * this component owns exactly two things: what the manager sees while typing, and
 * what the toast says afterwards.
 *
 * Field layout follows `rules/forms.md`: `FieldGroup` + `Field`, labels above
 * their controls, the description under them, and `data-invalid` + `aria-invalid`
 * together when the server refuses a value. The two presence checks below are
 * deliberately shallow — the sentences for length, URL shape and the rest live in
 * `src/server/actions/admin-venues.ts`, which is the only gate that counts — but a
 * manager who tapped «ذخیره» with an empty name should not wait for a round trip
 * to hear about it.
 *
 * On success the form navigates back to the list. The action already revalidated
 * `/admin/venues` (and the player-facing screens), so the list the manager lands on
 * is the fresh one — no manual refetch here.
 */
export type VenueFormValues = {
  name: string;
  address: string;
  description: string;
  mapUrl: string;
  isActive: boolean;
};

/** The empty form: signals nothing, teaches the shape of the row. */
const EMPTY_VALUES: VenueFormValues = {
  name: "",
  address: "",
  description: "",
  mapUrl: "",
  isActive: true,
};

export function VenueForm({
  venueId,
  initial,
}: {
  /** The venue being edited. Omit it and the form creates a new one. */
  venueId?: string;
  /** The venue's current values — `VenueListRow`-free strings, ready for inputs. */
  initial?: VenueFormValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState<VenueFormValues>(initial ?? EMPTY_VALUES);
  /** Field errors (presence only) and the server's own refusal — one of them, never both. */
  const [errors, setErrors] = useState<{ name?: string; address?: string; form?: string }>({});
  const [pending, startTransition] = useTransition();
  const nameId = useId();
  const addressId = useId();
  const descriptionId = useId();
  const mapUrlId = useId();
  const activeId = useId();

  function update<K extends keyof VenueFormValues>(key: K, value: VenueFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    // A field that is being retyped is no longer wrong; the next submit decides.
    if (key === "name" || key === "address") setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const missing = {
      name: values.name.trim().length === 0 ? "اسم مکان رو بنویس." : undefined,
      address: values.address.trim().length === 0 ? "آدرس مکان رو بنویس." : undefined,
    };

    if (missing.name || missing.address) {
      haptic("error");
      setErrors(missing);
      return;
    }

    setErrors({});

    startTransition(async () => {
      const payload = {
        name: values.name,
        address: values.address,
        description: values.description,
        mapUrl: values.mapUrl,
        isActive: values.isActive,
      };

      const result = venueId ? await updateVenue(venueId, payload) : await createVenue(payload);

      if (result.ok) {
        haptic("success");
        notifySuccess(
          "مکان ذخیره شد",
          venueId
            ? "تغییرات روی کارت‌ها و صفحه‌ی سانس‌های این مکان نشون داده می‌شه."
            : "از الآن می‌تونی تو فرم سانس انتخابش کنی.",
        );
        router.push("/admin/venues");
        return;
      }

      haptic("error");
      setErrors({ form: result.error });
      notifyError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor={nameId}>
            اسم مکان
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
          </FieldLabel>
          <Input
            id={nameId}
            name="name"
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            maxLength={80}
            required
            autoComplete="off"
            enterKeyHint="next"
            placeholder="مثلاً سالن فوتسال آزادی"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${nameId}-error` : `${nameId}-help`}
          />
          {errors.name ? (
            <FieldError id={`${nameId}-error`}>{errors.name}</FieldError>
          ) : (
            <FieldDescription id={`${nameId}-help`}>
              همین اسم رو بازیکن‌ها روی کارت سانس می‌بینن.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.address ? true : undefined}>
          <FieldLabel htmlFor={addressId}>
            آدرس
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
          </FieldLabel>
          <Input
            id={addressId}
            name="address"
            value={values.address}
            onChange={(event) => update("address", event.target.value)}
            maxLength={200}
            required
            autoComplete="off"
            enterKeyHint="next"
            placeholder="خیابان، کوچه، پلاک"
            aria-invalid={errors.address ? true : undefined}
            aria-describedby={errors.address ? `${addressId}-error` : `${addressId}-help`}
          />
          {errors.address ? (
            <FieldError id={`${addressId}-error`}>{errors.address}</FieldError>
          ) : (
            <FieldDescription id={`${addressId}-help`}>
              آدرس روی صفحه‌ی سانس می‌آد و پایه‌ی دکمه‌ی مسیریابیه.
            </FieldDescription>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor={descriptionId}>توضیح</FieldLabel>
          {/* The stock Textarea drops to 14px at `md`; this copy is player-facing, so
              it keeps the 16px floor of `DESIGN_SYSTEM.md` §4. */}
          <Textarea
            id={descriptionId}
            name="description"
            value={values.description}
            onChange={(event) => update("description", event.target.value)}
            maxLength={500}
            rows={3}
            placeholder="اختیاری — مثلاً پارکینگ، رختکن یا توضیحِ ورودی سالن"
            className="min-h-24 text-base md:text-base"
          />
          <FieldDescription>اختیاری؛ روی صفحه‌ی سانس زیر آدرس نشون داده می‌شه.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor={mapUrlId}>لینک نقشه</FieldLabel>
          {/* A URL is Latin text: `dir="ltr"` keeps «https://» at the start of the
              line instead of letting the RTL paragraph reorder it. */}
          <Input
            id={mapUrlId}
            name="mapUrl"
            type="url"
            inputMode="url"
            dir="ltr"
            value={values.mapUrl}
            onChange={(event) => update("mapUrl", event.target.value)}
            maxLength={300}
            autoComplete="off"
            placeholder="https://neshan.org/maps/share/…"
          />
          <FieldDescription>
            اختیاری — لینک اشتراک نشان؛ بازیکن‌ها با یک تپ مسیریابی می‌کنن. خالی بذاری، دکمه‌ی
            مسیریابی روی همین آدرس جست‌وجو می‌کنه.
          </FieldDescription>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={activeId}>مکان فعال</FieldLabel>
            <FieldDescription>
              مکان‌های غیرفعال تو انتخاب مکانِ سانس‌های تازه نمی‌آن؛ سانس‌هایی که قبلاً ساخته شدن
              سر جاشون می‌مونن.
            </FieldDescription>
          </FieldContent>
          <Switch
            id={activeId}
            name="isActive"
            checked={values.isActive}
            onCheckedChange={(checked) => update("isActive", checked)}
          />
        </Field>
      </FieldGroup>

      {/* The server's own refusal: a bad URL, a value that got too long, a session
          that expired. Above the button that caused it, in the same `Alert` block
          every admin form uses. */}
      {errors.form ? (
        <Alert variant="destructive">
          <IconAlertTriangle aria-hidden="true" />
          <AlertTitle>ذخیره نشد</AlertTitle>
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? (
            <>
              <Spinner aria-hidden="true" />
              در حال ذخیره…
            </>
          ) : (
            "ذخیره‌ی مکان"
          )}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/admin/venues">انصراف</Link>
        </Button>
      </div>
    </form>
  );
}
