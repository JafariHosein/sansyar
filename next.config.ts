import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  /**
   * Remote development through the tunnel (`cloudflared --url … trycloudflare.com`).
   *
   * Without these two entries the tunnel is unusable and the symptom is silent:
   * the browser loads the HTML (so the splash paints) but every `/_next/*` request
   * carries the public Origin, the dev server answers **403**, no JS ever runs and
   * the screen sits on «در حال ورود…» forever. Server actions are checked the same
   * way — in production too — so without the second entry `eitaaLogin` would be
   * refused behind the tunnel even on a production build. The host to allow is the
   * one in the address bar; cloudflared forwards its own host instead of the public
   * one, which is exactly the mismatch this list exists for.
   * Docs: `next/dist/docs/…/next-config-js/allowedDevOrigins.md` & `serverActions.md`.
   *
   * `127.0.0.1` is here too because tooling may open the dev server by IP while
   * it listens on `localhost`: without the entry the HMR socket and the dev font
   * are refused with cross-origin warnings that look like app bugs in a console
   * check (dev-only switch; production serving is unaffected).
   */
  allowedDevOrigins: ["*.trycloudflare.com", "127.0.0.1"],
  experimental: {
    serverActions: {
      allowedOrigins: ["*.trycloudflare.com"],
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
