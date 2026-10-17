/**
 * Verification for `src/lib/eitaa-signature.ts` (both payload types — `initData`
 * and the contact payload of `WebApp.requestContact`), `src/lib/eitaa-contact.ts`
 * and the deep-link rules in `src/lib/eitaa-link.ts`.
 *
 * Run with `npm run check:eitaa`. Uses `tsx` so it imports the real modules — no
 * duplicated crypto, which is the only way a signature bug stays caught.
 *
 * The centrepiece is Eitaa's **official test vector** from `AuthorizationViaHash`:
 * if the algorithm drifts, this script fails. It also pins the specific
 * misreading that bit us once — feeding the *hex string* of the derived secret
 * in as the second HMAC key, which produces a plausible but wrong mac.
 *
 * There is **no official vector for the contact payload** (Eitaa does not publish
 * the parameter names either), so that group proves what can be proven: the
 * signature/freshness rules are the very same ones, and the phone extraction is
 * tolerant in the documented order.
 */
import { createHmac } from "node:crypto";

import { verifyContact } from "../src/lib/eitaa-contact";
import {
  buildInitData,
  computeInitDataHash,
  verifyInitData,
  verifyInitDataSignature,
} from "../src/lib/eitaa-signature";
import {
  buildAppLink,
  buildBaseLink,
  buildSessionLink,
  parseStartTarget,
  sessionStartParam,
  startParamFromUrl,
  targetPath,
} from "../src/lib/eitaa-link";

let checks = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
  }
}

function group(name: string): void {
  console.log(`\n${name}`);
}

/* ---------------------------------------------------------------- official vector */

const VECTOR_TOKEN = "5768337691:AAGDAe6rjxu1cUgxK4BizYi--Utc3J9v5AU";
const VECTOR_HASH = "c3bb1efcada7b75eec382110554ab07e57622e982a72cac38ba3e64f51d40bb9";
const VECTOR_INIT_DATA =
  "auth_date=1709144340&device_id=5d41402abc4b2a76b9719d911017c592&chat_instance=-3788475317572404878&chat_type=private&user=" +
  "%7B%22id%22%3A279058397%2C%22first_name%22%3A%22%D9%85%D9%87%D8%AF%DB%8C%22%2C%22last_name%22%3A%22%D9%87%D8%A7%D8%B4%D9%85%DB%8C%22%2C%22language_code%22%3A%22fa%22%2C%22allows_write_to_pm%22%3Atrue%7D" +
  `&hash=${VECTOR_HASH}`;

/** The vector's `auth_date`, plus a second, so "now" is just after it. */
const VECTOR_NOW = 1_709_144_340_000 + 1_000;

group("official test vector");
check("signature is valid", verifyInitDataSignature(VECTOR_INIT_DATA, VECTOR_TOKEN), true);
check("mac equals the documented hash", computeInitDataHash(VECTOR_INIT_DATA, VECTOR_TOKEN), VECTOR_HASH);
check("wrong token is rejected", verifyInitDataSignature(VECTOR_INIT_DATA, "123:wrong"), false);
check("empty token is rejected", verifyInitDataSignature(VECTOR_INIT_DATA, ""), false);
check("empty payload is rejected", verifyInitDataSignature("", VECTOR_TOKEN), false);
check("hash is required", verifyInitDataSignature("auth_date=1&user=%7B%7D", VECTOR_TOKEN), false);

group("the hex-key trap (must NOT match the official vector)");
const dataCheckString = [...new URLSearchParams(VECTOR_INIT_DATA).entries()]
  .filter(([key]) => key !== "hash")
  .map(([key, value]) => `${key}=${value}`)
  .sort()
  .join("\n");
const secretAsHex = createHmac("sha256", "WebAppData").update(VECTOR_TOKEN).digest("hex");
const hexKeyMac = createHmac("sha256", secretAsHex).update(dataCheckString).digest("hex");
check("hex-string key produces a different mac", hexKeyMac === VECTOR_HASH, false);
check("our mac is the documented one", computeInitDataHash(VECTOR_INIT_DATA, VECTOR_TOKEN), VECTOR_HASH);

group("verified payload");
const verified = verifyInitData(VECTOR_INIT_DATA, VECTOR_TOKEN, { now: VECTOR_NOW });
check("user id is a string", verified?.user.id, "279058397");
check("Persian name survives decoding", [verified?.user.firstName, verified?.user.lastName], ["مهدی", "هاشمی"]);
check("language code", verified?.user.languageCode, "fa");
check("auth_date", verified?.authDate, 1_709_144_340);
check("start_param is null when absent", verified?.startParam, null);

group("tampering and freshness");
const tampered = VECTOR_INIT_DATA.replace("auth_date=1709144340", "auth_date=1709144341");
check("a tampered value is rejected", verifyInitData(tampered, VECTOR_TOKEN, { now: VECTOR_NOW }), null);
check(
  "a tampered hash is rejected",
  verifyInitData(VECTOR_INIT_DATA.replace(VECTOR_HASH, `0${VECTOR_HASH.slice(1)}`), VECTOR_TOKEN, {
    now: VECTOR_NOW,
  }),
  null,
);
check(
  "25 hours old is too old (default 24h)",
  verifyInitData(VECTOR_INIT_DATA, VECTOR_TOKEN, { now: VECTOR_NOW + 25 * 3_600_000 }),
  null,
);
check(
  "the same payload passes when the age check is off",
  verifyInitData(VECTOR_INIT_DATA, VECTOR_TOKEN, { maxAgeHours: 0, now: VECTOR_NOW + 25 * 3_600_000 }) !== null,
  true,
);
check(
  "dated in the future is rejected",
  verifyInitData(VECTOR_INIT_DATA, VECTOR_TOKEN, { now: VECTOR_NOW - 10 * 60_000 }),
  null,
);
check(
  "future dating is also skipped when the age check is off",
  verifyInitData(VECTOR_INIT_DATA, VECTOR_TOKEN, { maxAgeHours: 0, now: VECTOR_NOW - 10 * 60_000 }) !== null,
  true,
);

group("signer ↔ verifier round-trip (the dev simulator's path)");
const devToken = "12345:DEV-token-$pecial#chars";
const devInitData = buildInitData(
  {
    auth_date: "1709144340",
    chat_type: "private",
    start_param: "s_clx1234567890",
    user: JSON.stringify({ id: 279058397, first_name: "مهدی", last_name: "هاشمی" }),
  },
  devToken,
);
const roundTrip = verifyInitData(devInitData, devToken, { now: VECTOR_NOW });
check("round-trip user id", roundTrip?.user.id, "279058397");
check("round-trip name", [roundTrip?.user.firstName, roundTrip?.user.lastName], ["مهدی", "هاشمی"]);
check("round-trip start_param", roundTrip?.startParam, "s_clx1234567890");
check("round-trip auth_date", roundTrip?.authDate, 1_709_144_340);
check("a different token fails", verifyInitData(devInitData, "12345:other", { now: VECTOR_NOW }), null);
check("a token with $ and # survives", verifyInitData(devInitData, devToken, { now: VECTOR_NOW }) !== null, true);

/* ------------------------------------------------- contact payload (requestContact) */

const CONTACT_TOKEN = "12345:CONTACT-token-$pecial#chars";
/** A fixed clock, so "now" and every `auth_date` below stay deterministic. */
const CONTACT_NOW = 1_760_000_000_000;

function contactPayload(fields: Record<string, string>, at: number = CONTACT_NOW): string {
  return buildInitData({ auth_date: String(Math.floor(at / 1000)), ...fields }, CONTACT_TOKEN);
}

/** The phone the verifier reads, or `!REASON`. */
function contactPhone(raw: string, token: string = CONTACT_TOKEN, now: number = CONTACT_NOW): string {
  const result = verifyContact(raw, token, { now });
  return result.ok ? result.phone : `!${result.reason}`;
}

/** `"ok"` or the refusal reason — for the checks that are not about the number. */
function contactReason(raw: string, token: string = CONTACT_TOKEN, now: number = CONTACT_NOW): string {
  const result = verifyContact(raw, token, { now });
  return result.ok ? "ok" : result.reason;
}

const VALID_CONTACT = contactPayload({ phone_number: "09123456789" });

group("contact payload — signature, freshness, extraction");
check("a signed payload verifies", contactReason(VALID_CONTACT), "ok");
check("+98 912 345 6789 → 09…", contactPhone(contactPayload({ phone_number: "+98 912 345 6789" })), "09123456789");
check("Persian digits → 09…", contactPhone(contactPayload({ phone_number: "۰۹۱۲۳۴۵۶۷۸۹" })), "09123456789");
check("0098 shape → 09…", contactPhone(contactPayload({ phone_number: "00989123456789" })), "09123456789");
check("a bare 9… gets its zero", contactPhone(contactPayload({ phone_number: "9123456789" })), "09123456789");
check("`phone` works as well as `phone_number`", contactPhone(contactPayload({ phone: "0912 345 6789" })), "09123456789");
check(
  "`contact` as a JSON string",
  contactPhone(contactPayload({ contact: JSON.stringify({ phone_number: "09123456789" }) })),
  "09123456789",
);
check("`contact` as a plain value", contactPhone(contactPayload({ contact: "0912-345-6789" })), "09123456789");
check("an undocumented key still yields a number", contactPhone(contactPayload({ mobile: "09123456789" })), "09123456789");
check("the signer ↔ verifier round-trip survives `$` and `#` in the token", contactReason(VALID_CONTACT), "ok");

group("contact payload — refusals");
const tamperedContact = VALID_CONTACT.replace("phone_number=09123456789", "phone_number=09123456788");
check("a tampered value is rejected", contactReason(tamperedContact), "BAD_HASH");
check("the wrong token is rejected", contactReason(VALID_CONTACT, "12345:other"), "BAD_HASH");
check("an empty token is rejected", contactReason(VALID_CONTACT, ""), "BAD_HASH");
check("an empty payload is MISSING", contactReason(""), "MISSING");
check("a payload without a hash is rejected", contactReason("auth_date=1760000000&phone_number=09123456789"), "BAD_HASH");
check(
  "a signed payload with no auth_date is STALE",
  contactReason(buildInitData({ phone_number: "09123456789" }, CONTACT_TOKEN)),
  "STALE",
);
check(
  "25 hours old is too old (same 24h default)",
  contactReason(contactPayload({ phone_number: "09123456789" }, CONTACT_NOW - 25 * 3_600_000)),
  "STALE",
);
check(
  "dated in the future past the 1-minute skew is STALE",
  contactReason(contactPayload({ phone_number: "09123456789" }, CONTACT_NOW + 10 * 60_000)),
  "STALE",
);
check(
  "the age check can be skipped, exactly like initData",
  verifyContact(contactPayload({ phone_number: "09123456789" }, CONTACT_NOW - 25 * 3_600_000), CONTACT_TOKEN, {
    maxAgeHours: 0,
    now: CONTACT_NOW,
  }).ok,
  true,
);
check("verified but no number → NO_PHONE", contactReason(contactPayload({ user_id: "279058397" })), "NO_PHONE");
check(
  "an initData payload carries no contact number",
  contactReason(VECTOR_INIT_DATA, VECTOR_TOKEN, VECTOR_NOW),
  "NO_PHONE",
);
check(
  "a ten-digit id starting with 9 is never taken for a phone",
  contactPhone(contactPayload({ user_id: "9123456789" })),
  "!NO_PHONE",
);

group("contact payload — the sender id");
const withSender = verifyContact(
  contactPayload({ phone_number: "09123456789", user_id: "279058397" }),
  CONTACT_TOKEN,
  { now: CONTACT_NOW },
);
check("`user_id` is returned as the sender", withSender.ok ? withSender.senderEitaaId : "!", "279058397");
const withoutSender = verifyContact(VALID_CONTACT, CONTACT_TOKEN, { now: CONTACT_NOW });
check("no requester id → null", withoutSender.ok ? withoutSender.senderEitaaId : "!", null);
const senderFromUserJson = verifyContact(
  contactPayload({
    phone_number: "09123456789",
    user: JSON.stringify({ id: 279058397, first_name: "مهدی" }),
  }),
  CONTACT_TOKEN,
  { now: CONTACT_NOW },
);
check("`id` inside the `user` JSON is the tolerant fallback", senderFromUserJson.ok ? senderFromUserJson.senderEitaaId : "!", "279058397");
const senderFromContactJson = verifyContact(
  contactPayload({
    phone_number: "09123456789",
    contact: JSON.stringify({ user_id: 279058397, phone_number: "09123456789" }),
  }),
  CONTACT_TOKEN,
  { now: CONTACT_NOW },
);
check(
  "`user_id` inside the `contact` JSON",
  senderFromContactJson.ok ? senderFromContactJson.senderEitaaId : "!",
  "279058397",
);
const bareIdSender = verifyContact(contactPayload({ phone_number: "09123456789", id: "279058397" }), CONTACT_TOKEN, {
  now: CONTACT_NOW,
});
check("a bare top-level `id` is not read as the account", bareIdSender.ok ? bareIdSender.senderEitaaId : "!", null);
check("auth_date comes from the payload", withoutSender.ok ? withoutSender.authDate : 0, Math.floor(CONTACT_NOW / 1000));

group("start params");
check("session prefix", sessionStartParam("clx1234567890"), "s_clx1234567890");
check("known shape maps to a session", parseStartTarget("s_clx1234567890"), {
  kind: "session",
  sessionId: "clx1234567890",
});
check("unknown prefix is ignored", parseStartTarget("promo123"), null);
check("empty session id is ignored", parseStartTarget("s_"), null);
check("illegal characters are ignored", parseStartTarget("s_ab/cd.ef"), null);
check("missing value is ignored", parseStartTarget(null), null);
check("route", targetPath({ kind: "session", sessionId: "clx1234567890" }), "/sessions/clx1234567890");

group("link building (the panel's two-segment app path)");
const panelConfig = { username: "opensansyar", template: "https://eitaa.com/h3in_app/opensansyar?startapp={start}" };
check("base link drops the start param", buildBaseLink(panelConfig), "https://eitaa.com/h3in_app/opensansyar");
check(
  "session link carries s_<id> plus the raw Android button label",
  buildSessionLink(panelConfig, "clx1234567890"),
  "https://eitaa.com/h3in_app/opensansyar?startapp=s_clx1234567890&btn=ثبت‌نام",
);
check(
  "the button label is never percent-encoded",
  buildSessionLink(panelConfig, "abc123")?.includes("%") === false,
  true,
);
check(
  "explicit start param",
  buildAppLink(panelConfig, "s_abc123"),
  "https://eitaa.com/h3in_app/opensansyar?startapp=s_abc123&btn=ثبت‌نام",
);

const usernameOnly = { username: "sansyar", template: null };
check("default template uses the username", buildSessionLink(usernameOnly, "abc123"), "https://eitaa.com/sansyar?startapp=s_abc123&btn=ثبت‌نام");
check("base link without a template override", buildBaseLink(usernameOnly), "https://eitaa.com/sansyar");

const unconfigured = { username: null, template: null };
check("unconfigured app has no link", buildBaseLink(unconfigured), null);
check("unconfigured app has no share link", buildSessionLink(unconfigured, "abc123"), null);

const templateWithoutStart = { username: null, template: "https://example.test/app" };
check(
  "a template without {start} gets the param appended",
  buildAppLink(templateWithoutStart, "s_abc123"),
  "https://example.test/app?startapp=s_abc123&btn=ثبت‌نام",
);

const templateWithButton = { username: null, template: "https://eitaa.com/h3in_app/opensansyar?startapp={start}&btn=نمونه" };
check(
  "a template's own btn label wins (no double btn)",
  buildSessionLink(templateWithButton, "abc123"),
  "https://eitaa.com/h3in_app/opensansyar?startapp=s_abc123&btn=نمونه",
);
check(
  "base link from a btn-carrying template keeps a valid query",
  buildBaseLink(templateWithButton),
  "https://eitaa.com/h3in_app/opensansyar?btn=نمونه",
);

group("start param in the URL (display fallback only)");
check("GET param", startParamFromUrl("?tgWebAppStartParam=s_abc123", ""), "s_abc123");
check("hash params", startParamFromUrl("", "#tgWebAppData=x&tgWebAppStartParam=s_zz1234"), "s_zz1234");
check("no param", startParamFromUrl("", ""), null);
check("unrelated params are ignored", startParamFromUrl("?foo=bar", "#tgWebAppData=x"), null);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
