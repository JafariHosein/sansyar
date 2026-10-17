import "server-only";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * The single Prisma client for this process.
 *
 * Prisma 7 carries no query engine of its own: the client **must** be given a
 * driver adapter, otherwise construction throws. `@prisma/adapter-mariadb`
 * speaks the MySQL wire protocol, so it serves MySQL 8 and MariaDB alike.
 *
 * The adapter takes either a driver pool config object or a connection URI. We
 * hand it the URI so `DATABASE_URL` stays the one place the database is
 * described — the same value drives the Prisma CLI (`prisma7.config.ts`) and the
 * running app, so they can never point at two different databases.
 *
 * Note: pool sizing is driver-side. `PrismaMariadbOptions` has no
 * `connectionLimit` (the Prisma 6 query parameter of the same name is gone too),
 * so the driver's default pool limit applies.
 */
function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env and fill it in.");
  }

  return new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });
}

type PrismaClientInstance = ReturnType<typeof createPrismaClient>;

// Next.js re-evaluates server modules on every edit in development. Without
// this cache each reload would open a fresh pool and MySQL would run out of
// connections; in production the module is evaluated once anyway.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClientInstance };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
