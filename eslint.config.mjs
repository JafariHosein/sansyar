import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Bundled agent skills are third-party code, not ours to lint.
    ".opencode/**",
    // Prisma generates the client into src/; it ships its own lint pragmas.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
