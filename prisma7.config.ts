// Prisma CLI configuration (Prisma 7).
//
// In Prisma 7 the CLI no longer reads `package.json#prisma`, and the datasource
// URL lives here rather than in `schema.prisma`. The CLI looks for this exact
// file name — `prisma7.config.ts` — so `prisma db seed` and `migrate dev` can
// coexist with a Prisma 8 setup in the same repo.
import "dotenv/config";

import { defineConfig } from "prisma/config";

import { resolveDatabaseUrl } from "./src/lib/database-url";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Shared with the app (`src/lib/db.ts`): `DATABASE_URL` when set, otherwise
    // composed from the Render Blueprint's `MYSQL_*` variables.
    url: resolveDatabaseUrl(),
  },
});
