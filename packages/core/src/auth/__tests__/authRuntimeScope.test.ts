import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthPrecedenceConfig,
  AuthPrecedenceResolver,
  OAuthManager,
  type OAuthTokenRequestMetadata,
} from '../precedence.js';
import { SettingsService } from '../../settings/SettingsService.js';
import {
  createProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';

const baseConfig: AuthPrecedenceConfig = {
  envKeyNames: [],
  isOAuthEnabled: true,
  supportsOAuth: true,
  oauthProvider: 'mock-oauth-provider',
  providerId: 'mock-provider',
};

describe('auth runtime scope gaps', () => {
  let originalContext = peekActiveProviderRuntimeContext();

  beforeEach(() => {
    vi.restoreAllMocks();
    originalContext = peekActiveProviderRuntimeContext();
  });

  afterEach(() => {
    setActiveProviderRuntimeContext(originalContext);
  });

  it('isolates cached token per runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P18 @requirement:REQ-SP2-004 @pseudocode auth-runtime-scope.md lines 1-3', async () => {
    const runtimeContext = createProviderRuntimeContext({
      runtimeId: 'runtime-auth-A',
      metadata: {},
      settingsService: new SettingsService(),
    });
    setActiveProviderRuntimeContext(runtimeContext);

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

    const resolver = new AuthPrecedenceResolver(baseConfig, oauthManager);

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
    const runtimeContext = createProviderRuntimeContext({
      runtimeId: 'runtime-metadata',
      metadata: {},
      settingsService: new SettingsService(),
    });
    setActiveProviderRuntimeContext(runtimeContext);

    const getTokenMock = vi.fn<
      [string, OAuthTokenRequestMetadata | undefined],
      Promise<string | null>
    >(() => Promise.resolve('scoped-token'));

    const oauthManager: OAuthManager = {
      getToken: getTokenMock,
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getOAuthToken: vi.fn(),
    };

    const resolver = new AuthPrecedenceResolver(baseConfig, oauthManager);

    await resolver.resolveAuthentication({ includeOAuth: true });

    expect(oauthManager.getToken).toHaveBeenCalledWith(
      'mock-oauth-provider',
      expect.objectContaining({
        runtimeAuthScopeId: 'runtime-metadata',
      }),
    );
  });

  it('registers scoped invalidation hooks on runtime metadata @plan:PLAN-20251018-STATELESSPROVIDER2.P18 @requirement:REQ-SP2-004 @pseudocode auth-runtime-scope.md lines 4-7', async () => {
    const runtimeContext = createProviderRuntimeContext({
      runtimeId: 'runtime-cleanup',
      metadata: {},
      settingsService: new SettingsService(),
    });
    setActiveProviderRuntimeContext(runtimeContext);

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

    const resolver = new AuthPrecedenceResolver(baseConfig, oauthManager);

    await resolver.resolveAuthentication({ includeOAuth: true });

    const scopedMetadata = runtimeContext.metadata as Record<string, unknown>;

    expect(scopedMetadata?.runtimeAuthScope).toEqual(
      expect.objectContaining({
        cacheEntries: expect.any(Array),
        cancellationHooks: expect.arrayContaining([expect.any(Function)]),
      }),
    );
  });
});
