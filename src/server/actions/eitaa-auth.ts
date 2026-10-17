"use server";

/**
 * The single login path (PROMPT.md §13.3): the client bridge posts the raw
 * `initData` from Eitaa, the server verifies it and sets a signed cookie.
 *
 * Idempotent by design — Eitaa's developer rules require a preload login on every
 * app open, so this runs each time and must never fail for a healthy session.
 */

import { z } from "zod";

import { eitaaConfigured, verifyEitaaInitData } from "@/lib/eitaa";
import { completeLogin } from "@/server/eitaa-login";

import type { EitaaLoginResult } from "./results";

/** Eitaa payloads are a few hundred bytes; anything huge is not ours. */
const InitDataSchema = z.string().min(1).max(8192);

export async function eitaaLogin(initData: string): Promise<EitaaLoginResult> {
  const parsed = InitDataSchema.safeParse(initData);
  if (!parsed.success) {
    return { ok: false, error: "اطلاعات ورود ناخوانا بود؛ برنامک را دوباره باز کن." };
  }

  if (!eitaaConfigured()) {
    // The player only sees the outcome; the operator finds the missing env value
    // in the server log. This refusal feeds the gate's «ورودت تأیید نشد» story, so
    // the sentence stays in the app's own voice instead of naming server settings.
    console.error("[eitaaLogin] eitaaConfigured() is false — bot token or app username missing");
    return { ok: false, error: "برنامک الان در دسترس نیست — یک‌بار دیگه امتحان کن." };
  }

  const verified = verifyEitaaInitData(parsed.data);
  if (!verified) {
    return { ok: false, error: "ورود از ایتا تأیید نشد؛ سانس‌یار را از داخل ایتا باز کن." };
  }

  try {
    const user = await completeLogin(verified);
    return { ok: true, user, startParam: verified.startParam };
  } catch (error) {
    console.error("[eitaaLogin] failed", error);
    return { ok: false, error: "ورود انجام نشد؛ دوباره تلاش کن." };
  }
}
