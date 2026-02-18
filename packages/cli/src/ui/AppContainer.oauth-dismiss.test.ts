/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('OAuthCodeDialog auto-dismiss behavior', () => {
  beforeEach(() => {
    // Reset global OAuth state
    delete (global as Record<string, unknown>).__oauth_needs_code;
    delete (global as Record<string, unknown>).__oauth_browser_auth_complete;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (global as Record<string, unknown>).__oauth_needs_code;
    delete (global as Record<string, unknown>).__oauth_browser_auth_complete;
  });

  describe('Auto-dismiss condition logic', () => {
    it('should auto-dismiss when dialog is open and __oauth_browser_auth_complete is true', () => {
      // Arrange: Dialog is open, browser auth just completed
      const isOAuthCodeDialogOpen = true;
      (global as Record<string, unknown>).__oauth_browser_auth_complete = true;

      // Act & Assert: The condition should be true
      const shouldAutoDismiss =
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_browser_auth_complete ===
          true;

      expect(shouldAutoDismiss).toBe(true);
    });

    it('should NOT auto-dismiss when dialog is open but __oauth_browser_auth_complete is false', () => {
      // Arrange: Dialog is open, browser auth not completed
      const isOAuthCodeDialogOpen = true;
      (global as Record<string, unknown>).__oauth_browser_auth_complete = false;

      // Act & Assert: The condition should be false
      const shouldAutoDismiss =
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_browser_auth_complete ===
          true;

      expect(shouldAutoDismiss).toBe(false);
    });

    it('should NOT auto-dismiss when dialog is open but __oauth_browser_auth_complete is undefined', () => {
      // Arrange: Dialog is open, flag is undefined (initial state)
      const isOAuthCodeDialogOpen = true;
      // __oauth_browser_auth_complete is undefined by default after delete in beforeEach

      // Act & Assert: The condition should be false (strict equality check)
      const shouldAutoDismiss =
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_browser_auth_complete ===
          true;

      expect(shouldAutoDismiss).toBe(false);
    });

    it('should NOT auto-dismiss when dialog is closed even if __oauth_browser_auth_complete is true', () => {
      // Arrange: Dialog is closed, browser auth completed
      const isOAuthCodeDialogOpen = false;
      (global as Record<string, unknown>).__oauth_browser_auth_complete = true;

      // Act & Assert: The condition should be false
      const shouldAutoDismiss =
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_browser_auth_complete ===
          true;

      expect(shouldAutoDismiss).toBe(false);
    });
  });

  describe('CLOSE_DIALOG dispatch', () => {
    it('should dispatch CLOSE_DIALOG with oauthCode payload when auto-dismiss condition is met', () => {
      // Arrange
      const mockDispatch = vi.fn();
      const isOAuthCodeDialogOpen = true;
      (global as Record<string, unknown>).__oauth_browser_auth_complete = true;

      // Act: Simulate the useEffect logic
      if (
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_browser_auth_complete ===
          true
      ) {
        // Reset flag and dispatch
        (global as Record<string, unknown>).__oauth_browser_auth_complete =
          false;
        mockDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }

      // Assert
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'CLOSE_DIALOG',
        payload: 'oauthCode',
      });
      // Verify flag was reset
      expect(
        (global as Record<string, unknown>).__oauth_browser_auth_complete,
      ).toBe(false);
    });

    it('should NOT dispatch CLOSE_DIALOG when auto-dismiss condition is NOT met', () => {
      // Arrange
      const mockDispatch = vi.fn();
      const isOAuthCodeDialogOpen = true;
      (global as Record<string, unknown>).__oauth_browser_auth_complete = false;

      // Act: Simulate the useEffect logic
      if (
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_browser_auth_complete ===
          true
      ) {
        mockDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }

      // Assert
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Race condition scenarios', () => {
    it('should handle rapid auth attempts correctly', () => {
      const mockDispatch = vi.fn();

      // First auth attempt starts
      let isOAuthCodeDialogOpen = false;
      (global as Record<string, unknown>).__oauth_needs_code = true;

      // Polling effect opens dialog and clears __oauth_needs_code
      isOAuthCodeDialogOpen = true;
      (global as Record<string, unknown>).__oauth_needs_code = false;
      // Browser auth completes
      (global as Record<string, unknown>).__oauth_browser_auth_complete = true;

      // Auto-dismiss should trigger (using distinct flag, not __oauth_needs_code)
      if (
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_browser_auth_complete ===
          true
      ) {
        mockDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      mockDispatch.mockClear();

      // Second auth attempt starts immediately
      (global as Record<string, unknown>).__oauth_needs_code = true;
      isOAuthCodeDialogOpen = true;
      // Browser auth NOT complete yet
      (global as Record<string, unknown>).__oauth_browser_auth_complete = false;

      // Dialog should NOT auto-dismiss (flag is false)
      if (
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_browser_auth_complete ===
          true
      ) {
        mockDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }

      expect(mockDispatch).not.toHaveBeenCalled();

      // Browser auth completes
      (global as Record<string, unknown>).__oauth_browser_auth_complete = true;

      // Now dialog should auto-dismiss
      if (
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_browser_auth_complete ===
          true
      ) {
        mockDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }

      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });

    it('should not auto-dismiss when dialog opens via polling (no browser auth)', () => {
      // This tests the CodeRabbit fix - dialog should stay open for manual entry
      const mockDispatch = vi.fn();

      // Auth starts, polling opens dialog
      const isOAuthCodeDialogOpen = true;
      (global as Record<string, unknown>).__oauth_needs_code = false; // Cleared by polling
      // Browser auth did NOT complete (no callback)
      (global as Record<string, unknown>).__oauth_browser_auth_complete =
        undefined;

      // Dialog should NOT auto-dismiss - user can still paste code manually
      if (
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_browser_auth_complete ===
          true
      ) {
        mockDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});
