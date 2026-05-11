/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InitializationState,
  InitializationGuard,
  AuthCodeDialog,
  isTokenExpired,
  hasValidRefreshToken,
} from '../oauth-provider-base.js';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-core';
import {
  OAuthError,
  OAuthErrorType,
  OAuthErrorFactory,
} from '@vybestack/llxprt-code-core';
import { GeminiOAuthProvider } from '../gemini-oauth-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(overrides: Partial<OAuthToken> = {}): OAuthToken {
  return {
    access_token: 'access',
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// InitializationState enum
// ---------------------------------------------------------------------------

describe('InitializationState', () => {
  it('has the expected string values', () => {
    expect(InitializationState.NotStarted).toBe('not-started');
    expect(InitializationState.InProgress).toBe('in-progress');
    expect(InitializationState.Completed).toBe('completed');
    expect(InitializationState.Failed).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// InitializationGuard — wrap mode (Anthropic/Gemini/Qwen)
// ---------------------------------------------------------------------------

describe('InitializationGuard (wrap mode)', () => {
  it('starts in NotStarted state', () => {
    const guard = new InitializationGuard('wrap', 'test-provider');
    expect(guard.getState()).toBe(InitializationState.NotStarted);
  });

  it('moves to Completed after successful init', async () => {
    const guard = new InitializationGuard('wrap', 'test-provider');
    await guard.ensureInitialized(async () => {});
    expect(guard.getState()).toBe(InitializationState.Completed);
  });

  it('only calls initFn once for concurrent callers', async () => {
    const guard = new InitializationGuard('wrap', 'test-provider');
    const initFn = vi.fn(async () => {});
    await Promise.all([
      guard.ensureInitialized(initFn),
      guard.ensureInitialized(initFn),
      guard.ensureInitialized(initFn),
    ]);
    expect(initFn).toHaveBeenCalledTimes(1);
  });

  it('returns immediately on subsequent calls after Completed', async () => {
    const guard = new InitializationGuard('wrap', 'test-provider');
    const initFn = vi.fn(async () => {});
    await guard.ensureInitialized(initFn);
    await guard.ensureInitialized(initFn);
    await guard.ensureInitialized(initFn);
    expect(initFn).toHaveBeenCalledTimes(1);
  });

  it('wraps unknown error in OAuthError on failure', async () => {
    const guard = new InitializationGuard('wrap', 'my-provider');
    const raw = new Error('raw init error');
    await expect(
      guard.ensureInitialized(async () => {
        throw raw;
      }),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it('preserves OAuthError as-is on failure', async () => {
    const guard = new InitializationGuard('wrap', 'my-provider');
    const oauthErr = new OAuthError(
      OAuthErrorType.AUTHENTICATION_REQUIRED,
      'provider',
      'test error',
      {},
    );
    await expect(
      guard.ensureInitialized(async () => {
        throw oauthErr;
      }),
    ).rejects.toBe(oauthErr);
  });

  it('stores wrapped error in getError()', async () => {
    const guard = new InitializationGuard('wrap', 'my-provider');
    await guard
      .ensureInitialized(async () => {
        throw new Error('boom');
      })
      .catch(() => {});
    expect(guard.getError()).toBeInstanceOf(OAuthError);
  });

  it('moves to Failed state on error', async () => {
    const guard = new InitializationGuard('wrap', 'my-provider');
    await guard
      .ensureInitialized(async () => {
        throw new Error('boom');
      })
      .catch(() => {});
    expect(guard.getState()).toBe(InitializationState.Failed);
  });

  it('allows retry after Failed by resetting to NotStarted', async () => {
    const guard = new InitializationGuard('wrap', 'my-provider');
    let attempt = 0;
    const initFn = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error('first attempt fails');
    });

    // First attempt fails
    await guard.ensureInitialized(initFn).catch(() => {});
    expect(guard.getState()).toBe(InitializationState.Failed);

    // Second attempt succeeds
    await guard.ensureInitialized(initFn);
    expect(guard.getState()).toBe(InitializationState.Completed);
    expect(initFn).toHaveBeenCalledTimes(2);
  });

  it('clears error after retry succeeds', async () => {
    const guard = new InitializationGuard('wrap', 'my-provider');
    let attempt = 0;
    await guard
      .ensureInitialized(async () => {
        attempt++;
        if (attempt === 1) throw new Error('fails');
      })
      .catch(() => {});
    await guard.ensureInitialized(async () => {});
    expect(guard.getError()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// InitializationGuard — rethrow mode (Codex)
// ---------------------------------------------------------------------------

describe('InitializationGuard (rethrow mode)', () => {
  it('rethrows the original error without wrapping', async () => {
    const guard = new InitializationGuard('rethrow');
    const raw = new Error('codex init fail');
    await expect(
      guard.ensureInitialized(async () => {
        throw raw;
      }),
    ).rejects.toBe(raw);
  });

  it('does not store error in getError() in rethrow mode', async () => {
    const guard = new InitializationGuard('rethrow');
    await guard
      .ensureInitialized(async () => {
        throw new Error('boom');
      })
      .catch(() => {});
    expect(guard.getError()).toBeUndefined();
  });

  it('moves to Failed then allows retry', async () => {
    const guard = new InitializationGuard('rethrow');
    let attempt = 0;
    const initFn = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error('first');
    });
    await guard.ensureInitialized(initFn).catch(() => {});
    expect(guard.getState()).toBe(InitializationState.Failed);
    await guard.ensureInitialized(initFn);
    expect(guard.getState()).toBe(InitializationState.Completed);
  });
});

// ---------------------------------------------------------------------------
// AuthCodeDialog
// ---------------------------------------------------------------------------

describe('AuthCodeDialog', () => {
  it('resolves when submitAuthCode is called', async () => {
    const dialog = new AuthCodeDialog();
    const promise = dialog.waitForAuthCode();
    dialog.submitAuthCode('auth-code-123');
    const result = await promise;
    expect(result).toBe('auth-code-123');
  });

  it('rejects with OAuthError when cancelAuth is called', async () => {
    const dialog = new AuthCodeDialog();
    const promise = dialog.waitForAuthCode();
    dialog.cancelAuth('test-provider');
    await expect(promise).rejects.toBeInstanceOf(OAuthError);
  });

  it('cancelAuth sets __oauth_needs_code to false', async () => {
    const dialog = new AuthCodeDialog();
    (global as unknown as { __oauth_needs_code: boolean }).__oauth_needs_code =
      true;
    const pendingPromise = dialog.waitForAuthCode();
    dialog.cancelAuth('test-provider');
    await expect(pendingPromise).rejects.toBeInstanceOf(OAuthError);
    expect(
      (global as unknown as { __oauth_needs_code: boolean }).__oauth_needs_code,
    ).toBe(false);
  });

  it('hasPendingPromise returns true while waiting', () => {
    const dialog = new AuthCodeDialog();
    expect(dialog.hasPendingPromise()).toBe(false);
    void dialog.waitForAuthCode();
    expect(dialog.hasPendingPromise()).toBe(true);
  });

  it('hasPendingPromise returns false after submitAuthCode', () => {
    const dialog = new AuthCodeDialog();
    void dialog.waitForAuthCode();
    dialog.submitAuthCode('code');
    expect(dialog.hasPendingPromise()).toBe(false);
  });

  it('hasPendingPromise returns false after cancelAuth', () => {
    const dialog = new AuthCodeDialog();
    dialog.waitForAuthCode().catch(() => {});
    dialog.cancelAuth('provider');
    expect(dialog.hasPendingPromise()).toBe(false);
  });

  it('rejectWithError clears pending dialog state and propagates the error', async () => {
    const dialog = new AuthCodeDialog();
    const promise = dialog.waitForAuthCode();
    const timeoutError = OAuthErrorFactory.fromUnknown(
      'test-provider',
      new Error('timeout'),
      'authentication timeout',
    );

    dialog.rejectWithError(timeoutError);

    await expect(promise).rejects.toBe(timeoutError);
    expect(dialog.hasPendingPromise()).toBe(false);
    expect(
      (global as unknown as { __oauth_needs_code: boolean }).__oauth_needs_code,
    ).toBe(false);
  });

  it('submitAuthCode is a no-op when no promise is pending', () => {
    const dialog = new AuthCodeDialog();
    expect(() => dialog.submitAuthCode('code')).not.toThrow();
  });

  it('cancelAuth is a no-op when no promise is pending', () => {
    const dialog = new AuthCodeDialog();
    expect(() => dialog.cancelAuth('provider')).not.toThrow();
  });

  it('subsequent waitForAuthCode calls create independent promises', async () => {
    const dialog = new AuthCodeDialog();
    const p1 = dialog.waitForAuthCode();
    dialog.submitAuthCode('first');
    const p2 = dialog.waitForAuthCode();
    dialog.submitAuthCode('second');
    expect(await p1).toBe('first');
    expect(await p2).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// isTokenExpired
// ---------------------------------------------------------------------------

describe('isTokenExpired', () => {
  it('returns true for a token that has already expired', () => {
    const token = makeToken({ expiry: Math.floor(Date.now() / 1000) - 60 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns true for a token expiring within the 30-second buffer', () => {
    const token = makeToken({ expiry: Math.floor(Date.now() / 1000) + 20 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns false for a token with plenty of time remaining', () => {
    const token = makeToken({ expiry: Math.floor(Date.now() / 1000) + 3600 });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('uses default buffer of 30 seconds', () => {
    // token expiring in exactly 30 seconds should be considered expired
    const token = makeToken({ expiry: Math.floor(Date.now() / 1000) + 30 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('respects a custom bufferSeconds parameter', () => {
    const token = makeToken({ expiry: Math.floor(Date.now() / 1000) + 60 });
    expect(isTokenExpired(token, 90)).toBe(true);
    expect(isTokenExpired(token, 30)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasValidRefreshToken
// ---------------------------------------------------------------------------

describe('hasValidRefreshToken', () => {
  it('returns true for a token with a valid refresh_token string', () => {
    const token = makeToken({ refresh_token: 'valid-refresh-token' });
    expect(hasValidRefreshToken(token)).toBe(true);
  });

  it('returns false when refresh_token is undefined', () => {
    const token = makeToken({ refresh_token: undefined });
    expect(hasValidRefreshToken(token)).toBe(false);
  });

  it('returns false when refresh_token is an empty string', () => {
    const token = makeToken({ refresh_token: '' });
    expect(hasValidRefreshToken(token)).toBe(false);
  });

  it('returns false when refresh_token is only whitespace', () => {
    const token = makeToken({ refresh_token: '   ' });
    expect(hasValidRefreshToken(token)).toBe(false);
  });

  it('returns false when refresh_token is excessively long (>= 1000 chars)', () => {
    const token = makeToken({ refresh_token: 'x'.repeat(1000) });
    expect(hasValidRefreshToken(token)).toBe(false);
  });

  it('returns true for a refresh_token of exactly 999 chars', () => {
    const token = makeToken({ refresh_token: 'x'.repeat(999) });
    expect(hasValidRefreshToken(token)).toBe(true);
  });

  it('acts as a type predicate narrowing refresh_token to string', () => {
    const token = makeToken({ refresh_token: 'valid' });
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!hasValidRefreshToken(token))
      throw new Error('unreachable: narrowing failed');
    // TypeScript should consider token.refresh_token a string here
    expect(typeof token.refresh_token).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// GeminiOAuthProvider.isAuthenticated()
// ---------------------------------------------------------------------------

describe('GeminiOAuthProvider.isAuthenticated()', () => {
  let provider: GeminiOAuthProvider;
  let mockTokenStore: TokenStore;

  beforeEach(() => {
    mockTokenStore = {
      getToken: vi.fn().mockResolvedValue(null),
      saveToken: vi.fn().mockResolvedValue(undefined),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue([]),
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getBucketStats: vi.fn().mockResolvedValue(null),
      acquireRefreshLock: vi.fn().mockResolvedValue(true),
      releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
      acquireAuthLock: vi.fn().mockResolvedValue(true),
      releaseAuthLock: vi.fn().mockResolvedValue(undefined),
    };
    provider = new GeminiOAuthProvider(mockTokenStore);
  });

  it('returns true unconditionally (Gemini regularization G1)', async () => {
    const result = await provider.isAuthenticated();
    expect(result).toBe(true);
  });

  it('returns true even when token store has no token', async () => {
    vi.mocked(mockTokenStore.getToken).mockResolvedValue(null);
    const result = await provider.isAuthenticated();
    expect(result).toBe(true);
  });

  it('returns true when constructed without a token store', async () => {
    const noStoreProvider = new GeminiOAuthProvider(undefined);
    const result = await noStoreProvider.isAuthenticated();
    expect(result).toBe(true);
  });
});
