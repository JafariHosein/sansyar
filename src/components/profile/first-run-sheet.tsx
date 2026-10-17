"use client";

import { useEffect, useId, useRef } from "react";

import { Wordmark } from "@/components/brand/wordmark";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The frame of a **blocking first-run sheet** — the phone question and the real
 * name question, in that order.
 *
 * It is a takeover, not a route and not a popover: an opaque full-viewport
 * surface above the app chrome (tab bar `z-40`), with the wordmark, one icon,
 * one sentence and one card. Both sheets share it so the second question reads
 * exactly like the first.
 *
 * **There is deliberately no way out**: no close control, `Escape` does nothing,
 * and the focus trap below keeps `Tab` inside the sheet, because a `Tab` out of
 * an opaque overlay would land on chrome the player cannot see
 * (`DESIGN_SYSTEM.md` §11 — dialogs and sheets trap focus). The only way past a
 * sheet is answering it.
 *
 * Server-render safe: the parent decides whether the sheet exists at all, and
 * that decision is `null` until the client is ready.
 *
 * The title is the `h2` every other dialog uses — the header underneath this
 * overlay already owns the document's `h1` (§11, one `h1` per screen), and
 * `text-h1` here is only its size.
 */
export function FirstRunSheet({
  icon,
  title,
  description,
  children,
}: {
  /** A 28px mark on the soft brand tint — the sheet's one bit of shape. */
  icon: React.ReactNode;
  title: string;
  /** One or two sentences; the reason the sheet is up. */
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(sheetRef);

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 overflow-y-auto bg-page"
    >
      <div className="app-viewport app-column flex flex-col items-center justify-center gap-6 py-10 text-center">
        <Wordmark size="lg" />

        <div className="flex flex-col items-center gap-3">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand-ink">
            {icon}
          </span>
          <h2 id={titleId} className="text-h1 text-ink">
            {title}
          </h2>
          <p className="max-w-md text-caption text-ink-muted">{description}</p>
        </div>

        <Card className="w-full max-w-sm text-start">
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Keeps `Tab` inside the sheet while it is up.
 *
 * `DESIGN_SYSTEM.md` §11 asks every dialog and sheet to trap focus, and this one
 * cannot use Radix's dialog for that — it has no dismiss control and is a
 * full-viewport surface rather than a popover — so the two halves that matter are
 * done by hand: `Tab`/`Shift+Tab` cycle between the sheet's own controls (an
 * unwind lands on the first one), and anything already focused outside is pulled
 * back in. `Escape` deliberately does nothing.
 */
function useFocusTrap(container: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const focusable = () =>
      Array.from(
        container.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;

      const current = document.activeElement as HTMLElement | null;
      if (!current || !container.current?.contains(current)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [container]);
}
