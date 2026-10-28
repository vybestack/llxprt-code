/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuthUIBridge } from '@vybestack/llxprt-code-auth';
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('provider guard (Issue #1878)', () => {
    it('does not open the dialog when the requesting provider differs from active provider', () => {
      const getActiveProviderName = vi.fn().mockReturnValue('codex');
      outcomes.requestCode('anthropic');

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          oauth: outcomes,
          dialogs,
          isOAuthCodeDialogOpen: false,
          getActiveProviderName,
          setAuthError,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(appDispatch).not.toHaveBeenCalled();
      expect(hasDialogRequest(store, 'oauthCode')).toBe(false);
      expect(outcomes.getCodeRequest().needsCode).toBe(true);
    });

    it('opens the dialog and clears flag when pending provider matches active provider', () => {
      const getActiveProviderName = vi.fn().mockReturnValue('anthropic');
      outcomes.requestCode('anthropic');

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          oauth: outcomes,
          dialogs,
          isOAuthCodeDialogOpen: false,
          getActiveProviderName,
          setAuthError,
        }),
      );

      vi.advanceTimersByTime(OAUTH_POLL_MS * 3);

      expect(hasDialogRequest(store, 'oauthCode')).toBe(true);
      expect(outcomes.getCodeRequest().needsCode).toBe(false);
    });

    it('does not crash when getActiveProviderName throws', () => {
      const getActiveProviderName = vi.fn().mockImplementation(() => {
        throw new Error('runtime not initialized');
      });
      outcomes.requestCode('anthropic');

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          oauth: outcomes,
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
      outcomes.requestCode('anthropic');

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          oauth: outcomes,
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
      outcomes.beginDialog('persisted-hook-attempt', 'claudecode');
      outcomes.settleDialog('persisted-hook-attempt');
      dialogs.oauthCode.open({});

      renderHook(() =>
        useOAuthOrchestration({
          appDispatch,
          oauth: outcomes,
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
    outcomes.beginDialog('older-claude', 'claudecode');
    outcomes.requestCode('gemini');
    outcomes.clearCodeRequest();
    dialogs.oauthCode.open({});
    renderHook(() =>
      useOAuthOrchestration({
        appDispatch,
        oauth: outcomes,
        dialogs,
        isOAuthCodeDialogOpen: true,
        setAuthError,
      }),
    );
    outcomes.settleDialog('older-claude');
    vi.advanceTimersByTime(OAUTH_POLL_MS * 3);
    expect(hasDialogRequest(store, 'oauthCode')).toBe(true);
  });

  it('preserves Gemini command completion when a Claude Code dialog snapshot remains', () => {
    outcomes.beginDialog('older-claude', 'claudecode');
    outcomes.requestCode('gemini');
    outcomes.clearCodeRequest();
    outcomes.completeAuth();
    dialogs.oauthCode.open({});
    renderHook(() =>
      useOAuthOrchestration({
        appDispatch,
        oauth: outcomes,
        dialogs,
        isOAuthCodeDialogOpen: true,
        setAuthError,
      }),
    );
    vi.advanceTimersByTime(OAUTH_POLL_MS * 3);
    expect(hasDialogRequest(store, 'oauthCode')).toBe(false);
  });
});
