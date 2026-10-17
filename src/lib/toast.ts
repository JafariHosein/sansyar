import { toast } from "sonner";

/**
 * Toast helpers.
 *
 * Every server action result goes through here so wording, duration and icon
 * stay consistent across the app (`DESIGN_SYSTEM.md` §10): success 4s, error 6s,
 * always an icon **and** text, never colour alone. Messages are written
 * verb-first and say what happened — they never apologise and never say
 * «لذت ببرید».
 */

/** «ثبت‌نام شدید» — green tint, check icon, 4s. */
export function notifySuccess(message: string, description?: string): void {
  toast.success(message, { description, duration: 4000 });
}

/** «ثبت‌نام نشد؛ ظرفیت پر شد» — red tint, alert icon, 6s (longer to read). */
export function notifyError(message: string, description?: string): void {
  toast.error(message, { description, duration: 6000 });
}

/** Neutral informational message — 4s. */
export function notifyInfo(message: string, description?: string): void {
  toast.info(message, { description, duration: 4000 });
}

/**
 * Pending → resolved wrapper for a server action: shows a spinner toast while
 * the promise is in flight, then replaces it with the outcome. Use it so no
 * action is ever silent.
 */
export function notifyPending(
  pendingMessage: string,
  action: () => Promise<{ ok: true; message?: string } | { ok: false; message: string }>,
): Promise<void> {
  return new Promise((resolve) => {
    const id = toast.loading(pendingMessage, { duration: Infinity });
    void action()
      .then((result) => {
        if (result.ok) {
          toast.success(result.message ?? "انجام شد", { id, duration: 4000 });
        } else {
          toast.error(result.message, { id, duration: 6000 });
        }
      })
      .catch(() => {
        toast.error("ارتباط برقرار نشد؛ یه بار دیگه بزن", { id, duration: 6000 });
      })
      .finally(resolve);
  });
}
