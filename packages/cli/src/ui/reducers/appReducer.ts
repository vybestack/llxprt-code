/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HistoryItem } from '../types.js';

export type AppAction =
  | {
      type: 'ADD_ITEM';
      payload: { itemData: Omit<HistoryItem, 'id'>; baseTimestamp: number };
    }
  | {
      type: 'OPEN_DIALOG';
      payload:
        | 'theme'
        | 'auth'
        | 'editor'
        | 'providerModel'
        | 'provider'
        | 'privacy';
    }
  | {
      type: 'CLOSE_DIALOG';
      payload:
        | 'theme'
        | 'auth'
        | 'editor'
        | 'providerModel'
        | 'provider'
        | 'privacy';
    }
  | { type: 'SET_WARNING'; payload: { key: string; message: string } }
  | { type: 'CLEAR_WARNING'; payload: string }
  | { type: 'SET_THEME_ERROR'; payload: string | null }
  | { type: 'SET_AUTH_ERROR'; payload: string | null }
  | { type: 'SET_EDITOR_ERROR'; payload: string | null };

export interface AppState {
  openDialogs: {
    theme: boolean;
    auth: boolean;
    editor: boolean;
    providerModel: boolean;
    provider: boolean;
    privacy: boolean;
  };
  warnings: Map<string, string>;
  errors: {
    theme: string | null;
    auth: string | null;
    editor: string | null;
  };
  lastAddItemAction: {
    itemData: Omit<HistoryItem, 'id'>;
    baseTimestamp: number;
  } | null;
}

export const initialAppState: AppState = {
  openDialogs: {
    theme: false,
    auth: false,
    editor: false,
    providerModel: false,
    provider: false,
    privacy: false,
  },
  warnings: new Map(),
  errors: {
    theme: null,
    auth: null,
    editor: null,
  },
  lastAddItemAction: null,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_ITEM':
      // This action triggers a side effect in SessionController
      return {
        ...state,
        lastAddItemAction: action.payload,
      };

    case 'OPEN_DIALOG':
      return {
        ...state,
        openDialogs: {
          ...state.openDialogs,
          [action.payload]: true,
        },
      };

    case 'CLOSE_DIALOG':
      return {
        ...state,
        openDialogs: {
          ...state.openDialogs,
          [action.payload]: false,
        },
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

    default:
      return state;
  }
}
