/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { renderHook } from '../../test-utils/render.js';
import { useOAuthOrchestration } from './useOAuthOrchestration.js';
import {
  createDialogStore,
  type DialogStore,
} from '../stores/dialog/dialogStore.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';

function hasRequest(store: DialogStore, kind: string): boolean {
  return store.store.getState().requests.some((r) => r.kind === kind);
}

describe('useOAuthOrchestration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (global as { __oauth_needs_code?: boolean }).__oauth_needs_code;
    delete (global as { __oauth_browser_auth_complete?: boolean })
      .__oauth_browser_auth_complete;
    delete (global as { __oauth_auth_complete?: boolean })
      .__oauth_auth_complete;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (global as { __oauth_needs_code?: boolean }).__oauth_needs_code;
    delete (global as { __oauth_browser_auth_complete?: boolean })
      .__oauth_browser_auth_complete;
    delete (global as { __oauth_auth_complete?: boolean })
      .__oauth_auth_complete;
  });

  it('opens OAuth code dialog when a provider needs a manual code', () => {
    const appDispatch = vi.fn();
    const setAuthError = vi.fn();
    const store = createDialogStore();
    const dialogs = createDialogOpeners(store);

    renderHook(() =>
      useOAuthOrchestration({
        appDispatch,
        dialogs,
        isOAuthCodeDialogOpen: false,
        setAuthError,
      }),
    );

    (global as { __oauth_needs_code?: boolean }).__oauth_needs_code = true;

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(hasRequest(store, 'oauthCode')).toBe(true);
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
        dialogs,
        isOAuthCodeDialogOpen: true,
        setAuthError,
      }),
    );

    (global as { __oauth_auth_complete?: boolean }).__oauth_auth_complete =
      true;

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(setAuthError).toHaveBeenCalledWith(null);
    expect(appDispatch).toHaveBeenCalledWith({
      type: 'SET_AUTH_ERROR',
      payload: null,
    });
    expect(appDispatch).toHaveBeenCalledWith({
      type: 'SET_NEEDS_RELOGIN',
      payload: false,
    });
    expect(hasRequest(store, 'auth')).toBe(false);
    expect(hasRequest(store, 'oauthCode')).toBe(false);
    expect(
      (global as { __oauth_auth_complete?: boolean }).__oauth_auth_complete,
    ).toBe(false);
  });

  it('does not clear relogin state for browser callback completion alone', () => {
    const appDispatch = vi.fn();
    const setAuthError = vi.fn();
    const store = createDialogStore();
    const dialogs = createDialogOpeners(store);
    dialogs.oauthCode.open({});

    renderHook(() =>
      useOAuthOrchestration({
        appDispatch,
        dialogs,
        isOAuthCodeDialogOpen: true,
        setAuthError,
      }),
    );

    (
      global as { __oauth_browser_auth_complete?: boolean }
    ).__oauth_browser_auth_complete = true;

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(hasRequest(store, 'oauthCode')).toBe(false);
    expect(setAuthError).not.toHaveBeenCalled();
    expect(appDispatch).not.toHaveBeenCalledWith({
      type: 'SET_NEEDS_RELOGIN',
      payload: false,
    });
  });
});
