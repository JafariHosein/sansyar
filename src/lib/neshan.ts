/**
 * «مسیریابی در نشان» — the map link a session page opens.
 *
 * The manager pastes a link into the session form; Neshan offers two shapes and
 * both are handed through untouched:
 *  - a share link: `https://neshan.org/maps/share/35.6997,51.3380`
 *  - the app's short link (`https://nshn.ir/…`), which opens the installed app.
 *
 * When the session has no link, the venue's own link is used next; when neither
 * exists the address is turned into a **search** link, so the button is never
 * dead. That search path is *inferred* — Neshan publishes no link schema, and
 * `/maps/search/<q>` simply serves the web app for any query the way its own
 * search box does. Worth a look on a real device (`AGENTS.md` says the same about
 * the `?startapp=` shape).
 */

/** `https://neshan.org/maps/search/<address>` — the last-resort fallback. */
export function neshanSearchUrl(query: string): string {
  return `https://neshan.org/maps/search/${encodeURIComponent(query.trim())}`;
}
