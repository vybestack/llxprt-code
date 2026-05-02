/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @hook useOAuthOrchestration
 * @description OAuth flow coordination via global flags
 * @inputs appDispatch, isOAuthCodeDialogOpen
 * @outputs void
 * @sideEffects Interval polling (100ms), dispatch
 * @cleanup Clears interval on unmount/dialog close
 * @strictMode Safe - interval cleared on both unmounts
 * @subscriptionStrategy Poll with dedupe
 * @technicalDebt ISSUE-1576-OAUTH-EVENT: Replace with event-driven
 */

import { useEffect } from 'react';
import type { AppAction } from '../reducers/appReducer.js';

interface UseOAuthOrchestrationOptions {
  appDispatch: React.Dispatch<AppAction>;
  isOAuthCodeDialogOpen: boolean;
}

export function useOAuthOrchestration({
  appDispatch,
  isOAuthCodeDialogOpen,
}: UseOAuthOrchestrationOptions): void {
  // Check for OAuth code needed flag
  useEffect(() => {
    const checkOAuthFlag = setInterval(() => {
      if (
        (global as Record<string, unknown>).__oauth_needs_code === true
      ) {
        // Clear the flag
        (global as Record<string, unknown>).__oauth_needs_code = false;
        // Open the OAuth code dialog
        appDispatch({ type: 'OPEN_DIALOG', payload: 'oauthCode' });
      }
    }, 100); // Check every 100ms

    return () => clearInterval(checkOAuthFlag);
  }, [appDispatch]);

  // Auto-dismiss OAuth dialog when auth completes via browser callback
  // Issue #1404: Dialog should automatically hide after auth completes
  useEffect(() => {
    if (!isOAuthCodeDialogOpen) return;
    // Poll for the browser-auth-success signal (global flag, not React state)
    // This polling approach is necessary because the global flag is set outside React
    const interval = setInterval(() => {
      if (
        (global as Record<string, unknown>).__oauth_browser_auth_complete ===
        true
      ) {
        (global as Record<string, unknown>).__oauth_browser_auth_complete =
          false;
        appDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isOAuthCodeDialogOpen, appDispatch]);
}
