import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runWithRuntimeScope,
  registerIsolatedRuntimeBindings,
  createIsolatedRuntimeContext,
} from '../../src/runtime/runtimeContextFactory.js';
import {
  AuthPrecedenceResolver,
  type AuthPrecedenceConfig,
  type OAuthManager,
  type OAuthTokenRequestMetadata,
} from '../../../core/src/auth/precedence.js';
import {
  createProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../../core/src/runtime/providerRuntimeContext.js';
import { SettingsService } from '../../../core/src/settings/SettingsService.js';

const baseConfig: AuthPrecedenceConfig = {
  envKeyNames: [],
  isOAuthEnabled: true,
  supportsOAuth: true,
  oauthProvider: 'mock-oauth-provider',
  providerId: 'mock-cli-provider',
};

describe('CLI auth runtime scope gaps', () => {
  let originalContext = peekActiveProviderRuntimeContext();

  beforeEach(() => {
    vi.restoreAllMocks();
    originalContext = peekActiveProviderRuntimeContext();
    registerIsolatedRuntimeBindings({
      resetInfrastructure: () => {},
      setRuntimeContext: () => {},
      registerInfrastructure: () => {},
      linkProviderManager: () => {},
    });
  });

  afterEach(() => {
    setActiveProviderRuntimeContext(originalContext);
    registerIsolatedRuntimeBindings({
      resetInfrastructure: () => {},
      setRuntimeContext: () => {},
      registerInfrastructure: () => {},
      linkProviderManager: () => {},
    });
  });

  it('scopes cached token per CLI runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P18 @requirement:REQ-SP2-004 @pseudocode auth-runtime-scope.md lines 1-3', async () => {
    const getTokenMock = vi
      .fn<
        [string, OAuthTokenRequestMetadata | undefined],
        Promise<string | null>
      >()
      .mockResolvedValueOnce('cli-runtime-token')
      .mockImplementationOnce(() =>
        Promise.reject(
          new Error(
            'CLI runtime should reuse scoped cache instead of refetching',
          ),
        ),
      );

    const oauthManager: OAuthManager = {
      getToken: getTokenMock,
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getOAuthToken: vi.fn(),
    };

    const resolver = new AuthPrecedenceResolver(baseConfig, oauthManager);

    const scope = {
      runtimeId: 'cli-runtime-A',
      metadata: { origin: 'auth-runtime-scope-test' },
    };

    await runWithRuntimeScope(scope, async () => {
      setActiveProviderRuntimeContext(
        createProviderRuntimeContext({
          runtimeId: scope.runtimeId,
          metadata: scope.metadata,
          settingsService: new SettingsService(),
        }),
      );

      const firstToken = await resolver.resolveAuthentication({
        includeOAuth: true,
      });

      await expect(
        resolver.resolveAuthentication({ includeOAuth: true }),
      ).resolves.toBe('cli-runtime-token');

      expect(firstToken).toBe('cli-runtime-token');
      expect(oauthManager.getToken).toHaveBeenCalledTimes(1);
    });
  });

  it('annotates CLI OAuth path with runtime scope metadata @plan:PLAN-20251018-STATELESSPROVIDER2.P18 @requirement:REQ-SP2-004 @pseudocode auth-runtime-scope.md lines 3-4', async () => {
    const getTokenMock = vi.fn<
      [string, OAuthTokenRequestMetadata | undefined],
      Promise<string | null>
    >(() => Promise.resolve('cli-runtime-token'));

    const oauthManager: OAuthManager = {
      getToken: getTokenMock,
      isAuthenticated: vi.fn().mockResolvedValue(true),
      getOAuthToken: vi.fn(),
    };

    const resolver = new AuthPrecedenceResolver(baseConfig, oauthManager);

    const scope = {
      runtimeId: 'cli-runtime-metadata',
      metadata: { command: 'auth-runtime-scope' },
    };

    await runWithRuntimeScope(scope, async () => {
      setActiveProviderRuntimeContext(
        createProviderRuntimeContext({
          runtimeId: scope.runtimeId,
          metadata: scope.metadata,
          settingsService: new SettingsService(),
        }),
      );

      await resolver.resolveAuthentication({ includeOAuth: true });
    });

    expect(oauthManager.getToken).toHaveBeenCalledWith(
      'mock-oauth-provider',
      expect.objectContaining({
        runtimeAuthScopeId: 'cli-runtime-metadata',
        cliScope: scope.metadata,
      }),
    );
  });

  it('wires CLI runtime cleanup to scoped credential revocation @plan:PLAN-20251018-STATELESSPROVIDER2.P18 @requirement:REQ-SP2-004 @pseudocode auth-runtime-scope.md lines 5-7', async () => {
    const disposeRuntime =
      vi.fn<
        (runtimeId: string, scope?: { revokedTokens: unknown[] }) => void
      >();
    registerIsolatedRuntimeBindings({
      resetInfrastructure: vi.fn(),
      setRuntimeContext: vi.fn(),
      registerInfrastructure: vi.fn(),
      linkProviderManager: vi.fn(),
      disposeRuntime,
    });

    const handle = createIsolatedRuntimeContext({
      runtimeId: 'cli-runtime-cleanup',
    });

    await handle.activate();
    await handle.cleanup();

    expect(disposeRuntime).toHaveBeenCalledWith(
      'cli-runtime-cleanup',
      expect.objectContaining({
        revokedTokens: expect.any(Array),
      }),
    );
  });
});
