/**
 * Dev-only tool: print a signed `initData` for the login simulator.
 *
 * Usage (Windows/PowerShell: use `npx.cmd`):
 *   npx.cmd tsx scripts/eitaa-sign-initdata.ts
 *   npx.cmd tsx scripts/eitaa-sign-initdata.ts --id 100000000 --name "مدیر سانس"
 *   npx.cmd tsx scripts/eitaa-sign-initdata.ts --start s_clx1234567890
 *
 * Then paste the printed string into the app's console:
 *   window.__eitaaDebugLogin("<initData>")
 *
 * It uses `@next/env` — the exact loader `next dev` uses — so a value escaped as
 * `\$` in `.env` is read the same way the server reads it. A hand-rolled dotenv
 * read would keep the backslash and sign with a token the server cannot verify.
 */
import { loadEnvConfig } from "@next/env";

import { buildInitData } from "../src/lib/eitaa-signature";

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });

const botToken = process.env.EITAA_BOT_TOKEN?.trim() ?? "";
const devToken = process.env.EITAA_DEV_BOT_TOKEN?.trim() ?? "";
const token = botToken || devToken;

if (!token) {
  console.error(
    "No token available: set EITAA_BOT_TOKEN (or EITAA_DEV_BOT_TOKEN) in .env before using the simulator.",
  );
  process.exit(1);
}

const eitaaId = arg("id") ?? "200000001";
if (!/^\d{1,20}$/.test(eitaaId)) {
  console.error(`--id must be digits only, got "${eitaaId}"`);
  process.exit(1);
}

const name = arg("name") ?? "کاربر آزمایشی";
const startParam = arg("start");

const initData = buildInitData(
  {
    auth_date: String(Math.floor(Date.now() / 1000)),
    chat_type: "private",
    ...(startParam ? { start_param: startParam } : {}),
    user: JSON.stringify({ id: Number(eitaaId), first_name: name, language_code: "fa" }),
  },
  token,
);

console.log(initData);
console.error("");
console.error(`signed with ${botToken ? "EITAA_BOT_TOKEN" : "EITAA_DEV_BOT_TOKEN"} (server-only)`);
console.error(`user.id=${eitaaId} name="${name}"${startParam ? ` start_param=${startParam}` : ""}`);
if (!botToken) {
  console.error(
    "⚠️ EITAA_BOT_TOKEN is empty, so the server action `eitaaLogin` refuses every payload.",
  );
  console.error("   Set EITAA_BOT_TOKEN to use the window.__eitaaDebugLogin() path.");
}
console.error("");
console.error('Paste inside the browser console:  window.__eitaaDebugLogin("<initData>")');
