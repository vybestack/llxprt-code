/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { hasDialogRequest } from '../../test-utils/dialogStore.js';
import { renderHook } from '../../test-utils/render.js';
import { useOAuthOrchestration } from './useOAuthOrchestration.js';
import type { AppAction } from '../reducers/appReducer.js';
import {
  createDialogStore,
  type DialogStore,
} from '../stores/dialog/dialogStore.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';

const OAUTH_POLL_MS = 100;

describe('useOAuthOrchestration', () => {
  let appDispatch: React.Dispatch<AppAction>;
  let setAuthError: (error: string | null) => void;
  let store: DialogStore;
  let dialogs: ReturnType<typeof createDialogOpeners>;

  beforeEach(() => {
    vi.useFakeTimers();
    appDispatch = vi.fn();
    setAuthError = vi.fn();
    store = createDialogStore();
    dialogs = createDialogOpeners(store);
    delete (global as Record<string, unknown>).__oauth_needs_code;
    delete (global as Record<string, unknown>).__oauth_provider;
    delete (global as Record<string, unknown>).__oauth_browser_auth_complete;
    delete (global as Record<string, unknown>).__oauth_auth_complete;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (global as Record<string, unknown>).__oauth_needs_code;
    delete (global as Record<string, unknown>).__oauth_provider;
    delete (global as Record<string, unknown>).__oauth_browser_auth_complete;
    delete (global as Record<string, unknown>).__oauth_auth_complete;
  });

  describe('provider guard (Issue #1878)', () => {
    it('does not open the dialog when __oauth_provider differs from active provider', () => {
      const getActiveProviderName = vi.fn().mockReturnValue('codex');
      (global as Record<string, unknown>).__oauth_needs_code = true;
      (global as Record<string, unknown>).__oauth_provider = 'anthropic';

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          dialogs,
          isOAuthCodeDialogOpen: false,
          getActiveProviderName,
          setAuthError,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(appDispatch).not.toHaveBeenCalled();
      expect(hasDialogRequest(store, 'oauthCode')).toBe(false);
      expect((global as Record<string, unknown>).__oauth_needs_code).toBe(true);
    });

    it('opens the dialog and clears flag when pending provider matches active provider', () => {
      const getActiveProviderName = vi.fn().mockReturnValue('anthropic');
      (global as Record<string, unknown>).__oauth_needs_code = true;
      (global as Record<string, unknown>).__oauth_provider = 'anthropic';

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          dialogs,
          isOAuthCodeDialogOpen: false,
          getActiveProviderName,
          setAuthError,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(hasDialogRequest(store, 'oauthCode')).toBe(true);
      expect((global as Record<string, unknown>).__oauth_needs_code).toBe(
        false,
      );
    });

    it('opens the dialog when __oauth_provider is absent (legacy compatibility)', () => {
      const getActiveProviderName = vi.fn().mockReturnValue('codex');
      (global as Record<string, unknown>).__oauth_needs_code = true;

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          dialogs,
          isOAuthCodeDialogOpen: false,
          getActiveProviderName,
          setAuthError,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(hasDialogRequest(store, 'oauthCode')).toBe(true);
      expect((global as Record<string, unknown>).__oauth_needs_code).toBe(
        false,
      );
    });

    it('does not crash when getActiveProviderName throws', () => {
      const getActiveProviderName = vi.fn().mockImplementation(() => {
        throw new Error('runtime not initialized');
      });
      (global as Record<string, unknown>).__oauth_needs_code = true;
      (global as Record<string, unknown>).__oauth_provider = 'anthropic';

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          dialogs,
          isOAuthCodeDialogOpen: false,
          getActiveProviderName,
          setAuthError,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(appDispatch).not.toHaveBeenCalled();
      expect(hasDialogRequest(store, 'oauthCode')).toBe(false);
    });

    it('opens the dialog when getActiveProviderName is not provided (backward compatibility)', () => {
      (global as Record<string, unknown>).__oauth_needs_code = true;
      (global as Record<string, unknown>).__oauth_provider = 'anthropic';

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          dialogs,
          isOAuthCodeDialogOpen: false,
          setAuthError,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(hasDialogRequest(store, 'oauthCode')).toBe(true);
    });
  });

  describe('auto-dismiss on browser auth complete', () => {
    it('closes the dialog when it is open and __oauth_browser_auth_complete is true', () => {
      (global as Record<string, unknown>).__oauth_browser_auth_complete = true;
      dialogs.oauthCode.open({});

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          dialogs,
          isOAuthCodeDialogOpen: true,
          setAuthError,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(hasDialogRequest(store, 'oauthCode')).toBe(false);
    });
  });
});
