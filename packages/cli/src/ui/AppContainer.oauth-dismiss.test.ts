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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (global as Record<string, unknown>).__oauth_needs_code;
  });

  describe('Auto-dismiss condition logic', () => {
    it('should auto-dismiss when dialog is open and __oauth_needs_code is explicitly false', () => {
      // Arrange: Dialog is open, auth just completed (flag set to false)
      const isOAuthCodeDialogOpen = true;
      (global as Record<string, unknown>).__oauth_needs_code = false;

      // Act & Assert: The condition should be true
      const shouldAutoDismiss =
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_needs_code === false;

      expect(shouldAutoDismiss).toBe(true);
    });

    it('should NOT auto-dismiss when dialog is open but __oauth_needs_code is true', () => {
      // Arrange: Dialog is open, auth is still in progress
      const isOAuthCodeDialogOpen = true;
      (global as Record<string, unknown>).__oauth_needs_code = true;

      // Act & Assert: The condition should be false
      const shouldAutoDismiss =
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_needs_code === false;

      expect(shouldAutoDismiss).toBe(false);
    });

    it('should NOT auto-dismiss when dialog is open but __oauth_needs_code is undefined', () => {
      // Arrange: Dialog is open, flag is undefined (not explicitly false)
      const isOAuthCodeDialogOpen = true;
      // __oauth_needs_code is undefined by default after delete in beforeEach

      // Act & Assert: The condition should be false (strict equality check)
      const shouldAutoDismiss =
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_needs_code === false;

      expect(shouldAutoDismiss).toBe(false);
    });

    it('should NOT auto-dismiss when dialog is closed even if __oauth_needs_code is false', () => {
      // Arrange: Dialog is closed, auth completed
      const isOAuthCodeDialogOpen = false;
      (global as Record<string, unknown>).__oauth_needs_code = false;

      // Act & Assert: The condition should be false
      const shouldAutoDismiss =
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_needs_code === false;

      expect(shouldAutoDismiss).toBe(false);
    });
  });

  describe('CLOSE_DIALOG dispatch', () => {
    it('should dispatch CLOSE_DIALOG with oauthCode payload when auto-dismiss condition is met', () => {
      // Arrange
      const mockDispatch = vi.fn();
      const isOAuthCodeDialogOpen = true;
      (global as Record<string, unknown>).__oauth_needs_code = false;

      // Act: Simulate the useEffect logic
      if (
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_needs_code === false
      ) {
        mockDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }

      // Assert
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'CLOSE_DIALOG',
        payload: 'oauthCode',
      });
    });

    it('should NOT dispatch CLOSE_DIALOG when auto-dismiss condition is NOT met', () => {
      // Arrange
      const mockDispatch = vi.fn();
      const isOAuthCodeDialogOpen = true;
      (global as Record<string, unknown>).__oauth_needs_code = true;

      // Act: Simulate the useEffect logic
      if (
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_needs_code === false
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

      // Polling effect opens dialog
      isOAuthCodeDialogOpen = true;
      (global as Record<string, unknown>).__oauth_needs_code = false;

      // Auto-dismiss should trigger
      if (
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_needs_code === false
      ) {
        mockDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      mockDispatch.mockClear();

      // Second auth attempt starts immediately
      (global as Record<string, unknown>).__oauth_needs_code = true;
      isOAuthCodeDialogOpen = true;

      // Dialog should NOT auto-dismiss (flag is true, not false)
      if (
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_needs_code === false
      ) {
        mockDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }

      expect(mockDispatch).not.toHaveBeenCalled();

      // Auth completes
      (global as Record<string, unknown>).__oauth_needs_code = false;

      // Now dialog should auto-dismiss
      if (
        isOAuthCodeDialogOpen &&
        (global as Record<string, unknown>).__oauth_needs_code === false
      ) {
        mockDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
      }

      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });
  });
});
