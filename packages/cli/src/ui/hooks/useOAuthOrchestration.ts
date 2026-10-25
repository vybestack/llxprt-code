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
import {
  oauthUIBridge,
  type OAuthAuthOutcome,
} from '@vybestack/llxprt-code-auth';
import type { AppAction } from '../reducers/appReducer.js';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';
import {
  getOAuthGlobalState,
  getPendingOAuthProvider,
} from '../oauthGlobalState.js';

interface UseOAuthOrchestrationOptions {
  appDispatch: React.Dispatch<AppAction>;
  dialogs: DialogOpeners;
  isOAuthCodeDialogOpen: boolean;
  getActiveProviderName?: () => string;
  /** Undefined only when the root has no OAuth manager, so nothing to poll. */
  takeAuthOutcome: (() => OAuthAuthOutcome) | undefined;
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

function hasMatchingDialogAttempt(): boolean {
  const attempt = oauthUIBridge.getDialog();
  return (
    attempt !== undefined &&
    (getPendingOAuthProvider() ?? attempt.provider) === attempt.provider
  );
}

export function useOAuthOrchestration({
  appDispatch,
  dialogs,
  isOAuthCodeDialogOpen,
  getActiveProviderName,
  takeAuthOutcome,
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
        dialogs.oauthCode.open({});
      }
    }, 100);

    return () => clearInterval(checkOAuthFlag);
  }, [dialogs, getActiveProviderName]);

  useEffect(() => {
    const interval = setInterval(() => {
      const attempt = oauthUIBridge.getDialog();
      if (
        isOAuthCodeDialogOpen &&
        attempt?.status === 'succeeded' &&
        hasMatchingDialogAttempt()
      ) {
        dialogs.oauthCode.close();
        oauthUIBridge.dismissDialog(attempt.id);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [dialogs, isOAuthCodeDialogOpen]);

  useEffect(() => {
    if (takeAuthOutcome === undefined) return undefined;
    const interval = setInterval(() => {
      const outcome = takeAuthOutcome();
      if (outcome.error !== undefined && !hasMatchingDialogAttempt()) {
        setAuthError(outcome.error);
        dialogs.oauthCode.close();
      }
      if (outcome.complete) {
        setAuthError(null);
        appDispatch({ type: 'SET_NEEDS_RELOGIN', payload: false });
        dialogs.auth.close();
        if (!hasMatchingDialogAttempt()) dialogs.oauthCode.close();
      }
    }, 100);
    return () => clearInterval(interval);
  }, [appDispatch, dialogs, setAuthError, takeAuthOutcome]);
}
