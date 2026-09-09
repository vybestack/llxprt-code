/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryItem } from '../types.js';

export type AppAction =
  | {
      type: 'ADD_ITEM';
      payload: { itemData: Omit<HistoryItem, 'id'>; baseTimestamp?: number };
    }
  | { type: 'SET_WARNING'; payload: { key: string; message: string } }
  | { type: 'CLEAR_WARNING'; payload: string }
  | { type: 'SET_THEME_ERROR'; payload: string | null }
  | { type: 'SET_AUTH_ERROR'; payload: string | null }
  | { type: 'SET_EDITOR_ERROR'; payload: string | null }
  | { type: 'SET_NEEDS_RELOGIN'; payload: boolean };

export interface AppState {
  warnings: Map<string, string>;
  errors: {
    theme: string | null;
    auth: string | null;
    editor: string | null;
  };
  needsRelogin: boolean;
  lastAddItemAction: {
    itemData: Omit<HistoryItem, 'id'>;
    baseTimestamp?: number;
  } | null;
}

export const initialAppState: AppState = {
  warnings: new Map(),
  errors: {
    theme: null,
    auth: null,
    editor: null,
  },
  needsRelogin: false,
  lastAddItemAction: null,
};

/**
 * App state reducer. Dialog open/close state now lives in the DialogStore
 * (migrated slice B2b); this reducer keeps warnings, error fields, and the
 * relogin flag that SessionController depends on.
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_ITEM':
      // This action triggers a side effect in SessionController
      return {
        ...state,
        lastAddItemAction: action.payload,
      };

    case 'SET_WARNING': {
      const newWarnings = new Map(state.warnings);
      newWarnings.set(action.payload.key, action.payload.message);
      return {
        ...state,
        warnings: newWarnings,
      };
    }

    case 'CLEAR_WARNING': {
      const newWarnings = new Map(state.warnings);
      newWarnings.delete(action.payload);
      return {
        ...state,
        warnings: newWarnings,
      };
    }

    case 'SET_THEME_ERROR':
      return {
        ...state,
        errors: {
          ...state.errors,
          theme: action.payload,
        },
      };

    case 'SET_AUTH_ERROR':
      return {
        ...state,
        errors: {
          ...state.errors,
          auth: action.payload,
        },
      };

    case 'SET_EDITOR_ERROR':
      return {
        ...state,
        errors: {
          ...state.errors,
          editor: action.payload,
        },
      };

    case 'SET_NEEDS_RELOGIN':
      return {
        ...state,
        needsRelogin: action.payload,
      };

    default:
      return state;
  }
}
