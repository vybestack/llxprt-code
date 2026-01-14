/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  appReducer,
  initialAppState,
  type AppState,
  type AppAction,
} from './appReducer.js';
import type { HistoryItem } from '../types.js';

describe('appReducer', () => {
  describe('initial state', () => {
    it('should have correct initial state', () => {
      expect(initialAppState).toEqual({
        openDialogs: {
          theme: false,
          auth: false,
          editor: false,
          provider: false,
          privacy: false,
          loadProfile: false,
          createProfile: false,
          profileList: false,
          profileDetail: false,
          profileEditor: false,
          tools: false,
          oauthCode: false,
        },
        warnings: new Map(),
        errors: {
          theme: null,
          auth: null,
          editor: null,
        },
        lastAddItemAction: null,
      });
    });

    it('should return state unchanged for unknown action', () => {
      const unknownAction = { type: 'UNKNOWN_ACTION' } as unknown as AppAction;
      const result = appReducer(initialAppState, unknownAction);
      expect(result).toBe(initialAppState);
    });
  });

  describe('ADD_ITEM action', () => {
    it('should store the ADD_ITEM action payload in lastAddItemAction', () => {
      const itemData: Omit<HistoryItem, 'id'> = {
        type: 'user',
        text: 'test message',
      };
      const action: AppAction = {
        type: 'ADD_ITEM',
        payload: { itemData, baseTimestamp: 1234567890 },
      };

      const result = appReducer(initialAppState, action);

      expect(result.lastAddItemAction).toEqual({
        itemData,
        baseTimestamp: 1234567890,
      });
      // Ensure other state is unchanged
      expect(result.openDialogs).toBe(initialAppState.openDialogs);
      expect(result.warnings).toBe(initialAppState.warnings);
      expect(result.errors).toBe(initialAppState.errors);
    });

    it('should replace previous lastAddItemAction', () => {
      const firstItem: Omit<HistoryItem, 'id'> = {
        type: 'user',
        text: 'first message',
      };
      const secondItem: Omit<HistoryItem, 'id'> = {
        type: 'gemini',
        text: 'second message',
      };

      const state1 = appReducer(initialAppState, {
        type: 'ADD_ITEM',
        payload: { itemData: firstItem, baseTimestamp: 1000 },
      });

      const state2 = appReducer(state1, {
        type: 'ADD_ITEM',
        payload: { itemData: secondItem, baseTimestamp: 2000 },
      });

      expect(state2.lastAddItemAction).toEqual({
        itemData: secondItem,
        baseTimestamp: 2000,
      });
    });
  });

  describe('OPEN_DIALOG action', () => {
    const dialogTypes = [
      'theme',
      'auth',
      'editor',
      'provider',
      'privacy',
    ] as const;

    dialogTypes.forEach((dialogType) => {
      it(`should open ${dialogType} dialog`, () => {
        const action: AppAction = {
          type: 'OPEN_DIALOG',
          payload: dialogType,
        };

        const result = appReducer(initialAppState, action);

        expect(result.openDialogs[dialogType]).toBe(true);
        // Check all other dialogs remain closed
        const otherDialogs = dialogTypes.filter((t) => t !== dialogType);
        otherDialogs.forEach((otherType) => {
          expect(result.openDialogs[otherType]).toBe(false);
        });
      });
    });

    it('should maintain immutability when opening dialog', () => {
      const action: AppAction = {
        type: 'OPEN_DIALOG',
        payload: 'theme',
      };

      const result = appReducer(initialAppState, action);

      expect(result).not.toBe(initialAppState);
      expect(result.openDialogs).not.toBe(initialAppState.openDialogs);
      expect(result.warnings).toBe(initialAppState.warnings);
      expect(result.errors).toBe(initialAppState.errors);
    });

    it('should allow multiple dialogs to be open', () => {
      let state = initialAppState;

      state = appReducer(state, { type: 'OPEN_DIALOG', payload: 'theme' });
      state = appReducer(state, { type: 'OPEN_DIALOG', payload: 'auth' });
      state = appReducer(state, { type: 'OPEN_DIALOG', payload: 'editor' });

      expect(state.openDialogs.theme).toBe(true);
      expect(state.openDialogs.auth).toBe(true);
      expect(state.openDialogs.editor).toBe(true);
      expect(state.openDialogs.provider).toBe(false);
      expect(state.openDialogs.privacy).toBe(false);
    });
  });

  describe('CLOSE_DIALOG action', () => {
    it('should close an open dialog', () => {
      const stateWithOpenDialog = appReducer(initialAppState, {
        type: 'OPEN_DIALOG',
        payload: 'theme',
      });

      const result = appReducer(stateWithOpenDialog, {
        type: 'CLOSE_DIALOG',
        payload: 'theme',
      });

      expect(result.openDialogs.theme).toBe(false);
    });

    it('should handle closing already closed dialog', () => {
      const result = appReducer(initialAppState, {
        type: 'CLOSE_DIALOG',
        payload: 'theme',
      });

      expect(result.openDialogs.theme).toBe(false);
    });

    it('should maintain immutability when closing dialog', () => {
      const stateWithOpenDialog = appReducer(initialAppState, {
        type: 'OPEN_DIALOG',
        payload: 'theme',
      });

      const result = appReducer(stateWithOpenDialog, {
        type: 'CLOSE_DIALOG',
        payload: 'theme',
      });

      expect(result).not.toBe(stateWithOpenDialog);
      expect(result.openDialogs).not.toBe(stateWithOpenDialog.openDialogs);
    });

    it('should only close the specified dialog', () => {
      let state = initialAppState;
      state = appReducer(state, { type: 'OPEN_DIALOG', payload: 'theme' });
      state = appReducer(state, { type: 'OPEN_DIALOG', payload: 'auth' });
      state = appReducer(state, { type: 'OPEN_DIALOG', payload: 'editor' });

      const result = appReducer(state, {
        type: 'CLOSE_DIALOG',
        payload: 'auth',
      });

      expect(result.openDialogs.theme).toBe(true);
      expect(result.openDialogs.auth).toBe(false);
      expect(result.openDialogs.editor).toBe(true);
    });
  });

  describe('SET_WARNING action', () => {
    it('should add a new warning', () => {
      const action: AppAction = {
        type: 'SET_WARNING',
        payload: { key: 'test-key', message: 'Test warning message' },
      };

      const result = appReducer(initialAppState, action);

      expect(result.warnings.get('test-key')).toBe('Test warning message');
      expect(result.warnings.size).toBe(1);
    });

    it('should overwrite existing warning with same key', () => {
      let state = appReducer(initialAppState, {
        type: 'SET_WARNING',
        payload: { key: 'test-key', message: 'First message' },
      });

      state = appReducer(state, {
        type: 'SET_WARNING',
        payload: { key: 'test-key', message: 'Updated message' },
      });

      expect(state.warnings.get('test-key')).toBe('Updated message');
      expect(state.warnings.size).toBe(1);
    });

    it('should maintain multiple warnings', () => {
      let state = initialAppState;

      state = appReducer(state, {
        type: 'SET_WARNING',
        payload: { key: 'warning1', message: 'First warning' },
      });
      state = appReducer(state, {
        type: 'SET_WARNING',
        payload: { key: 'warning2', message: 'Second warning' },
      });
      state = appReducer(state, {
        type: 'SET_WARNING',
        payload: { key: 'warning3', message: 'Third warning' },
      });

      expect(state.warnings.size).toBe(3);
      expect(state.warnings.get('warning1')).toBe('First warning');
      expect(state.warnings.get('warning2')).toBe('Second warning');
      expect(state.warnings.get('warning3')).toBe('Third warning');
    });

    it('should create a new Map instance (immutability)', () => {
      const action: AppAction = {
        type: 'SET_WARNING',
        payload: { key: 'test-key', message: 'Test warning' },
      };

      const result = appReducer(initialAppState, action);

      expect(result.warnings).not.toBe(initialAppState.warnings);
      expect(result).not.toBe(initialAppState);
    });
  });

  describe('CLEAR_WARNING action', () => {
    it('should remove an existing warning', () => {
      const stateWithWarning = appReducer(initialAppState, {
        type: 'SET_WARNING',
        payload: { key: 'test-key', message: 'Test warning' },
      });

      const result = appReducer(stateWithWarning, {
        type: 'CLEAR_WARNING',
        payload: 'test-key',
      });

      expect(result.warnings.has('test-key')).toBe(false);
      expect(result.warnings.size).toBe(0);
    });

    it('should handle clearing non-existent warning', () => {
      const result = appReducer(initialAppState, {
        type: 'CLEAR_WARNING',
        payload: 'non-existent-key',
      });

      expect(result.warnings.size).toBe(0);
    });

    it('should only clear specified warning', () => {
      let state = initialAppState;
      state = appReducer(state, {
        type: 'SET_WARNING',
        payload: { key: 'warning1', message: 'First warning' },
      });
      state = appReducer(state, {
        type: 'SET_WARNING',
        payload: { key: 'warning2', message: 'Second warning' },
      });

      const result = appReducer(state, {
        type: 'CLEAR_WARNING',
        payload: 'warning1',
      });

      expect(result.warnings.has('warning1')).toBe(false);
      expect(result.warnings.has('warning2')).toBe(true);
      expect(result.warnings.get('warning2')).toBe('Second warning');
      expect(result.warnings.size).toBe(1);
    });

    it('should create a new Map instance (immutability)', () => {
      const stateWithWarning = appReducer(initialAppState, {
        type: 'SET_WARNING',
        payload: { key: 'test-key', message: 'Test warning' },
      });

      const result = appReducer(stateWithWarning, {
        type: 'CLEAR_WARNING',
        payload: 'test-key',
      });

      expect(result.warnings).not.toBe(stateWithWarning.warnings);
      expect(result).not.toBe(stateWithWarning);
    });
  });

  describe('SET_THEME_ERROR action', () => {
    it('should set theme error message', () => {
      const action: AppAction = {
        type: 'SET_THEME_ERROR',
        payload: 'Theme error occurred',
      };

      const result = appReducer(initialAppState, action);

      expect(result.errors.theme).toBe('Theme error occurred');
      expect(result.errors.auth).toBe(null);
      expect(result.errors.editor).toBe(null);
    });

    it('should clear theme error when payload is null', () => {
      const stateWithError = appReducer(initialAppState, {
        type: 'SET_THEME_ERROR',
        payload: 'Theme error',
      });

      const result = appReducer(stateWithError, {
        type: 'SET_THEME_ERROR',
        payload: null,
      });

      expect(result.errors.theme).toBe(null);
    });

    it('should maintain immutability', () => {
      const action: AppAction = {
        type: 'SET_THEME_ERROR',
        payload: 'Theme error',
      };

      const result = appReducer(initialAppState, action);

      expect(result).not.toBe(initialAppState);
      expect(result.errors).not.toBe(initialAppState.errors);
      expect(result.openDialogs).toBe(initialAppState.openDialogs);
      expect(result.warnings).toBe(initialAppState.warnings);
    });
  });

  describe('SET_AUTH_ERROR action', () => {
    it('should set auth error message', () => {
      const action: AppAction = {
        type: 'SET_AUTH_ERROR',
        payload: 'Authentication failed',
      };

      const result = appReducer(initialAppState, action);

      expect(result.errors.auth).toBe('Authentication failed');
      expect(result.errors.theme).toBe(null);
      expect(result.errors.editor).toBe(null);
    });

    it('should clear auth error when payload is null', () => {
      const stateWithError = appReducer(initialAppState, {
        type: 'SET_AUTH_ERROR',
        payload: 'Auth error',
      });

      const result = appReducer(stateWithError, {
        type: 'SET_AUTH_ERROR',
        payload: null,
      });

      expect(result.errors.auth).toBe(null);
    });

    it('should maintain immutability', () => {
      const action: AppAction = {
        type: 'SET_AUTH_ERROR',
        payload: 'Auth error',
      };

      const result = appReducer(initialAppState, action);

      expect(result).not.toBe(initialAppState);
      expect(result.errors).not.toBe(initialAppState.errors);
      expect(result.openDialogs).toBe(initialAppState.openDialogs);
      expect(result.warnings).toBe(initialAppState.warnings);
    });
  });

  describe('SET_EDITOR_ERROR action', () => {
    it('should set editor error message', () => {
      const action: AppAction = {
        type: 'SET_EDITOR_ERROR',
        payload: 'Editor not found',
      };

      const result = appReducer(initialAppState, action);

      expect(result.errors.editor).toBe('Editor not found');
      expect(result.errors.theme).toBe(null);
      expect(result.errors.auth).toBe(null);
    });

    it('should clear editor error when payload is null', () => {
      const stateWithError = appReducer(initialAppState, {
        type: 'SET_EDITOR_ERROR',
        payload: 'Editor error',
      });

      const result = appReducer(stateWithError, {
        type: 'SET_EDITOR_ERROR',
        payload: null,
      });

      expect(result.errors.editor).toBe(null);
    });

    it('should maintain immutability', () => {
      const action: AppAction = {
        type: 'SET_EDITOR_ERROR',
        payload: 'Editor error',
      };

      const result = appReducer(initialAppState, action);

      expect(result).not.toBe(initialAppState);
      expect(result.errors).not.toBe(initialAppState.errors);
      expect(result.openDialogs).toBe(initialAppState.openDialogs);
      expect(result.warnings).toBe(initialAppState.warnings);
    });
  });

  describe('multiple error types', () => {
    it('should handle multiple errors independently', () => {
      let state = initialAppState;

      state = appReducer(state, {
        type: 'SET_THEME_ERROR',
        payload: 'Theme error',
      });
      state = appReducer(state, {
        type: 'SET_AUTH_ERROR',
        payload: 'Auth error',
      });
      state = appReducer(state, {
        type: 'SET_EDITOR_ERROR',
        payload: 'Editor error',
      });

      expect(state.errors.theme).toBe('Theme error');
      expect(state.errors.auth).toBe('Auth error');
      expect(state.errors.editor).toBe('Editor error');

      // Clear one error
      state = appReducer(state, {
        type: 'SET_AUTH_ERROR',
        payload: null,
      });

      expect(state.errors.theme).toBe('Theme error');
      expect(state.errors.auth).toBe(null);
      expect(state.errors.editor).toBe('Editor error');
    });
  });

  describe('complex state changes', () => {
    it('should handle multiple state changes correctly', () => {
      let state = initialAppState;

      // Add item
      state = appReducer(state, {
        type: 'ADD_ITEM',
        payload: {
          itemData: { type: 'user', text: 'test' },
          baseTimestamp: 1000,
        },
      });

      // Open dialogs
      state = appReducer(state, { type: 'OPEN_DIALOG', payload: 'theme' });
      state = appReducer(state, { type: 'OPEN_DIALOG', payload: 'auth' });

      // Set warnings
      state = appReducer(state, {
        type: 'SET_WARNING',
        payload: { key: 'warning1', message: 'First warning' },
      });
      state = appReducer(state, {
        type: 'SET_WARNING',
        payload: { key: 'warning2', message: 'Second warning' },
      });

      // Set errors
      state = appReducer(state, {
        type: 'SET_THEME_ERROR',
        payload: 'Theme error',
      });
      state = appReducer(state, {
        type: 'SET_AUTH_ERROR',
        payload: 'Auth error',
      });

      // Verify complete state
      expect(state.lastAddItemAction).toEqual({
        itemData: { type: 'user', text: 'test' },
        baseTimestamp: 1000,
      });
      expect(state.openDialogs.theme).toBe(true);
      expect(state.openDialogs.auth).toBe(true);
      expect(state.warnings.size).toBe(2);
      expect(state.warnings.get('warning1')).toBe('First warning');
      expect(state.warnings.get('warning2')).toBe('Second warning');
      expect(state.errors.theme).toBe('Theme error');
      expect(state.errors.auth).toBe('Auth error');

      // Close dialog and clear warning
      state = appReducer(state, { type: 'CLOSE_DIALOG', payload: 'theme' });
      state = appReducer(state, { type: 'CLEAR_WARNING', payload: 'warning1' });

      expect(state.openDialogs.theme).toBe(false);
      expect(state.openDialogs.auth).toBe(true);
      expect(state.warnings.size).toBe(1);
      expect(state.warnings.has('warning1')).toBe(false);
      expect(state.warnings.has('warning2')).toBe(true);
    });
  });

  describe('state immutability', () => {
    it('should never mutate the original state', () => {
      const originalState: AppState = {
        openDialogs: {
          theme: false,
          auth: false,
          editor: false,
          provider: false,
          privacy: false,
          loadProfile: false,
          createProfile: false,
          profileList: false,
          profileDetail: false,
          profileEditor: false,
          tools: false,
          oauthCode: false,
        },
        warnings: new Map([['key1', 'value1']]),
        errors: {
          theme: 'existing theme error',
          auth: null,
          editor: null,
        },
        lastAddItemAction: null,
      };

      // Create a deep copy to compare later
      const stateCopy = JSON.parse(
        JSON.stringify({
          openDialogs: originalState.openDialogs,
          warnings: Array.from(originalState.warnings.entries()),
          errors: originalState.errors,
          lastAddItemAction: originalState.lastAddItemAction,
        }),
      );

      // Perform various actions
      appReducer(originalState, { type: 'OPEN_DIALOG', payload: 'theme' });
      appReducer(originalState, {
        type: 'SET_WARNING',
        payload: { key: 'key2', message: 'value2' },
      });
      appReducer(originalState, {
        type: 'SET_THEME_ERROR',
        payload: 'new error',
      });
      appReducer(originalState, {
        type: 'ADD_ITEM',
        payload: {
          itemData: { type: 'user', text: 'test' },
          baseTimestamp: 1000,
        },
      });

      // Verify original state is unchanged
      const stateAfter = {
        openDialogs: originalState.openDialogs,
        warnings: Array.from(originalState.warnings.entries()),
        errors: originalState.errors,
        lastAddItemAction: originalState.lastAddItemAction,
      };

      expect(stateAfter).toEqual(stateCopy);
    });
  });
});
