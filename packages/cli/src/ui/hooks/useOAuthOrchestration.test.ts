/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuthUIBridge, oauthUIBridge } from '@vybestack/llxprt-code-auth';
import { hasDialogRequest } from '../../__tests__/dialogStore.js';

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { renderHook } from '../../__tests__/render.js';
import { useOAuthOrchestration } from './useOAuthOrchestration.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';

describe('useOAuthOrchestration', () => {
  let outcomes: OAuthUIBridge;

  beforeEach(() => {
    outcomes = new OAuthUIBridge();
    vi.useFakeTimers();
    delete (global as { __oauth_needs_code?: boolean }).__oauth_needs_code;
  });

  afterEach(() => {
    const attempt = oauthUIBridge.getDialog();
    if (attempt) oauthUIBridge.dismissDialog(attempt.id);
    vi.useRealTimers();
    delete (global as { __oauth_needs_code?: boolean }).__oauth_needs_code;
  });

  it('opens OAuth code dialog when a provider needs a manual code', () => {
    const appDispatch = vi.fn();
    const setAuthError = vi.fn();
    const store = createDialogStore();
    const dialogs = createDialogOpeners(store);

    renderHook(() =>
      useOAuthOrchestration({
        appDispatch,
        takeAuthOutcome: () => outcomes.takeAuthOutcome(),
        dialogs,
        isOAuthCodeDialogOpen: false,
        setAuthError,
      }),
    );

    (global as { __oauth_needs_code?: boolean }).__oauth_needs_code = true;

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(hasDialogRequest(store, 'oauthCode')).toBe(true);
    expect(
      (global as { __oauth_needs_code?: boolean }).__oauth_needs_code,
    ).toBe(false);
  });

  it('clears relogin state and closes auth dialogs when authentication completes', () => {
    const appDispatch = vi.fn();
    const setAuthError = vi.fn();
    const store = createDialogStore();
    const dialogs = createDialogOpeners(store);
    dialogs.auth.open({});
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

    outcomes.completeAuth();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(setAuthError).toHaveBeenCalledWith(null);
    expect(appDispatch).toHaveBeenCalledWith({
      type: 'SET_NEEDS_RELOGIN',
      payload: false,
    });
    expect(hasDialogRequest(store, 'auth')).toBe(false);
    expect(hasDialogRequest(store, 'oauthCode')).toBe(false);
    expect(outcomes.takeAuthOutcome().complete).toBe(false);
  });

  it('closes the code dialog for dialog completion without changing relogin state', () => {
    const appDispatch = vi.fn();
    const setAuthError = vi.fn();
    const store = createDialogStore();
    const dialogs = createDialogOpeners(store);
    dialogs.oauthCode.open({});
    oauthUIBridge.beginDialog('persisted-attempt', 'claudecode');

    renderHook(() =>
      useOAuthOrchestration({
        appDispatch,
        takeAuthOutcome: () => outcomes.takeAuthOutcome(),
        dialogs,
        isOAuthCodeDialogOpen: true,
        setAuthError,
      }),
    );

    oauthUIBridge.settleDialog('persisted-attempt');

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(hasDialogRequest(store, 'oauthCode')).toBe(false);
    expect(setAuthError).not.toHaveBeenCalled();
    expect(appDispatch).not.toHaveBeenCalledWith({
      type: 'SET_NEEDS_RELOGIN',
      payload: false,
    });
  });
  it('keeps terminal dialog failure separate from AuthDialog errors', () => {
    const store = createDialogStore();
    const dialogs = createDialogOpeners(store);
    dialogs.oauthCode.open({});
    const authErrors: Array<string | null> = [];
    const { unmount } = renderHook(() =>
      useOAuthOrchestration({
        appDispatch: () => {},
        takeAuthOutcome: () => outcomes.takeAuthOutcome(),
        dialogs,
        isOAuthCodeDialogOpen: true,
        setAuthError: (error) => {
          authErrors.push(error);
        },
      }),
    );
    try {
      oauthUIBridge.beginDialog('failed-attempt', 'claudecode');
      oauthUIBridge.settleDialog(
        'failed-attempt',
        new Error('Synthetic persistence failure'),
      );
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(hasDialogRequest(store, 'oauthCode')).toBe(true);
      expect(authErrors).toHaveLength(0);
      expect(oauthUIBridge.getDialog()?.status).toBe('failed');
    } finally {
      unmount();
    }
  });

  it('shows each owner its own login outcome when two owners log in concurrently', () => {
    const ownerA = new OAuthUIBridge();
    const ownerB = new OAuthUIBridge();
    const storeA = createDialogStore();
    const storeB = createDialogStore();
    const dialogsA = createDialogOpeners(storeA);
    const dialogsB = createDialogOpeners(storeB);
    dialogsA.auth.open({});
    dialogsB.auth.open({});
    const errorsA: Array<string | null> = [];
    const errorsB: Array<string | null> = [];
    const dispatchB = vi.fn();

    renderHook(() =>
      useOAuthOrchestration({
        appDispatch: () => {},
        takeAuthOutcome: () => ownerA.takeAuthOutcome(),
        dialogs: dialogsA,
        isOAuthCodeDialogOpen: false,
        setAuthError: (error) => {
          errorsA.push(error);
        },
      }),
    );
    renderHook(() =>
      useOAuthOrchestration({
        appDispatch: dispatchB,
        takeAuthOutcome: () => ownerB.takeAuthOutcome(),
        dialogs: dialogsB,
        isOAuthCodeDialogOpen: false,
        setAuthError: (error) => {
          errorsB.push(error);
        },
      }),
    );

    ownerA.failAuth('owner A rejected the code');
    ownerB.completeAuth();
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(errorsA).toStrictEqual(['owner A rejected the code']);
    expect(errorsB).toStrictEqual([null]);
    expect(hasDialogRequest(storeA, 'auth')).toBe(true);
    expect(hasDialogRequest(storeB, 'auth')).toBe(false);
    expect(dispatchB).toHaveBeenCalledWith({
      type: 'SET_NEEDS_RELOGIN',
      payload: false,
    });
  });

  it('does not poll for outcomes when the root has no OAuth manager', () => {
    const appDispatch = vi.fn();
    const setAuthError = vi.fn();
    const dialogs = createDialogOpeners(createDialogStore());

    const { unmount } = renderHook(() =>
      useOAuthOrchestration({
        appDispatch,
        takeAuthOutcome: undefined,
        dialogs,
        isOAuthCodeDialogOpen: false,
        setAuthError,
      }),
    );
    try {
      expect(() => {
        act(() => {
          vi.advanceTimersByTime(300);
        });
      }).not.toThrow();
      expect(setAuthError).not.toHaveBeenCalled();
      expect(appDispatch).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});
