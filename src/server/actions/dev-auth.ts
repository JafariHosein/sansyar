"use server";

/**
 * Dev-only login simulator (PROMPT.md §13.3).
 *
 * Three layers of containment, because this is the one place that creates a
 * session without a real Eitaa payload:
 *  1. `EITAA_DEV_LOGIN` is false in production by construction (`src/lib/env.ts`).
 *  2. The action re-checks it and refuses before touching anything.
 *  3. The UI that calls it is only rendered when the server says dev login is on.
 *
 * It signs a payload and then verifies it through the *same* functions the real
 * path uses, so a broken algorithm cannot hide behind the simulator.
 */

import { z } from "zod";

import { ADMIN_EITAA_IDS, EITAA_BOT_TOKEN, EITAA_DEV_BOT_TOKEN, EITAA_DEV_LOGIN } from "@/lib/env";
import { buildInitData, verifyInitData } from "@/lib/eitaa-signature";
import { destroySession } from "@/lib/auth";
import { completeLogin } from "@/server/eitaa-login";

import type { EitaaLoginResult } from "./results";

/**
 * The public test token from Eitaa's own documentation. Used only when neither
 * `EITAA_DEV_BOT_TOKEN` nor `EITAA_BOT_TOKEN` is configured, so a fresh clone can
 * still be driven without a registered app.
 */
const DOCS_TEST_TOKEN = "5768337691:AAGDAe6rjxu1cUgxK4BizYi--Utc3J9v5AU";

const DEV_PLAYER_EITAA_ID = "200000001";
const DEV_ADMIN_FALLBACK_ID = "100000000";

const DevLoginSchema = z.object({
  role: z.enum(["USER", "ADMIN"]),
  name: z.string().trim().min(2).max(60).optional(),
  eitaaId: z.string().regex(/^\d{6,20}$/).optional(),
});

export async function devLogin(input: {
  role: "USER" | "ADMIN";
  name?: string;
  eitaaId?: string;
}): Promise<EitaaLoginResult> {
  if (!EITAA_DEV_LOGIN) {
    return { ok: false, error: "ورود آزمایشی در این محیط فعال نیست." };
  }

  const parsed = DevLoginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "ورودی شبیه‌ساز نامعتبر است." };
  }

  const token = EITAA_DEV_BOT_TOKEN || EITAA_BOT_TOKEN || DOCS_TEST_TOKEN;
  const isAdmin = parsed.data.role === "ADMIN";
  const eitaaId =
    parsed.data.eitaaId ?? (isAdmin ? (ADMIN_EITAA_IDS[0] ?? DEV_ADMIN_FALLBACK_ID) : DEV_PLAYER_EITAA_ID);
  const name = parsed.data.name ?? (isAdmin ? "مدیر سانس" : "کاربر آزمایشی");

  const initData = buildInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      chat_type: "private",
      user: JSON.stringify({
        id: Number(eitaaId),
        first_name: name,
        language_code: "fa",
      }),
    },
    token,
  );

  const verified = verifyInitData(initData, token);
  if (!verified) {
    console.error("[devLogin] the simulator failed its own verification");
    return { ok: false, error: "شبیه‌ساز ورود کار نکرد؛ لاگ سرور را ببین." };
  }

  try {
    const user = await completeLogin(verified);
    return { ok: true, user, startParam: null };
  } catch (error) {
    console.error("[devLogin] failed", error);
    return { ok: false, error: "ورود آزمایشی انجام نشد." };
  }
}

/** Dev-only: clear the session so the next reload starts from the gate again. */
export async function devSignOut(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!EITAA_DEV_LOGIN) return { ok: false, error: "ورود آزمایشی در این محیط فعال نیست." };
  await destroySession();
  return { ok: true };
}
