/**
 * @plan PLAN-20260608-ISSUE1586.P09
 * DI-refactored: SettingsService → ISettingsService local test double,
 *                providerRuntimeContext → IProviderRuntimeContext + runtime state helpers
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthPrecedenceConfig, OAuthManager } from '../precedence.js';
import {
  AuthPrecedenceResolver,
  type OAuthTokenRequestMetadata,
  ensureRuntimeState,
  runtimeScopedStates,
} from '../precedence.js';
import type { ISettingsService } from '../interfaces/settings-service.js';
import type { IProviderRuntimeContext } from '../interfaces/runtime-context.js';

/**
 * Local ISettingsService test double.
 * @plan PLAN-20260608-ISSUE1586.P09
 */
function createStubSettingsService(
  overrides?: Record<string, unknown>,
): ISettingsService {
  const store = new Map<string, unknown>(Object.entries(overrides ?? {}));
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    get: vi.fn((key: string) => store.get(key)),
    getProviderSettings: vi.fn(() => ({})),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
  };
}

/**
 * Creates a runtime context for testing that establishes runtime-scoped state.
 * This replaces the core createProviderRuntimeContext / setActiveProviderRuntimeContext.
 */
function createTestRuntimeContext(
  runtimeId: string,
  settingsService?: ISettingsService,
): IProviderRuntimeContext {
  const context: IProviderRuntimeContext = {
    settingsService: settingsService ?? createStubSettingsService(),
    runtimeId,
    metadata: {},
  };
  // Ensure runtime state is created so the resolver can find it
  ensureRuntimeState(context);
  return context;
}

const baseConfig: AuthPrecedenceConfig = {
  envKeyNames: [],
  isOAuthEnabled: true,
  supportsOAuth: true,
  oauthProvider: 'mock-oauth-provider',
  providerId: 'mock-provider',
};

describe('auth runtime scope gaps', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Clean up any runtime states from previous tests
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  afterEach(() => {
    // Clean up runtime states
    for (const key of [...runtimeScopedStates.keys()]) {
      runtimeScopedStates.delete(key);
    }
  });

  it('rejects missing or blank runtime ids before creating scoped state @plan:PLAN-20260630-ISSUE2300 @requirement:REQ-SP2-004', () => {
    const settingsService = createStubSettingsService();

    for (const runtimeId of [undefined, '', '   ']) {
      const context = {
        settingsService,
        runtimeId,
        metadata: {},
      } as unknown as IProviderRuntimeContext;

      expect(() => ensureRuntimeState(context)).toThrow(/non-empty runtimeId/);
    }

    expect(runtimeScopedStates.size).toBe(0);
  });

  it('isolates cached token per runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P18 @requirement:REQ-SP2-004 @pseudocode auth-runtime-scope.md lines 1-3', async () => {
    const settingsService = createStubSettingsService();
    const runtimeContext = createTestRuntimeContext(
      'runtime-auth-A',
      settingsService,
    );

    const getTokenMock = vi
      .fn<
        [string, OAuthTokenRequestMetadata | undefined],
        Promise<string | null>
      >()
      .mockResolvedValueOnce('scoped-token-runtime-a')
      .mockImplementationOnce(() =>
        Promise.reject(
          new Error(
            'runtime-scoped cache should serve second call without re-fetch',
          ),
        ),
      );

    const oauthManager: OAuthManager = {
      getToken: getTokenMock,
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getOAuthToken: vi.fn(),
    };

    const resolver = new AuthPrecedenceResolver(baseConfig, {
      oauthManager,
      settingsService,
      getActiveRuntimeContext: () => runtimeContext,
    });

    const firstToken = await resolver.resolveAuthentication({
      includeOAuth: true,
    });

    await expect(
      resolver.resolveAuthentication({ includeOAuth: true }),
    ).resolves.toBe('scoped-token-runtime-a');

    expect(firstToken).toBe('scoped-token-runtime-a');
    expect(oauthManager.getToken).toHaveBeenCalledTimes(1);
  });

  it('annotates OAuth acquisition with runtime scope metadata @plan:PLAN-20251018-STATELESSPROVIDER2.P18 @requirement:REQ-SP2-004 @pseudocode auth-runtime-scope.md lines 3-4', async () => {
    const settingsService = createStubSettingsService();
    const runtimeContext = createTestRuntimeContext(
      'runtime-metadata',
      settingsService,
    );

    const getTokenMock = vi.fn<
      [string, OAuthTokenRequestMetadata | undefined],
      Promise<string | null>
    >(() => Promise.resolve('scoped-token'));

    const oauthManager: OAuthManager = {
      getToken: getTokenMock,
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getOAuthToken: vi.fn(),
    };

    const resolver = new AuthPrecedenceResolver(baseConfig, {
      oauthManager,
      settingsService,
      getActiveRuntimeContext: () => runtimeContext,
    });

    await resolver.resolveAuthentication({ includeOAuth: true });

    expect(oauthManager.getToken).toHaveBeenCalledWith(
      'mock-oauth-provider',
      expect.objectContaining({
        runtimeAuthScopeId: 'runtime-metadata',
      }),
    );
  });

  it('registers scoped invalidation hooks on runtime metadata @plan:PLAN-20251018-STATELESSPROVIDER2.P18 @requirement:REQ-SP2-004 @pseudocode auth-runtime-scope.md lines 4-7', async () => {
    const settingsService = createStubSettingsService();
    const runtimeContext = createTestRuntimeContext(
      'runtime-cleanup',
      settingsService,
    );

    const getTokenMock = vi.fn<
      [string, OAuthTokenRequestMetadata | undefined],
      Promise<string | null>
    >(() => Promise.resolve('scoped-token-cleanup'));

    const oauthManager: OAuthManager = {
      getToken: getTokenMock,
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getOAuthToken: vi.fn().mockResolvedValue({
        access_token: 'scoped-token-cleanup',
        token_type: 'Bearer',
        expiry: Date.now() + 3600,
      }),
    };

    const resolver = new AuthPrecedenceResolver(baseConfig, {
      oauthManager,
      settingsService,
      getActiveRuntimeContext: () => runtimeContext,
    });

    await resolver.resolveAuthentication({ includeOAuth: true });

    const scopedMetadata = runtimeContext.metadata as Record<string, unknown>;

    expect(scopedMetadata.runtimeAuthScope).toStrictEqual(
      expect.objectContaining({
        cacheEntries: expect.any(Array),
        cancellationHooks: expect.arrayContaining([expect.any(Function)]),
      }),
    );
  });
});
