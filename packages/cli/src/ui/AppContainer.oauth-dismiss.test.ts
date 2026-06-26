/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type GlobalOAuthState = Record<string, unknown> & {
  __oauth_browser_auth_complete?: unknown;
  __oauth_needs_code?: unknown;
};

interface DismissAction {
  type: string;
  payload: string;
}

type DismissDispatch = (action: DismissAction) => void;

const oauthGlobal = global as GlobalOAuthState;

/**
 * Mirror of the AppContainer auto-dismiss guard: the OAuth code dialog should
 * only auto-dismiss when it is open AND the browser auth completion flag is
 * strictly true.
 */
function computeShouldAutoDismiss(isOAuthCodeDialogOpen: boolean): boolean {
  return (
    isOAuthCodeDialogOpen && oauthGlobal.__oauth_browser_auth_complete === true
  );
}

/**
 * Mirror of the AppContainer useEffect body: when the auto-dismiss condition is
 * met, reset the completion flag and dispatch CLOSE_DIALOG for the code dialog.
 */
function runOAuthAutoDismissEffect(
  isOAuthCodeDialogOpen: boolean,
  dispatch: DismissDispatch,
): void {
  if (!computeShouldAutoDismiss(isOAuthCodeDialogOpen)) {
    return;
  }
  oauthGlobal.__oauth_browser_auth_complete = false;
  dispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
}

describe('OAuthCodeDialog auto-dismiss behavior', () => {
  beforeEach(() => {
    // Reset global OAuth state
    delete oauthGlobal.__oauth_needs_code;
    delete oauthGlobal.__oauth_browser_auth_complete;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete oauthGlobal.__oauth_needs_code;
    delete oauthGlobal.__oauth_browser_auth_complete;
  });

  describe('Auto-dismiss condition logic', () => {
    it('should auto-dismiss when dialog is open and __oauth_browser_auth_complete is true', () => {
      // Arrange: Dialog is open, browser auth just completed
      oauthGlobal.__oauth_browser_auth_complete = true;

      // Act & Assert: The condition should be true
      expect(computeShouldAutoDismiss(true)).toBe(true);
    });

    it('should NOT auto-dismiss when dialog is open but __oauth_browser_auth_complete is false', () => {
      // Arrange: Dialog is open, browser auth not completed
      oauthGlobal.__oauth_browser_auth_complete = false;

      // Act & Assert: The condition should be false
      expect(computeShouldAutoDismiss(true)).toBe(false);
    });

    it('should NOT auto-dismiss when dialog is open but __oauth_browser_auth_complete is undefined', () => {
      // Arrange: Dialog is open, flag is undefined (initial state after delete)

      // Act & Assert: The condition should be false (strict equality check)
      expect(computeShouldAutoDismiss(true)).toBe(false);
    });

    it('should NOT auto-dismiss when dialog is closed even if __oauth_browser_auth_complete is true', () => {
      // Arrange: Dialog is closed, browser auth completed
      oauthGlobal.__oauth_browser_auth_complete = true;

      // Act & Assert: The condition should be false
      expect(computeShouldAutoDismiss(false)).toBe(false);
    });
  });

  describe('CLOSE_DIALOG dispatch', () => {
    it('should dispatch CLOSE_DIALOG with oauthCode payload when auto-dismiss condition is met', () => {
      // Arrange
      const mockDispatch = vi.fn();
      oauthGlobal.__oauth_browser_auth_complete = true;

      // Act: Simulate the useEffect logic
      runOAuthAutoDismissEffect(true, mockDispatch);

      // Assert
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'CLOSE_DIALOG',
        payload: 'oauthCode',
      });
      // Verify flag was reset
      expect(oauthGlobal.__oauth_browser_auth_complete).toBe(false);
    });

    it('should NOT dispatch CLOSE_DIALOG when auto-dismiss condition is NOT met', () => {
      // Arrange
      const mockDispatch = vi.fn();
      oauthGlobal.__oauth_browser_auth_complete = false;

      // Act: Simulate the useEffect logic
      runOAuthAutoDismissEffect(true, mockDispatch);

      // Assert
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Race condition scenarios', () => {
    it('should handle rapid auth attempts correctly', () => {
      const mockDispatch = vi.fn();

      // First auth attempt starts
      let isOAuthCodeDialogOpen = false;
      oauthGlobal.__oauth_needs_code = true;

      // Polling effect opens dialog and clears __oauth_needs_code
      isOAuthCodeDialogOpen = true;
      oauthGlobal.__oauth_needs_code = false;
      // Browser auth completes
      oauthGlobal.__oauth_browser_auth_complete = true;

      // Auto-dismiss should trigger (using distinct flag, not __oauth_needs_code)
      runOAuthAutoDismissEffect(isOAuthCodeDialogOpen, mockDispatch);

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      mockDispatch.mockClear();

      // Second auth attempt starts immediately
      oauthGlobal.__oauth_needs_code = true;
      isOAuthCodeDialogOpen = true;
      // Browser auth NOT complete yet
      oauthGlobal.__oauth_browser_auth_complete = false;

      // Dialog should NOT auto-dismiss (flag is false)
      runOAuthAutoDismissEffect(isOAuthCodeDialogOpen, mockDispatch);

      expect(mockDispatch).not.toHaveBeenCalled();

      // Browser auth completes
      oauthGlobal.__oauth_browser_auth_complete = true;

      // Now dialog should auto-dismiss
      runOAuthAutoDismissEffect(isOAuthCodeDialogOpen, mockDispatch);

      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });

    it('should not auto-dismiss when dialog opens via polling (no browser auth)', () => {
      // This tests the CodeRabbit fix - dialog should stay open for manual entry
      const mockDispatch = vi.fn();

      // Auth starts, polling opens dialog
      const isOAuthCodeDialogOpen = true;
      oauthGlobal.__oauth_needs_code = false; // Cleared by polling
      // Browser auth did NOT complete (no callback)
      oauthGlobal.__oauth_browser_auth_complete = undefined;

      // Dialog should NOT auto-dismiss - user can still paste code manually
      runOAuthAutoDismissEffect(isOAuthCodeDialogOpen, mockDispatch);

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});
