/**
 * Where the database URL comes from — the one place both the app and the Prisma
 * CLI read it from (`src/lib/db.ts` and `prisma7.config.ts`), so they can never
 * point at two different databases.
 *
 * `DATABASE_URL` always wins (local development and `docker-compose.yml` use it).
 * The Render Blueprint wires a **private MySQL service** instead, and Render
 * cannot interpolate a generated secret into another variable — so the service
 * hands the app the five `MYSQL_*` parts (the same names the official MySQL
 * Docker image uses, so one set of values configures both sides) and this module
 * composes the URL.
 *
 * No `server-only` here on purpose: `prisma7.config.ts` is loaded by the Prisma
 * CLI, outside the Next.js server runtime.
 */

/**
 * Resolve the MySQL URL from `DATABASE_URL`, or compose it from `MYSQL_*`.
 *
 * Takes a plain string map (not `NodeJS.ProcessEnv`): the checker feeds it
 * synthetic environments, and in a Next build `ProcessEnv` requires `NODE_ENV`.
 */
export function resolveDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = env.DATABASE_URL?.trim();
  if (explicit) return explicit;

  const host = env.MYSQL_HOST?.trim();
  const user = env.MYSQL_USER?.trim();
  const password = env.MYSQL_PASSWORD;
  const database = env.MYSQL_DATABASE?.trim();
  if (!host || !user || !password || !database) return undefined;

  // Render's `generateValue` secrets are base64 and may contain `+`, `/` and `=`,
  // so every part is percent-encoded. The MariaDB driver percent-decodes the URI
  // when it parses it (node_modules/mariadb/lib/config/connection-options.js) —
  // `npm run check:dburl` pins that round-trip.
  const port = env.MYSQL_PORT?.trim() || "3306";
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}
