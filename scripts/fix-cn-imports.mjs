/**
 * `npx shadcn add <component>` writes `import { cn } from "cn"` — the stock
 * package, which cannot tell our semantic `--text-*` scale (`text-h1`,
 * `text-button`, …) apart from a colour. Using it silently drops the real
 * colour from any class list that also carries a custom font size.
 *
 * This project therefore configures `cn` in `src/lib/utils.ts`. Run this script
 * after adding or re-adding components:
 *
 *   npm.cmd run fix:cn-imports
 *
 * It rewrites every `from "cn"` import under `src/` to `@/lib/utils`.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
/** The configured merger itself legitimately imports from the package. */
const SKIP = join(SRC, "lib", "utils.ts");
const IMPORT = 'from "cn"';
const REPLACEMENT = 'from "@/lib/utils"';

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      yield path;
    }
  }
}

const changed = [];

for await (const file of walk(SRC)) {
  if (file === SKIP) continue;

  const source = await readFile(file, "utf8");
  if (!source.includes(IMPORT)) continue;

  await writeFile(file, source.replaceAll(IMPORT, REPLACEMENT), "utf8");
  changed.push(relative(ROOT, file));
}

if (changed.length === 0) {
  console.log("cn imports: already clean.");
} else {
  console.log(`cn imports: repointed ${changed.length} file(s) to @/lib/utils`);
  for (const file of changed) console.log(`  ${file}`);
}
