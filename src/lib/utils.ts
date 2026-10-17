import { createCn } from "cn/config";

/**
 * `cn` — the project's class merger.
 *
 * `DESIGN_SYSTEM.md` §4 defines a **semantic** type scale (`text-display`,
 * `text-h1`, `text-caption`, `text-numeral`, `text-button`, …) which Tailwind v4
 * turns into real `text-*` utilities from the `--text-*` tokens in
 * `src/app/globals.css`.
 *
 * The stock merge tables only know Tailwind's built-in size names, so they
 * classify our custom names as *colours*. A call such as
 * `cn("text-white", …, "text-button")` then silently dropped `text-white` and
 * rendered ink-on-red (2.6:1). Registering the scale as a `font-size` class
 * group is what makes type + colour safe to combine anywhere in the app —
 * including in components added later by `npx shadcn add`.
 *
 * Adding a `--text-*` token in `globals.css` without adding its name here
 * reintroduces that bug, so the two lists are kept side by side on purpose.
 */
const TYPE_SCALE = [
  "display",
  "h1",
  "h2",
  "h3",
  "body",
  "body-lg",
  "caption",
  "button",
  "numeral",
] as const;

export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TYPE_SCALE] }],
    },
  },
});

export type { ClassValue } from "cn";
