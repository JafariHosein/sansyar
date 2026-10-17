"use server";

/**
 * Dev-only contact simulator — the sibling of `devLogin` in `dev-auth.ts`.
 *
 * A plain browser has no `requestContact` on the SDK object, so there would be no
 * way to exercise the first-run sheet's primary action at all. This action does
 * **not** shortcut anything: it builds a *real* signed payload with
 * `buildInitData` (the mirror image of the verifier) using the very token the
 * server verifies with, and the client then feeds it straight into
 * `savePhoneFromEitaa` — signature check, freshness, phone extraction, sender
 * check and the database write all run for real.
 *
 * Containment follows `devLogin` exactly:
 *  1. `EITAA_DEV_LOGIN` is false in production by construction (`src/lib/env.ts`).
 *  2. The action re-checks it and refuses before touching anything.
 *  3. The UI that calls it is only rendered when the server said dev login is on.
 */

import { getCurrentUser } from "@/lib/auth";
import { verifyContact } from "@/lib/eitaa-contact";
import { buildInitData } from "@/lib/eitaa-signature";
import { EITAA_BOT_TOKEN, EITAA_DEV_LOGIN } from "@/lib/env";
import { PHONE_ERROR, PhoneSchema } from "@/lib/phone";

/**
 * Sign a contact payload for the signed-in account.
 *
 * The key names are `phone_number` + `user_id` — the first entry of the tolerant
 * lists in `src/lib/eitaa-contact.ts` (Eitaa does not document the real key names,
 * so this is a shape the verifier accepts, not a claim about Eitaa's own string).
 */
export async function devContact(
  phone: string,
): Promise<{ ok: true; payload: string } | { ok: false; error: string }> {
  if (!EITAA_DEV_LOGIN) {
    return { ok: false, error: "شبیه‌ساز شماره در این محیط فعال نیست." };
  }

  const parsed = PhoneSchema.safeParse(phone);
  if (!parsed.success) {
    return { ok: false, error: PHONE_ERROR };
  }

  if (!EITAA_BOT_TOKEN) {
    // Not a formatting problem: with no token the verifier cannot check anything,
    // and signing with some other token would only produce a payload that fails.
    return { ok: false, error: "برنامک ایتا فعال نیست؛ توکن برنامه در سرور تنظیم نشده است." };
  }

  const viewer = await getCurrentUser();
  if (!viewer) {
    return { ok: false, error: "برای شبیه‌سازی شماره باید با حساب ایتا وارد شده باشی." };
  }

  const payload = buildInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      phone_number: parsed.data,
      // The real action compares a requester id with the signed-in account when
      // the payload carries one, so the simulator carries one too — the branch
      // is exercised instead of skipped.
      user_id: viewer.eitaaId,
    },
    EITAA_BOT_TOKEN,
  );

  // The simulator must pass its own verification — signing with a token the
  // verifier does not hold is exactly the bug this catches (`devLogin` does the
  // same for `initData`).
  const selfCheck = verifyContact(payload, EITAA_BOT_TOKEN);
  if (!selfCheck.ok) {
    console.error(`[devContact] the simulator failed its own verification (${selfCheck.reason})`);
    return { ok: false, error: "شبیه‌ساز شماره کار نکرد؛ لاگ سرور را ببین." };
  }

  return { ok: true, payload };
}
