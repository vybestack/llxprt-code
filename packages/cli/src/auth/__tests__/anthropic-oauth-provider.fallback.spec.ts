/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../local-oauth-callback.js', () => ({
  startLocalOAuthCallback: vi.fn(),
}));

import * as coreModule from '@vybestack/llxprt-code-core';
import type {
  DeviceCodeResponse,
  OAuthToken,
  TokenStore,
} from '@vybestack/llxprt-code-core';
import { AnthropicOAuthProvider } from '../anthropic-oauth-provider.js';
import { startLocalOAuthCallback } from '../local-oauth-callback.js';

const startLocalOAuthCallbackMock = vi.mocked(startLocalOAuthCallback);
const openBrowserArgs: string[] = [];

/**
 * Tests for improved OAuth fallback behavior (Issue #828)
 *
 * Problems addressed:
 * 1. Always use device-code URL as the user-facing URL
 * 2. Show OAuthCodeDialog alongside browser callback
 * 3. Cancel stale/late-appearing dialogs
 */
describe('AnthropicOAuthProvider fallback behavior', () => {
  let provider: AnthropicOAuthProvider;
  let tokenStore: TokenStore;
  let deviceFlow: coreModule.AnthropicDeviceFlow;
  const DEVICE_CODE_URL =
    'https://claude.ai/oauth/authorize?redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode';

  beforeEach(() => {
    openBrowserArgs.length = 0;
    startLocalOAuthCallbackMock.mockReset();
    vi.spyOn(global.console, 'log').mockImplementation(() => {});

    const saveToken = vi.fn<TokenStore['saveToken']>(
      async (_provider, _token) => {},
    );
    tokenStore = {
      saveToken,
      getToken: vi.fn<TokenStore['getToken']>(async () => null),
      removeToken: vi.fn<TokenStore['removeToken']>(async () => undefined),
      listProviders: vi.fn<TokenStore['listProviders']>(async () => []),
      listBuckets: vi.fn<TokenStore['listBuckets']>(async () => ['default']),
      getBucketStats: vi.fn<TokenStore['getBucketStats']>(async () => null),
      acquireRefreshLock: vi.fn(async () => true),
      releaseRefreshLock: vi.fn(async () => undefined),
    } satisfies TokenStore;

    provider = new AnthropicOAuthProvider(tokenStore);
    deviceFlow = (
      provider as unknown as {
        deviceFlow: coreModule.AnthropicDeviceFlow;
      }
    ).deviceFlow;

    (
      deviceFlow as unknown as {
        initiateDeviceFlow: () => Promise<DeviceCodeResponse>;
      }
    ).initiateDeviceFlow = vi.fn(async () => ({
      verification_uri: 'https://console.anthropic.com/oauth/authorize',
      verification_uri_complete: DEVICE_CODE_URL,
      user_code: 'CODE123',
      device_code: 'device-code',
      expires_in: 1800,
      interval: 5,
    }));
    (deviceFlow as unknown as { getState: () => string }).getState = vi
      .fn()
      .mockReturnValue('generated-state');
    (
      deviceFlow as unknown as {
        buildAuthorizationUrl: (redirectUri: string) => string;
      }
    ).buildAuthorizationUrl = vi
      .fn()
      .mockImplementation(
        (redirectUri: string) =>
          `https://claude.ai/oauth/authorize?redirect_uri=${encodeURIComponent(
            redirectUri,
          )}&code=true`,
      );
    (
      deviceFlow as unknown as {
        exchangeCodeForToken: (authCode: string) => Promise<OAuthToken>;
      }
    ).exchangeCodeForToken = vi.fn(async () => ({
      token_type: 'Bearer' as const,
      access_token: 'local-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      scope: null,
    }));
    vi.spyOn(coreModule, 'openBrowserSecurely').mockImplementation(
      async (url: string) => {
        openBrowserArgs.push(url);
      },
    );
    vi.spyOn(coreModule, 'shouldLaunchBrowser').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (global as { __oauth_needs_code?: boolean }).__oauth_needs_code;
    delete (global as { __oauth_provider?: string }).__oauth_provider;
  });

  describe('Problem 1: Always display device code URL', () => {
    it('should always display device code URL, not callback URL', async () => {
      const waitForCallback = vi
        .fn()
        .mockResolvedValue({ code: 'auth-code', state: 'generated-state' });
      const shutdown = vi.fn().mockResolvedValue(undefined);

      startLocalOAuthCallbackMock.mockResolvedValue({
        redirectUri: 'http://localhost:8765/callback',
        waitForCallback,
        shutdown,
      });

      const consoleLogs: string[] = [];
      vi.spyOn(global.console, 'log').mockImplementation(
        (...args: unknown[]) => {
          consoleLogs.push(args.map(String).join(' '));
        },
      );

      await provider.initiateAuth();

      // The device code URL should appear in console output, not the callback URL
      const urlLogLines = consoleLogs.filter(
        (line) => line.includes('claude.ai') || line.includes('localhost'),
      );
      const hasDeviceCodeUrl = urlLogLines.some((line) =>
        line.includes(DEVICE_CODE_URL),
      );
      const hasCallbackUrl = urlLogLines.some((line) =>
        line.includes('localhost:8765'),
      );

      expect(hasDeviceCodeUrl).toBe(true);
      expect(hasCallbackUrl).toBe(false);
    });

    it('should open browser with callback URL internally', async () => {
      const waitForCallback = vi
        .fn()
        .mockResolvedValue({ code: 'auth-code', state: 'generated-state' });
      const shutdown = vi.fn().mockResolvedValue(undefined);

      startLocalOAuthCallbackMock.mockResolvedValue({
        redirectUri: 'http://localhost:8765/callback',
        waitForCallback,
        shutdown,
      });

      await provider.initiateAuth();

      // Browser should be opened with the callback URL (for auto-redirect)
      expect(openBrowserArgs.some((url) => url.includes('localhost'))).toBe(
        true,
      );
    });
  });

  describe('Problem 2: OAuthCodeDialog alongside browser auth', () => {
    it('should show OAuthCodeDialog alongside browser callback', async () => {
      let callbackResolve:
        | ((val: { code: string; state: string }) => void)
        | undefined;
      const waitForCallback = vi.fn(
        () =>
          new Promise<{ code: string; state: string }>((resolve) => {
            callbackResolve = resolve;
          }),
      );
      const shutdown = vi.fn().mockResolvedValue(undefined);

      startLocalOAuthCallbackMock.mockResolvedValue({
        redirectUri: 'http://localhost:8765/callback',
        waitForCallback,
        shutdown,
      });

      const authPromise = provider.initiateAuth();
      // Wait for the async flow to reach the point where it sets up dialog
      await new Promise((resolve) => setTimeout(resolve, 50));

      // __oauth_needs_code should be set true when callback is available
      expect(
        (global as { __oauth_needs_code?: boolean }).__oauth_needs_code,
      ).toBe(true);

      // Resolve callback to complete auth
      callbackResolve!({ code: 'auth-code', state: 'generated-state' });
      await authPromise;
    });

    it('should complete auth when callback succeeds (dialog auto-dismisses)', async () => {
      const waitForCallback = vi
        .fn()
        .mockResolvedValue({ code: 'auth-code', state: 'generated-state' });
      const shutdown = vi.fn().mockResolvedValue(undefined);

      startLocalOAuthCallbackMock.mockResolvedValue({
        redirectUri: 'http://localhost:8765/callback',
        waitForCallback,
        shutdown,
      });

      await provider.initiateAuth();

      // After successful callback, __oauth_needs_code should be cleared
      expect(
        (global as { __oauth_needs_code?: boolean }).__oauth_needs_code,
      ).toBeFalsy();

      // Token should be saved
      expect(tokenStore.saveToken).toHaveBeenCalledWith(
        'anthropic',
        expect.objectContaining({ access_token: 'local-token' }),
      );
    });

    it('should fall back to manual code entry when callback fails', async () => {
      const waitForCallback = vi
        .fn()
        .mockRejectedValue(new Error('callback timeout'));
      const shutdown = vi.fn().mockResolvedValue(undefined);

      startLocalOAuthCallbackMock.mockResolvedValue({
        redirectUri: 'http://localhost:8765/callback',
        waitForCallback,
        shutdown,
      });

      // Start auth - it should NOT throw when callback fails
      const authPromise = provider.initiateAuth();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Dialog should still be open for manual entry
      expect(
        (global as { __oauth_needs_code?: boolean }).__oauth_needs_code,
      ).toBe(true);

      // Complete via manual code entry
      provider.submitAuthCode('manual-code#manual-state');
      await authPromise;

      // Auth should have completed without throwing
      expect(tokenStore.saveToken).toHaveBeenCalled();
    });
  });

  describe('Problem 3: Cancel stale dialogs', () => {
    it('should cancel stale auth dialog when new auth starts', async () => {
      // Start first auth attempt that hangs (no local callback)
      startLocalOAuthCallbackMock.mockRejectedValue(
        new Error('callback unavailable'),
      );

      // Catch the first auth's rejection so it doesn't become unhandled
      const firstAuth = provider.initiateAuth().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // First attempt should have dialog open
      expect(
        (global as { __oauth_needs_code?: boolean }).__oauth_needs_code,
      ).toBe(true);

      // Start second auth attempt - should cancel the first
      const cancelAuthSpy = vi.spyOn(provider, 'cancelAuth');

      // The second attempt will generate a new ID, canceling the first
      const secondAuth = provider.initiateAuth();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // cancelAuth should have been called to cancel previous attempt
      expect(cancelAuthSpy).toHaveBeenCalled();

      // Clean up both
      provider.cancelAuth();
      await firstAuth;
      await secondAuth.catch(() => undefined);
    });

    it('should clear __oauth_needs_code on cancelAuth', async () => {
      startLocalOAuthCallbackMock.mockRejectedValue(
        new Error('callback unavailable'),
      );

      const authPromise = provider.initiateAuth();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(
        (global as { __oauth_needs_code?: boolean }).__oauth_needs_code,
      ).toBe(true);

      provider.cancelAuth();

      expect(
        (global as { __oauth_needs_code?: boolean }).__oauth_needs_code,
      ).toBe(false);

      await authPromise.catch(() => undefined);
    });

    it('should clear __oauth_needs_code on completeAuth', async () => {
      // Set up the global flag as if dialog was shown
      (
        global as unknown as { __oauth_needs_code: boolean }
      ).__oauth_needs_code = true;

      await provider.completeAuth('test-code#test-state');

      expect(
        (global as { __oauth_needs_code?: boolean }).__oauth_needs_code,
      ).toBe(false);
    });
  });
});
