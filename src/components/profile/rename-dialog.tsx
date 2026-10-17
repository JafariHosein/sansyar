"use client";

import { useId, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { IconPencil } from "@tabler/icons-react";

import { haptic } from "@/components/eitaa/haptics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { notifyError, notifySuccess } from "@/lib/toast";
import { updateDisplayName } from "@/server/actions/profile";

/**
 * «تغییر نام» — the **display** name the roster shows (PROMPT.md §۶.۳).
 *
 * This is the only name a player may edit, and it is deliberately *not* the real
 * one: `User.firstName` / `lastName` are written once by the first-run sheet and
 * are immutable afterwards (the manager fixes a wrong pair), so the dialog says
 * which name it changes instead of leaving the player to guess.
 *
 * One field, one save. The input's `maxLength` only helps the keyboard; the rule
 * lives in the server action's schema, and the sentence it returns is what this
 * form prints — so the screen can never drift from the rule.
 */
export function RenameDialog({ currentName }: { currentName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setError(null);
    startTransition(async () => {
      const result = await updateDisplayName(name);

      if (result.ok) {
        haptic("success");
        setOpen(false);
        notifySuccess("نامت عوض شد", `از این به بعد «${result.name}» صدات می‌کنیم.`);
        router.refresh();
        return;
      }

      haptic("error");
      setError(result.error);
      if (result.code === "AUTH") {
        notifyError(result.error, "سانس‌یار رو ببند و از ایتا دوباره باز کن.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // A cancelled edit must not leak into the next open.
        if (!next) {
          setName(currentName);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <IconPencil aria-hidden="true" />
          تغییر نام
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>تغییر نام</DialogTitle>
          <DialogDescription>
            همین اسم رو بقیه تو لیست ثبت‌نام هر سانس می‌بینن. نام واقعیت جداست و عوض نمی‌شه.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>نام نمایشی</Label>
            <Input
              id={inputId}
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              enterKeyHint="done"
              maxLength={40}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
            />
            {error ? (
              <p id={`${inputId}-error`} className="text-caption text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                بی‌خیال
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? (
                <>
                  <Spinner aria-hidden="true" />
                  در حال ذخیره…
                </>
              ) : (
                "ذخیره"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
