"use client";

import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconLoader,
} from "@tabler/icons-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toasts sit **above the fixed tab bar** and clear the safe-area inset, so they
 * can never be hidden behind the keyboard or the bottom chrome.
 *
 * The theme is hard-pinned to `light`: the Eitaa mini app ships a fixed light
 * brand chrome (see `DESIGN_SYSTEM.md` §3) and never renders `.dark`, so
 * following the system theme here would only produce unreadable toasts.
 * Success/error use the same tints as badges — colour is never the only cue,
 * every toast also carries an icon and text.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="bottom-center"
      richColors={false}
      closeButton
      offset={{
        bottom: "calc(var(--tab-bar-height) + var(--safe-area-bottom) + 12px)",
      }}
      className="toaster group"
      icons={{
        success: <IconCircleCheck className="size-4" />,
        info: <IconInfoCircle className="size-4" />,
        warning: <IconAlertTriangle className="size-4" />,
        error: <IconAlertOctagon className="size-4" />,
        loading: <IconLoader className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--line-strong)",
          "--success-bg": "var(--success-soft)",
          "--success-text": "var(--success-strong)",
          "--success-border": "var(--success)",
          "--error-bg": "var(--danger-soft)",
          "--error-text": "var(--danger)",
          "--error-border": "var(--danger)",
          "--border-radius": "var(--radius-xl)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "font-sans shadow-pop",
          description: "text-ink-muted",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
