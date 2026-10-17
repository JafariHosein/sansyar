/**
 * Verification for `src/lib/database-url.ts`.
 *
 * Run with `npm run check:dburl`. No database is touched: the composed URL is
 * parsed back and every part compared with what went in, so the one bug that
 * would only show up in production — a double-encode that makes every login
 * fail with no visible cause — fails here instead.
 *
 * The trap this guards: Render's `generateValue` secrets are base64 and may
 * contain `+`, `/` and `=`, so each part of the URL must be percent-encoded —
 * and the MariaDB driver percent-decodes it when connecting (the same recipe
 * Prisma has always used for `DATABASE_URL`).
 */
import { resolveDatabaseUrl } from "../src/lib/database-url";

let failures = 0;
let checks = 0;

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

const HOST = "sansyar-mysql-abc123";
const PASSWORD = "pw+slash/eq=at@colon:";
const COMPOSED = `mysql://sansyar:pw%2Bslash%2Feq%3Dat%40colon%3A@${HOST}:3306/sansyar`;

const base: Record<string, string | undefined> = {
  MYSQL_HOST: HOST,
  MYSQL_PORT: "3306",
  MYSQL_USER: "sansyar",
  MYSQL_PASSWORD: PASSWORD,
  MYSQL_DATABASE: "sansyar",
};

group("DATABASE_URL wins");
check(
  "explicit URL is returned untouched",
  resolveDatabaseUrl({ ...base, DATABASE_URL: "mysql://root:sansyar@127.0.0.1:3306/sansyar" }),
  "mysql://root:sansyar@127.0.0.1:3306/sansyar",
);
check("whitespace-only DATABASE_URL falls through", resolveDatabaseUrl({ ...base, DATABASE_URL: "   " }), COMPOSED);

group("composition from MYSQL_*");
check("composes a mysql:// URL", resolveDatabaseUrl(base), COMPOSED);

const parsed = new URL(String(resolveDatabaseUrl(base)));
check("host survives", parsed.hostname, HOST);
check("port survives", parsed.port, "3306");
check("user round-trips", decodeURIComponent(parsed.username), base.MYSQL_USER);
check("password round-trips", decodeURIComponent(parsed.password), PASSWORD);
check("database round-trips", decodeURIComponent(parsed.pathname.slice(1)), base.MYSQL_DATABASE);

group("port & percent edge cases");
check(
  "a custom port is honored",
  resolveDatabaseUrl({ ...base, MYSQL_PORT: "3310" }),
  COMPOSED.replace(":3306/", ":3310/"),
);
check(
  "port defaults to 3306",
  resolveDatabaseUrl({ ...base, MYSQL_PORT: undefined }),
  COMPOSED,
);
check(
  "a literal % is encoded once",
  resolveDatabaseUrl({ ...base, MYSQL_PASSWORD: "100%pass", MYSQL_PORT: undefined }),
  COMPOSED.replace("pw%2Bslash%2Feq%3Dat%40colon%3A", "100%25pass"),
);

group("incomplete input");
for (const missing of ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"] as const) {
  const env = { ...base, [missing]: undefined };
  check(`missing ${missing} → undefined`, resolveDatabaseUrl(env), undefined);
}
check("empty env → undefined", resolveDatabaseUrl({}), undefined);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
