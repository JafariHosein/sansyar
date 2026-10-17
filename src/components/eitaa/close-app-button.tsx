"use client";

import { IconPower } from "@tabler/icons-react";

import { useEitaaRuntime } from "@/components/eitaa/runtime-context";
import { eitaaWebApp, safely } from "@/components/eitaa/sdk";
import { Button } from "@/components/ui/button";

/**
 * «بستن برنامک» — the only way "out" of the mini app.
 *
 * There is deliberately no logout: the identity *is* the Eitaa account, so the
 * honest exit is closing the mini app and letting the messenger take over
 * (PROMPT.md §6.3). Rendered only inside Eitaa, where `close()` exists.
 */
export function CloseAppButton() {
  const { inside } = useEitaaRuntime();
  if (!inside) return null;

  return (
    <Button variant="outline" onClick={() => safely(() => eitaaWebApp()?.close?.())}>
      <IconPower aria-hidden="true" />
      بستن برنامک
    </Button>
  );
}
