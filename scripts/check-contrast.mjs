#!/usr/bin/env node
/**
 * Contrast checker for the Sansyar palette.
 *
 * Usage: node scripts/check-contrast.mjs
 *
 * WCAG thresholds: body/supporting text >= 4.5, large text (>=24px or >=19px bold)
 * and UI/graphical elements >= 3.0. Every pair below must pass its own column.
 */

const PALETTE = {
  bg: "#F7F8F5",
  surface: "#FFFFFF",
  sunken: "#EDEFE9",
  line: "#DDE2D7", // decorative hairline "court line" — structure, not an affordance
  lineStrong: "#75817A", // control outlines that must be perceivable (>=3:1)
  ink: "#16201B",
  inkMuted: "#56635C",
  brand: "#F5B301", // fill with dark text on top
  brandHover: "#E0A100",
  brandInk: "#8A6100", // amber as *text* / focus ring
  brandMark: "#B57F00", // amber as a *graphical* mark on white (>=3:1)
  brandSoft: "#FFF3D1",
  green: "#157F4A",
  greenStrong: "#0F6339",
  greenSoft: "#E4F4EA",
  red: "#B3261E",
  redSoft: "#FCEBE9",
};

/** name, foreground, background, minimum ratio */
const PAIRS = [
  ["body ink on page bg", "ink", "bg", 4.5],
  ["body ink on card", "ink", "surface", 4.5],
  ["body ink on sunken", "ink", "sunken", 4.5],
  ["muted text on page bg", "inkMuted", "bg", 4.5],
  ["muted text on card", "inkMuted", "surface", 4.5],
  ["muted text on soft brand", "inkMuted", "brandSoft", 4.5],
  ["amber text on card", "brandInk", "surface", 4.5],
  ["amber text on page bg", "brandInk", "bg", 4.5],
  ["amber text on soft brand", "brandInk", "brandSoft", 4.5],
  ["ink on brand yellow (buttons)", "ink", "brand", 4.5],
  ["ink on brand hover", "ink", "brandHover", 4.5],
  ["ink on soft brand", "ink", "brandSoft", 4.5],
  ["green text on card", "green", "surface", 4.5],
  ["green text on bg", "green", "bg", 4.5],
  ["green strong text on green soft", "greenStrong", "greenSoft", 4.5],
  ["white on green (solid button)", "surface", "green", 4.5],
  ["white on green strong", "surface", "greenStrong", 4.5],
  ["red text on card", "red", "surface", 4.5],
  ["red text on red soft", "red", "redSoft", 4.5],
  ["hairline court line vs card (DECORATIVE)", "line", "surface", 1.15],
  ["input outline vs card (UI 3:1)", "lineStrong", "surface", 3.0],
  ["input outline vs page bg (UI 3:1)", "lineStrong", "bg", 3.0],
  ["amber mark vs card (UI 3:1)", "brandMark", "surface", 3.0],
  ["amber mark vs page bg (UI 3:1)", "brandMark", "bg", 3.0],
  ["focus ring on card (UI 3:1)", "brandInk", "surface", 3.0],
  ["brand yellow vs card (fills only, w/ dark text)", "brand", "surface", 1.8],
  ["green vs card (UI 3:1)", "green", "surface", 3.0],
  ["ink vs sunken (UI 3:1)", "ink", "sunken", 3.0],
];

const srgbToLinear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

let failed = 0;
const rows = PAIRS.map(([label, fg, bg, min]) => {
  const value = ratio(PALETTE[fg], PALETTE[bg]);
  const ok = value >= min;
  if (!ok) failed += 1;
  return { ok, label, value, min, fg: PALETTE[fg], bg: PALETTE[bg] };
});

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("PAIR", 42)}${pad("FG", 10)}${pad("BG", 10)}${pad("RATIO", 8)}MIN`);
console.log("-".repeat(78));
for (const r of rows) {
  console.log(
    `${r.ok ? "PASS" : "FAIL"} ${pad(r.label, 37)}${pad(r.fg, 10)}${pad(r.bg, 10)}${pad(
      r.value.toFixed(2),
      8,
    )}${r.min.toFixed(1)}`,
  );
}
console.log("-".repeat(78));
console.log(failed === 0 ? `All ${rows.length} pairs pass.` : `${failed} pair(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
