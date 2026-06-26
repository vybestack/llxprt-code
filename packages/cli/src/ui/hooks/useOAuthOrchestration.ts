/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @hook useOAuthOrchestration
 * @description OAuth flow coordination via global flags
 * @inputs appDispatch, isOAuthCodeDialogOpen, setAuthError
 * @outputs void
 * @sideEffects Interval polling (100ms), dispatch
 * @cleanup Clears intervals on unmount/dialog close
 * @strictMode Safe - intervals cleared on both unmounts
 * @subscriptionStrategy Poll with dedupe
 * @technicalDebt ISSUE-1576-OAUTH-EVENT: Replace with event-driven
 */

import { useEffect } from 'react';
import type { AppAction } from '../reducers/appReducer.js';
import {
  getOAuthGlobalState,
  getPendingOAuthProvider,
} from '../oauthGlobalState.js';

interface UseOAuthOrchestrationOptions {
  appDispatch: React.Dispatch<AppAction>;
  isOAuthCodeDialogOpen: boolean;
  getActiveProviderName?: () => string;
  setAuthError: (error: string | null) => void;
}

function oauthProviderMatchesActive(
  getActiveProviderName: (() => string) | undefined,
): boolean {
  const pendingProvider = getPendingOAuthProvider();
  if (pendingProvider === undefined) {
    return true;
  }
  if (!getActiveProviderName) {
    return true;
  }
  let activeProviderName: string;
  try {
    activeProviderName = getActiveProviderName();
  } catch {
    return false;
  }
  return pendingProvider === activeProviderName;
}

export function useOAuthOrchestration({
  appDispatch,
  isOAuthCodeDialogOpen,
  getActiveProviderName,
  setAuthError,
}: UseOAuthOrchestrationOptions): void {
  useEffect(() => {
    const checkOAuthFlag = setInterval(() => {
      const oauthState = getOAuthGlobalState();
      if (oauthState.__oauth_needs_code === true) {
        if (!oauthProviderMatchesActive(getActiveProviderName)) {
          return;
        }
        oauthState.__oauth_needs_code = false;
        appDispatch({ type: 'OPEN_DIALOG', payload: 'oauthCode' });
      }
    }, 100);

    return () => clearInterval(checkOAuthFlag);
  }, [appDispatch, getActiveProviderName]);

  // Auto-dismiss OAuth dialog when auth completes via browser callback
  // Issue #1404: Dialog should automatically hide after auth completes
  useEffect(() => {
    if (!isOAuthCodeDialogOpen) return undefined;
    // Poll for the browser-auth-success signal (global flag, not React state)
    // This polling approach is necessary because the global flag is set outside React
    const interval = setInterval(() => {
      const oauthState = getOAuthGlobalState();
      if (oauthState.__oauth_browser_auth_complete === true) {
        oauthState.__oauth_browser_auth_complete = false;
        appDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isOAuthCodeDialogOpen, appDispatch]);

  useEffect(() => {
    const interval = setInterval(() => {
      const oauthState = getOAuthGlobalState();
      if (oauthState.__oauth_auth_complete === true) {
        oauthState.__oauth_auth_complete = false;
        setAuthError(null);
        appDispatch({ type: 'SET_AUTH_ERROR', payload: null });
        appDispatch({ type: 'SET_NEEDS_RELOGIN', payload: false });
        appDispatch({ type: 'CLOSE_DIALOG', payload: 'auth' });
        appDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }
    }, 100);
    return () => clearInterval(interval);
  }, [appDispatch, setAuthError]);
}
