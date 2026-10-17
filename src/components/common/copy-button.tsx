"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";

import { haptic } from "@/components/eitaa/haptics";
import { Button } from "@/components/ui/button";
import { notifyError, notifySuccess } from "@/lib/toast";

/**
 * Copy-to-clipboard with visible confirmation, used for the Eitaa id (so the
 * manager can paste it into `ADMIN_EITAA_ID`) and later for share messages.
 *
 * The clipboard needs a secure context — HTTPS or localhost — which the mini app
 * always is inside Eitaa.
 */
export function CopyButton({
  value,
  label = "کپی",
  successMessage = "کپی شد",
  size = "sm",
  variant = "outline",
  className,
}: {
  value: string;
  label?: string;
  successMessage?: string;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      haptic("light");
      notifySuccess(successMessage);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      notifyError("کپی نشد", "متن را دستی انتخاب کن و کپی بگیر.");
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => void copy()}
    >
      {copied ? <IconCheck aria-hidden="true" /> : <IconCopy aria-hidden="true" />}
      {copied ? "کپی شد" : label}
    </Button>
  );
}
