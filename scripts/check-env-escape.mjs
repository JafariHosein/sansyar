#!/usr/bin/env node
/**
 * Env escaping checker for Sansyar.
 *
 * Usage: node scripts/check-env-escape.mjs
 *
 * Next.js loads `.env` through dotenv-expand, so a bare `$NAME` inside a value is treated as a
 * variable reference and replaced with "" when NAME is undefined. That silently shortens the
 * value: `EITAA_BOT_TOKEN="...knak$AoKC-D,..."` was loaded 5 characters short (-159 vs 164),
 * which would make every `initData` HMAC comparison fail for no visible reason. Same trap for
 * `SESSION_SECRET`, `DATABASE_URL` passwords and anything else that is not meant to interpolate.
 *
 * Rules per value:
 *   `$NAME`             -> ERROR   (looks like a variable reference; escape it as `\$NAME`)
 *   `${NAME}`           -> WARNING (deliberate interpolation — make sure it is intentional)
 *   `\$NAME`, `$5`, `$-` -> fine   (escaped, or cannot interpolate)
 */

import { existsSync, readFileSync } from "node:fs";

const FILES = [".env", ".env.local", ".env.production", ".env.example"];

const ESCAPED = "\\"; // a backslash consumes the next character
const IDENT_START = /[A-Za-z_]/;
const IDENT_REST = /[A-Za-z0-9_]/;
const IDENT_TRAILING = /[A-Za-z0-9_]/; // dotenv only expands a bare name that ends on a boundary

/** Strip the `export ` prefix and split `NAME=value`; returns null for anything else. */
function parseLine(line) {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;
  const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const eq = body.indexOf("=");
  if (eq < 1) return null;
  const name = body.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
  return { name, raw: body.slice(eq + 1).trim() };
}

/** The part of a value dotenv actually keeps: quoted content, or everything before a ` #` comment. */
function effectiveValue(raw) {
  const quote = raw[0];
  if (quote === '"' || quote === "'") {
    let out = "";
    for (let i = 1; i < raw.length; i += 1) {
      const ch = raw[i];
      if (ch === ESCAPED && quote === '"') {
        out += ch + (raw[i + 1] ?? "");
        i += 1;
        continue;
      }
      if (ch === quote) break; // closing quote — the rest is a trailing comment
      out += ch;
    }
    return out;
  }
  const comment = raw.search(/\s#/);
  return comment === -1 ? raw : raw.slice(0, comment);
}

/** Walk a value and report `$` sequences that dotenv-expand will touch. */
function inspect(value) {
  const bare = [];
  const braced = [];
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === ESCAPED) {
      i += 1; // escaped next character — `\$` is literal, `\\` is a literal backslash
      continue;
    }
    if (value[i] !== "$") continue;

    const next = value[i + 1];
    if (next === "{") {
      const found = /^\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(value.slice(i));
      if (found) braced.push(found[0]);
      continue;
    }
    if (!next || !IDENT_START.test(next)) continue; // `$5`, `$-`, `$ ` cannot interpolate
    let j = i + 2;
    while (j < value.length && IDENT_REST.test(value[j])) j += 1;
    const after = value[j];
    if (after !== undefined && IDENT_TRAILING.test(after)) continue;
    bare.push(value.slice(i, j));
  }
  return { bare, braced };
}

const rows = [];
for (const file of FILES) {
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const parsed = parseLine(line);
    if (!parsed) return;
    const { bare, braced } = inspect(effectiveValue(parsed.raw));
    for (const token of bare) rows.push({ level: "ERROR", file, line: index + 1, name: parsed.name, token });
    for (const token of braced) rows.push({ level: "WARN", file, line: index + 1, name: parsed.name, token });
  });
}

const pad = (s, n) => String(s).padEnd(n);
if (rows.length > 0) {
  console.log(`${pad("LEVEL", 7)}${pad("LOCATION", 20)}${pad("VARIABLE", 24)}TOKEN`);
  console.log("-".repeat(72));
  for (const r of rows) {
    console.log(`${pad(r.level, 7)}${pad(`${r.file}:${r.line}`, 20)}${pad(r.name, 24)}${r.token}`);
  }
  console.log("-".repeat(72));
}
for (const r of rows.filter((r) => r.level === "WARN")) {
  console.log(`note: ${r.file}:${r.line} ${r.name} interpolates ${r.token} — fine if intentional.`);
}

const errors = rows.filter((r) => r.level === "ERROR");
if (errors.length === 0) {
  console.log(`No unescaped $NAME in ${FILES.filter(existsSync).join(", ") || "any env file"}. Env is safe.`);
  process.exit(0);
}
console.log(
  `${errors.length} unescaped $NAME found. dotenv-expand WILL drop it from the loaded value.`,
);
console.log(`Fix: escape the dollar in the env file (\\${errors[0].token}) or drop the value from the file.`);
process.exit(1);
