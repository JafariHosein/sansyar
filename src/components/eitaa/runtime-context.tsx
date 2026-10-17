"use client";

import { createContext, useContext } from "react";

import type { SessionUserPayload } from "@/server/actions/results";

/**
 * What the Eitaa bridge knows, shared with the chrome.
 *
 * The tab bar reads `user.role` from here instead of the layout reading the
 * session, which keeps every route's static shell prerenderable (Cache Components)
 * while still showing the manager tab the moment a login completes.
 */
export type EitaaRuntimeState = {
  /** Inside the messenger: the SDK is present and `initData` is non-empty. */
  inside: boolean;
  /** Login is confirmed and app content may be shown. */
  ready: boolean;
  user: SessionUserPayload | null;
  /** Development-only login simulator is available. */
  devEnabled: boolean;
};

const INITIAL: EitaaRuntimeState = {
  inside: false,
  ready: false,
  user: null,
  devEnabled: false,
};

export const EitaaRuntimeContext = createContext<EitaaRuntimeState>(INITIAL);

export function useEitaaRuntime(): EitaaRuntimeState {
  return useContext(EitaaRuntimeContext);
}
