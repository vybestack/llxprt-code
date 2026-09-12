/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type AppAction =
  | { type: 'REFRESH_THEME' }
  | { type: 'SET_NEEDS_RELOGIN'; payload: boolean };

export interface AppState {
  themeRevision: number;
  needsRelogin: boolean;
}

export const initialAppState: AppState = {
  themeRevision: 0,
  needsRelogin: false,
};

/** Relogin gating and explicit invalidation for the singleton theme registry. */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'REFRESH_THEME':
      return { ...state, themeRevision: state.themeRevision + 1 };
    case 'SET_NEEDS_RELOGIN':
      return { ...state, needsRelogin: action.payload };
    default:
      return state;
  }
}
