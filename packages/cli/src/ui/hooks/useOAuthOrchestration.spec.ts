/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { useOAuthOrchestration } from './useOAuthOrchestration.js';
import type { AppAction } from '../reducers/appReducer.js';

const OAUTH_POLL_MS = 100;

describe('useOAuthOrchestration', () => {
  let appDispatch: React.Dispatch<AppAction>;

  beforeEach(() => {
    vi.useFakeTimers();
    appDispatch = vi.fn();
    delete (global as Record<string, unknown>).__oauth_needs_code;
    delete (global as Record<string, unknown>).__oauth_provider;
    delete (global as Record<string, unknown>).__oauth_browser_auth_complete;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (global as Record<string, unknown>).__oauth_needs_code;
    delete (global as Record<string, unknown>).__oauth_provider;
    delete (global as Record<string, unknown>).__oauth_browser_auth_complete;
  });

  describe('provider guard (Issue #1878)', () => {
    it('does not dispatch OPEN_DIALOG when __oauth_provider differs from active provider', () => {
      const getActiveProviderName = vi.fn().mockReturnValue('codex');
      (global as Record<string, unknown>).__oauth_needs_code = true;
      (global as Record<string, unknown>).__oauth_provider = 'anthropic';

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          isOAuthCodeDialogOpen: false,
          getActiveProviderName,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(appDispatch).not.toHaveBeenCalled();
      expect((global as Record<string, unknown>).__oauth_needs_code).toBe(true);
    });

    it('dispatches OPEN_DIALOG and clears flag when pending provider matches active provider', () => {
      const getActiveProviderName = vi.fn().mockReturnValue('anthropic');
      (global as Record<string, unknown>).__oauth_needs_code = true;
      (global as Record<string, unknown>).__oauth_provider = 'anthropic';

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          isOAuthCodeDialogOpen: false,
          getActiveProviderName,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(appDispatch).toHaveBeenCalledWith({
        type: 'OPEN_DIALOG',
        payload: 'oauthCode',
      });
      expect((global as Record<string, unknown>).__oauth_needs_code).toBe(
        false,
      );
    });

    it('dispatches OPEN_DIALOG when __oauth_provider is absent (legacy compatibility)', () => {
      const getActiveProviderName = vi.fn().mockReturnValue('codex');
      (global as Record<string, unknown>).__oauth_needs_code = true;

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          isOAuthCodeDialogOpen: false,
          getActiveProviderName,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(appDispatch).toHaveBeenCalledWith({
        type: 'OPEN_DIALOG',
        payload: 'oauthCode',
      });
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
          isOAuthCodeDialogOpen: false,
          getActiveProviderName,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(appDispatch).not.toHaveBeenCalled();
    });

    it('dispatches OPEN_DIALOG when getActiveProviderName is not provided (backward compatibility)', () => {
      (global as Record<string, unknown>).__oauth_needs_code = true;
      (global as Record<string, unknown>).__oauth_provider = 'anthropic';

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          isOAuthCodeDialogOpen: false,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(appDispatch).toHaveBeenCalledWith({
        type: 'OPEN_DIALOG',
        payload: 'oauthCode',
      });
    });
  });

  describe('auto-dismiss on browser auth complete', () => {
    it('dispatches CLOSE_DIALOG when dialog is open and __oauth_browser_auth_complete is true', () => {
      (global as Record<string, unknown>).__oauth_browser_auth_complete = true;

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          isOAuthCodeDialogOpen: true,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(appDispatch).toHaveBeenCalledWith({
        type: 'CLOSE_DIALOG',
        payload: 'oauthCode',
      });
    });
  });
});
