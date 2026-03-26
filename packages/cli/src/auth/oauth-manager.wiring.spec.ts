/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BucketFailoverOAuthManagerLike,
  OAuthManagerRuntimeMessageBusDeps,
  OAuthProvider,
  OAuthToken,
  TokenStore,
} from './types.js';

const wiring = vi.hoisted(() => {
  const state = {
    providerRegistry: {} as Record<string, unknown>,
    proactiveRenewalManager: {} as Record<string, unknown>,
    bucketManager: {} as Record<string, unknown>,
    tokenAccessCoordinator: {} as Record<string, unknown>,
    authFlowOrchestrator: {} as Record<string, unknown>,
    authStatusService: {} as Record<string, unknown>,
  };

  const ProviderRegistry = vi.fn();
  const ProactiveRenewalManager = vi.fn();
  const OAuthBucketManager = vi.fn();
  const TokenAccessCoordinator = vi.fn();
  const AuthFlowOrchestrator = vi.fn();
  const AuthStatusService = vi.fn();

  const getAnthropicUsageInfo = vi.fn();
  const getAllAnthropicUsageInfo = vi.fn();
  const getAllCodexUsageInfo = vi.fn();
  const getAllGeminiUsageInfo = vi.fn();
  const getHigherPriorityAuth = vi.fn();

  return {
    state,
    ProviderRegistry,
    ProactiveRenewalManager,
    OAuthBucketManager,
    TokenAccessCoordinator,
    AuthFlowOrchestrator,
    AuthStatusService,
    getAnthropicUsageInfo,
    getAllAnthropicUsageInfo,
    getAllCodexUsageInfo,
    getAllGeminiUsageInfo,
    getHigherPriorityAuth,
  };
});

vi.mock('./provider-registry.js', () => ({
  ProviderRegistry: wiring.ProviderRegistry,
}));
vi.mock('./proactive-renewal-manager.js', () => ({
  ProactiveRenewalManager: wiring.ProactiveRenewalManager,
}));
vi.mock('./OAuthBucketManager.js', () => ({
  OAuthBucketManager: wiring.OAuthBucketManager,
}));
vi.mock('./token-access-coordinator.js', () => ({
  TokenAccessCoordinator: wiring.TokenAccessCoordinator,
}));
vi.mock('./auth-flow-orchestrator.js', () => ({
  AuthFlowOrchestrator: wiring.AuthFlowOrchestrator,
}));
vi.mock('./auth-status-service.js', () => ({
  AuthStatusService: wiring.AuthStatusService,
}));
vi.mock('./provider-usage-info.js', () => ({
  getAnthropicUsageInfo: wiring.getAnthropicUsageInfo,
  getAllAnthropicUsageInfo: wiring.getAllAnthropicUsageInfo,
  getAllCodexUsageInfo: wiring.getAllCodexUsageInfo,
  getAllGeminiUsageInfo: wiring.getAllGeminiUsageInfo,
  getHigherPriorityAuth: wiring.getHigherPriorityAuth,
}));

import { OAuthManager } from './oauth-manager.js';

function createTokenStore(): TokenStore {
  return {
    saveToken: vi.fn(async () => undefined),
    getToken: vi.fn(async () => null),
    removeToken: vi.fn(async () => undefined),
    listProviders: vi.fn(async () => []),
    listBuckets: vi.fn(async () => []),
    getBucketStats: vi.fn(async () => null),
    acquireRefreshLock: vi.fn(async () => true),
    releaseRefreshLock: vi.fn(async () => undefined),
    acquireAuthLock: vi.fn(async () => true),
    releaseAuthLock: vi.fn(async () => undefined),
  };
}

function createProvider(name: string): OAuthProvider {
  return {
    name,
    initiateAuth: vi.fn(async () => {
      const token: OAuthToken = {
        access_token: `${name}-token`,
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      };
      return token;
    }),
    getToken: vi.fn(async () => null),
    refreshToken: vi.fn(async () => null),
  };
}

describe('OAuthManager wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const providerRegistry = {
      registerProvider: vi.fn(),
      getProvider: vi.fn(),
      getSupportedProviders: vi.fn().mockReturnValue([]),
      toggleOAuthEnabled: vi.fn().mockReturnValue(false),
      isOAuthEnabled: vi.fn().mockReturnValue(false),
      setOAuthEnabledState: vi.fn(),
    };

    const proactiveRenewalManager = {
      runProactiveRenewal: vi.fn(async () => undefined),
      configureProactiveRenewalsForProfile: vi.fn(async () => undefined),
      clearRenewalsForProvider: vi.fn(),
    };

    const bucketManager = {
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn().mockReturnValue(undefined),
      clearSessionBucket: vi.fn(),
      clearAllSessionBuckets: vi.fn(),
    };

    const tokenAccessCoordinator = {
      setGetProfileBucketsDelegate: vi.fn(),
      setAuthenticator: vi.fn(),
      getToken: vi.fn(async () => null),
      peekStoredToken: vi.fn(async () => null),
      getOAuthToken: vi.fn(async () => null),
      getCurrentProfileSessionBucket: vi.fn(async () => undefined),
      getCurrentProfileSessionMetadata: vi.fn(async () => undefined),
      doGetProfileBuckets: vi.fn(async () => []),
    };

    const authFlowOrchestrator = {
      authenticate: vi.fn(async () => undefined),
      authenticateMultipleBuckets: vi.fn(async () => undefined),
      setRuntimeMessageBus: vi.fn(),
    };

    const authStatusService = {
      getAuthStatus: vi.fn(async () => []),
      isAuthenticated: vi.fn(async () => false),
      logout: vi.fn(async () => undefined),
      logoutAll: vi.fn(async () => undefined),
      logoutAllBuckets: vi.fn(async () => undefined),
      listBuckets: vi.fn(async () => []),
      getAuthStatusWithBuckets: vi.fn(async () => []),
      clearProviderAuthCaches: vi.fn(async () => undefined),
    };

    wiring.state.providerRegistry = providerRegistry;
    wiring.state.proactiveRenewalManager = proactiveRenewalManager;
    wiring.state.bucketManager = bucketManager;
    wiring.state.tokenAccessCoordinator = tokenAccessCoordinator;
    wiring.state.authFlowOrchestrator = authFlowOrchestrator;
    wiring.state.authStatusService = authStatusService;

    wiring.ProviderRegistry.mockImplementation(() => providerRegistry);
    wiring.ProactiveRenewalManager.mockImplementation(
      () => proactiveRenewalManager,
    );
    wiring.OAuthBucketManager.mockImplementation(() => bucketManager);
    wiring.TokenAccessCoordinator.mockImplementation(
      () => tokenAccessCoordinator,
    );
    wiring.AuthFlowOrchestrator.mockImplementation(() => authFlowOrchestrator);
    wiring.AuthStatusService.mockImplementation(() => authStatusService);

    wiring.getAnthropicUsageInfo.mockResolvedValue(null);
    wiring.getAllAnthropicUsageInfo.mockResolvedValue(new Map());
    wiring.getAllCodexUsageInfo.mockResolvedValue(new Map());
    wiring.getAllGeminiUsageInfo.mockResolvedValue(new Map());
    wiring.getHigherPriorityAuth.mockResolvedValue(null);
  });

  it('constructs submodules, passes shared instances, and wires authenticator/delegate', () => {
    const tokenStore = createTokenStore();
    const config = {
      getEphemeralSetting: vi.fn(),
    } as unknown as import('@vybestack/llxprt-code-core').Config;
    const messageBus = {} as import('@vybestack/llxprt-code-core').MessageBus;
    const runtimeDeps: OAuthManagerRuntimeMessageBusDeps = {
      config,
      messageBus,
    };

    const manager = new OAuthManager(tokenStore, undefined, runtimeDeps);

    const providerRegistry = wiring.state.providerRegistry;
    const proactiveRenewalManager = wiring.state.proactiveRenewalManager;
    const bucketManager = wiring.state.bucketManager;
    const tokenAccessCoordinator = wiring.state.tokenAccessCoordinator;
    const authFlowOrchestrator = wiring.state.authFlowOrchestrator;

    expect(wiring.ProviderRegistry).toHaveBeenCalledWith(undefined);
    expect(wiring.ProactiveRenewalManager).toHaveBeenCalledWith(
      tokenStore,
      expect.any(Function),
      expect.any(Function),
    );
    expect(wiring.OAuthBucketManager).toHaveBeenCalledWith(tokenStore);

    expect(wiring.TokenAccessCoordinator).toHaveBeenCalledWith(
      tokenStore,
      providerRegistry,
      proactiveRenewalManager,
      bucketManager,
      manager,
      undefined,
      expect.any(Function),
    );

    expect(wiring.AuthFlowOrchestrator).toHaveBeenCalledWith(
      tokenStore,
      providerRegistry,
      manager,
      config,
      messageBus,
    );

    expect(wiring.AuthStatusService).toHaveBeenCalledWith(
      tokenStore,
      providerRegistry,
      proactiveRenewalManager,
      bucketManager,
      tokenAccessCoordinator,
    );

    expect(
      tokenAccessCoordinator.setGetProfileBucketsDelegate,
    ).toHaveBeenCalledTimes(1);
    expect(tokenAccessCoordinator.setAuthenticator).toHaveBeenCalledWith(
      authFlowOrchestrator,
    );
  });

  it('does not call facade methods during construction', () => {
    const getOAuthTokenSpy = vi.spyOn(OAuthManager.prototype, 'getOAuthToken');
    const authenticateMultipleBucketsSpy = vi.spyOn(
      OAuthManager.prototype,
      'authenticateMultipleBuckets',
    );

    new OAuthManager(createTokenStore());

    expect(getOAuthTokenSpy).not.toHaveBeenCalled();
    expect(authenticateMultipleBucketsSpy).not.toHaveBeenCalled();
  });

  it('delegates provider registry methods', async () => {
    const tokenStore = createTokenStore();
    const manager = new OAuthManager(tokenStore);
    const provider = createProvider('anthropic');

    const providerRegistry = wiring.state.providerRegistry as {
      registerProvider: ReturnType<typeof vi.fn>;
      getProvider: ReturnType<typeof vi.fn>;
      getSupportedProviders: ReturnType<typeof vi.fn>;
      toggleOAuthEnabled: ReturnType<typeof vi.fn>;
      isOAuthEnabled: ReturnType<typeof vi.fn>;
    };

    providerRegistry.getProvider.mockReturnValue(provider);
    providerRegistry.getSupportedProviders.mockReturnValue(['anthropic']);
    providerRegistry.toggleOAuthEnabled.mockReturnValue(true);
    providerRegistry.isOAuthEnabled.mockReturnValue(true);

    manager.registerProvider(provider);
    expect(providerRegistry.registerProvider).toHaveBeenCalledWith(provider);

    expect(manager.getProvider('anthropic')).toBe(provider);
    expect(providerRegistry.getProvider).toHaveBeenCalledWith('anthropic');

    expect(manager.getSupportedProviders()).toEqual(['anthropic']);

    await expect(manager.toggleOAuthEnabled('anthropic')).resolves.toBe(true);
    expect(providerRegistry.toggleOAuthEnabled).toHaveBeenCalledWith(
      'anthropic',
    );

    expect(manager.isOAuthEnabled('anthropic')).toBe(true);
    expect(providerRegistry.isOAuthEnabled).toHaveBeenCalledWith('anthropic');
  });

  it('delegates coordinator, orchestrator, status service, and usage module methods', async () => {
    const tokenStore = createTokenStore();
    const config = {
      getEphemeralSetting: vi.fn().mockReturnValue('https://api.example.test'),
    } as unknown as import('@vybestack/llxprt-code-core').Config;
    const settings = {
      merged: {},
    } as unknown as import('../config/settings.js').LoadedSettings;

    const manager = new OAuthManager(tokenStore, settings, { config });

    const tokenAccessCoordinator = wiring.state.tokenAccessCoordinator as {
      getToken: ReturnType<typeof vi.fn>;
      peekStoredToken: ReturnType<typeof vi.fn>;
      getOAuthToken: ReturnType<typeof vi.fn>;
      getCurrentProfileSessionBucket: ReturnType<typeof vi.fn>;
      getCurrentProfileSessionMetadata: ReturnType<typeof vi.fn>;
      doGetProfileBuckets: ReturnType<typeof vi.fn>;
    };
    const authFlowOrchestrator = wiring.state.authFlowOrchestrator as {
      authenticate: ReturnType<typeof vi.fn>;
      authenticateMultipleBuckets: ReturnType<typeof vi.fn>;
      setRuntimeMessageBus: ReturnType<typeof vi.fn>;
    };
    const authStatusService = wiring.state.authStatusService as {
      getAuthStatus: ReturnType<typeof vi.fn>;
      isAuthenticated: ReturnType<typeof vi.fn>;
      logout: ReturnType<typeof vi.fn>;
      logoutAll: ReturnType<typeof vi.fn>;
      logoutAllBuckets: ReturnType<typeof vi.fn>;
      listBuckets: ReturnType<typeof vi.fn>;
      getAuthStatusWithBuckets: ReturnType<typeof vi.fn>;
    };
    const providerRegistry = wiring.state.providerRegistry as {
      getProvider: ReturnType<typeof vi.fn>;
    };

    const tokenObj: OAuthToken = {
      access_token: 'oauth-token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
    };

    tokenAccessCoordinator.getToken.mockResolvedValue('oauth-token');
    tokenAccessCoordinator.peekStoredToken.mockResolvedValue(tokenObj);
    tokenAccessCoordinator.getOAuthToken.mockResolvedValue(tokenObj);
    tokenAccessCoordinator.getCurrentProfileSessionMetadata.mockResolvedValue({
      providerId: 'anthropic',
      profileId: 'p1',
    });
    tokenAccessCoordinator.getCurrentProfileSessionBucket.mockResolvedValue(
      'bucket-a',
    );
    tokenAccessCoordinator.doGetProfileBuckets.mockResolvedValue(['bucket-a']);

    authStatusService.getAuthStatus.mockResolvedValue([
      { provider: 'anthropic', authenticated: true, oauthEnabled: true },
    ]);
    authStatusService.isAuthenticated.mockResolvedValue(true);
    authStatusService.listBuckets.mockResolvedValue(['bucket-a']);
    authStatusService.getAuthStatusWithBuckets.mockResolvedValue([
      {
        bucket: 'bucket-a',
        authenticated: true,
        isSessionBucket: true,
      },
    ]);

    providerRegistry.getProvider.mockImplementation((name: string) => {
      return name === 'anthropic' ? createProvider('anthropic') : undefined;
    });

    wiring.getHigherPriorityAuth.mockResolvedValue('API Key');
    wiring.getAnthropicUsageInfo.mockResolvedValue({ usage: 1 });
    wiring.getAllAnthropicUsageInfo.mockResolvedValue(
      new Map([['bucket-a', { usage: 1 }]]),
    );
    wiring.getAllCodexUsageInfo.mockResolvedValue(
      new Map([['bucket-a', { usage: 2 }]]),
    );
    wiring.getAllGeminiUsageInfo.mockResolvedValue(
      new Map([['bucket-a', { usage: 3 }]]),
    );

    await expect(manager.getToken('anthropic')).resolves.toBe('oauth-token');
    expect(tokenAccessCoordinator.getToken).toHaveBeenCalledWith(
      'anthropic',
      undefined,
    );

    await expect(manager.peekStoredToken('anthropic')).resolves.toEqual(
      tokenObj,
    );
    await expect(manager.getOAuthToken('anthropic')).resolves.toEqual(tokenObj);

    await manager.authenticate('anthropic', 'bucket-a');
    expect(authFlowOrchestrator.authenticate).toHaveBeenCalledWith(
      'anthropic',
      'bucket-a',
    );

    await manager.authenticateMultipleBuckets('anthropic', ['bucket-a']);
    expect(
      authFlowOrchestrator.authenticateMultipleBuckets,
    ).toHaveBeenCalledWith('anthropic', ['bucket-a'], undefined);

    await expect(manager.getAuthStatus()).resolves.toEqual([
      { provider: 'anthropic', authenticated: true, oauthEnabled: true },
    ]);
    await expect(manager.isAuthenticated('anthropic')).resolves.toBe(true);

    await manager.logout('anthropic', 'bucket-a');
    expect(authStatusService.logout).toHaveBeenCalledWith(
      'anthropic',
      'bucket-a',
    );

    await manager.logoutAll();
    expect(authStatusService.logoutAll).toHaveBeenCalledTimes(1);

    await manager.logoutAllBuckets('anthropic');
    expect(authStatusService.logoutAllBuckets).toHaveBeenCalledWith(
      'anthropic',
    );

    await expect(manager.listBuckets('anthropic')).resolves.toEqual([
      'bucket-a',
    ]);
    await expect(
      manager.getAuthStatusWithBuckets('anthropic'),
    ).resolves.toEqual([
      {
        bucket: 'bucket-a',
        authenticated: true,
        isSessionBucket: true,
      },
    ]);

    await expect(manager.getHigherPriorityAuth('anthropic')).resolves.toBe(
      'API Key',
    );
    expect(wiring.getHigherPriorityAuth).toHaveBeenCalledWith(
      'anthropic',
      settings,
    );

    await expect(manager.getAnthropicUsageInfo()).resolves.toEqual({
      usage: 1,
    });
    expect(wiring.getAnthropicUsageInfo).toHaveBeenCalledWith(
      tokenStore,
      'bucket-a',
    );

    await expect(manager.getAllAnthropicUsageInfo()).resolves.toEqual(
      new Map([['bucket-a', { usage: 1 }]]),
    );
    expect(wiring.getAllAnthropicUsageInfo).toHaveBeenCalledWith(tokenStore);

    await expect(manager.getAllCodexUsageInfo()).resolves.toEqual(
      new Map([['bucket-a', { usage: 2 }]]),
    );
    expect(wiring.getAllCodexUsageInfo).toHaveBeenCalledWith(
      tokenStore,
      config,
    );

    await expect(manager.getAllGeminiUsageInfo()).resolves.toEqual(
      new Map([['bucket-a', { usage: 3 }]]),
    );
    expect(wiring.getAllGeminiUsageInfo).toHaveBeenCalledWith(tokenStore);

    const bus = {} as import('@vybestack/llxprt-code-core').MessageBus;
    manager.runtimeMessageBus = bus;
    expect(authFlowOrchestrator.setRuntimeMessageBus).toHaveBeenCalledWith(bus);
  });

  it('returns null for anthropic usage when anthropic provider is not registered', async () => {
    const tokenStore = createTokenStore();
    const manager = new OAuthManager(tokenStore);

    const providerRegistry = wiring.state.providerRegistry as {
      getProvider: ReturnType<typeof vi.fn>;
    };
    providerRegistry.getProvider.mockReturnValue(undefined);

    await expect(manager.getAnthropicUsageInfo()).resolves.toBeNull();
    expect(wiring.getAnthropicUsageInfo).not.toHaveBeenCalled();
  });

  it('satisfies BucketFailoverOAuthManagerLike at compile-time', () => {
    const manager = new OAuthManager(createTokenStore());
    const managerLike: BucketFailoverOAuthManagerLike = manager;
    expect(managerLike).toBeDefined();
  });
});
