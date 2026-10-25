/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuthUIBridge, oauthUIBridge } from '@vybestack/llxprt-code-auth';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { hasDialogRequest } from '../../__tests__/dialogStore.js';
import { renderHook } from '../../__tests__/render.js';
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
  let outcomes: OAuthUIBridge;

  beforeEach(() => {
    outcomes = new OAuthUIBridge();
    vi.useFakeTimers();
    appDispatch = vi.fn();
    setAuthError = vi.fn();
    store = createDialogStore();
    dialogs = createDialogOpeners(store);
    delete (global as Record<string, unknown>).__oauth_needs_code;
    delete (global as Record<string, unknown>).__oauth_provider;
  });

  afterEach(() => {
    const attempt = oauthUIBridge.getDialog();
    if (attempt) oauthUIBridge.dismissDialog(attempt.id);
    vi.useRealTimers();
    delete (global as Record<string, unknown>).__oauth_needs_code;
    delete (global as Record<string, unknown>).__oauth_provider;
  });

  describe('provider guard (Issue #1878)', () => {
    it('does not open the dialog when __oauth_provider differs from active provider', () => {
      const getActiveProviderName = vi.fn().mockReturnValue('codex');
      (global as Record<string, unknown>).__oauth_needs_code = true;
      (global as Record<string, unknown>).__oauth_provider = 'anthropic';

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          takeAuthOutcome: () => outcomes.takeAuthOutcome(),
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
          takeAuthOutcome: () => outcomes.takeAuthOutcome(),
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
          takeAuthOutcome: () => outcomes.takeAuthOutcome(),
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
          takeAuthOutcome: () => outcomes.takeAuthOutcome(),
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
          takeAuthOutcome: () => outcomes.takeAuthOutcome(),
          dialogs,
          isOAuthCodeDialogOpen: false,
          setAuthError,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(hasDialogRequest(store, 'oauthCode')).toBe(true);
    });
  });

  describe('independent dialog attempt completion', () => {
    it('closes the dialog after persisted authentication completes', () => {
      oauthUIBridge.beginDialog('persisted-hook-attempt', 'claudecode');
      oauthUIBridge.settleDialog('persisted-hook-attempt');
      dialogs.oauthCode.open({});

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          takeAuthOutcome: () => outcomes.takeAuthOutcome(),
          dialogs,
          isOAuthCodeDialogOpen: true,
          setAuthError,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(hasDialogRequest(store, 'oauthCode')).toBe(false);
    });
  });
  it('keeps a Gemini code dialog open when an older Claude Code attempt succeeds', () => {
    oauthUIBridge.beginDialog('older-claude', 'claudecode');
    Object.assign(globalThis, { __oauth_provider: 'gemini' });
    dialogs.oauthCode.open({});
    renderHook(() =>
      useOAuthOrchestration({
        appDispatch,
        takeAuthOutcome: () => outcomes.takeAuthOutcome(),
        dialogs,
        isOAuthCodeDialogOpen: true,
        setAuthError,
      }),
    );
    oauthUIBridge.settleDialog('older-claude');
    vi.advanceTimersByTime(OAUTH_POLL_MS * 3);
    expect(hasDialogRequest(store, 'oauthCode')).toBe(true);
  });

  it('preserves Gemini command completion when a Claude Code dialog snapshot remains', () => {
    oauthUIBridge.beginDialog('older-claude', 'claudecode');
    Object.assign(globalThis, {
      __oauth_provider: 'gemini',
    });
    outcomes.completeAuth();
    dialogs.oauthCode.open({});
    renderHook(() =>
      useOAuthOrchestration({
        appDispatch,
        takeAuthOutcome: () => outcomes.takeAuthOutcome(),
        dialogs,
        isOAuthCodeDialogOpen: true,
        setAuthError,
      }),
    );
    vi.advanceTimersByTime(OAUTH_POLL_MS * 3);
    expect(hasDialogRequest(store, 'oauthCode')).toBe(false);
  });
});
