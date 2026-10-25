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
import type { OAuthUIBridge } from '@vybestack/llxprt-code-auth';
import type { AppAction } from '../reducers/appReducer.js';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';

/** The slice of the root's OAuth control this hook reads and acknowledges. */
export type OAuthOrchestrationControl = Pick<
  OAuthUIBridge,
  | 'takeAuthOutcome'
  | 'getCodeRequest'
  | 'clearCodeRequest'
  | 'getDialog'
  | 'dismissDialog'
>;

interface UseOAuthOrchestrationOptions {
  appDispatch: React.Dispatch<AppAction>;
  dialogs: DialogOpeners;
  isOAuthCodeDialogOpen: boolean;
  getActiveProviderName?: () => string;
  /** Undefined only when the root has no OAuth manager, so nothing to poll. */
  oauth: OAuthOrchestrationControl | undefined;
  setAuthError: (error: string | null) => void;
}

function oauthProviderMatchesActive(
  pendingProvider: string | undefined,
  getActiveProviderName: (() => string) | undefined,
): boolean {
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

function hasMatchingDialogAttempt(oauth: OAuthOrchestrationControl): boolean {
  const attempt = oauth.getDialog();
  return (
    attempt !== undefined &&
    (oauth.getCodeRequest().provider ?? attempt.provider) === attempt.provider
  );
}

export function useOAuthOrchestration({
  appDispatch,
  dialogs,
  isOAuthCodeDialogOpen,
  getActiveProviderName,
  oauth,
  setAuthError,
}: UseOAuthOrchestrationOptions): void {
  useEffect(() => {
    if (oauth === undefined) return undefined;
    const checkOAuthFlag = setInterval(() => {
      const request = oauth.getCodeRequest();
      if (request.needsCode) {
        if (
          !oauthProviderMatchesActive(request.provider, getActiveProviderName)
        ) {
          return;
        }
        oauth.clearCodeRequest();
        dialogs.oauthCode.open({});
      }
    }, 100);

    return () => clearInterval(checkOAuthFlag);
  }, [dialogs, getActiveProviderName, oauth]);

  useEffect(() => {
    if (oauth === undefined) return undefined;
    const interval = setInterval(() => {
      const attempt = oauth.getDialog();
      if (
        isOAuthCodeDialogOpen &&
        attempt?.status === 'succeeded' &&
        hasMatchingDialogAttempt(oauth)
      ) {
        dialogs.oauthCode.close();
        oauth.dismissDialog(attempt.id);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [dialogs, isOAuthCodeDialogOpen, oauth]);

  useEffect(() => {
    if (oauth === undefined) return undefined;
    const interval = setInterval(() => {
      const outcome = oauth.takeAuthOutcome();
      if (outcome.error !== undefined && !hasMatchingDialogAttempt(oauth)) {
        setAuthError(outcome.error);
        dialogs.oauthCode.close();
      }
      if (outcome.complete) {
        setAuthError(null);
        appDispatch({ type: 'SET_NEEDS_RELOGIN', payload: false });
        dialogs.auth.close();
        if (!hasMatchingDialogAttempt(oauth)) dialogs.oauthCode.close();
      }
    }, 100);
    return () => clearInterval(interval);
  }, [appDispatch, dialogs, oauth, setAuthError]);
}
