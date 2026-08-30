/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { BucketStats } from '@vybestack/llxprt-code-auth';
import { OAuthBucketManager } from '../OAuthBucketManager.js';
import {
  InteractiveAuthCancelledError,
  InteractiveAuthError,
  InteractiveAuthUnavailableError,
  interactiveAuthCoordinator,
  type InteractiveAuthChallenge,
} from '../interactive-auth-coordinator.js';
import { ProactiveRenewalManager } from '../proactive-renewal-manager.js';
import { ProviderRegistry } from '../provider-registry.js';
import { oauthRuntimeBridge } from '../runtime-accessor-bridge.js';
import { TokenAccessCoordinator } from '../token-access-coordinator.js';
import type {
  AuthCompletionOptions,
  BucketFailoverOAuthManagerLike,
  OAuthProvider,
  OAuthToken,
  OAuthTokenRequestMetadata,
  TokenStore,
} from '../types.js';
import {
  resetCliRuntimeRegistryForTesting,
  setDefaultCliRuntimeId,
  upsertRuntimeEntry,
  type RuntimeKind,
} from '../../runtime/runtimeRegistry.js';

const PROVIDER = 'codex';
const BUCKET = 'work';

function makeToken(accessToken: string): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + 3_600,
    token_type: 'Bearer',
    scope: null,
  };
}

class InMemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, OAuthToken>();

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket = 'default',
  ): Promise<void> {
    this.tokens.set(`${provider}:${bucket}`, token);
  }

  async getToken(
    provider: string,
    bucket = 'default',
  ): Promise<OAuthToken | null> {
    return this.tokens.get(`${provider}:${bucket}`) ?? null;
  }

  async removeToken(provider: string, bucket = 'default'): Promise<void> {
    this.tokens.delete(`${provider}:${bucket}`);
  }

  async listProviders(): Promise<string[]> {
    return [];
  }

  async listBuckets(_provider: string): Promise<string[]> {
    return [];
  }

  async getBucketStats(
    _provider: string,
    _bucket: string,
  ): Promise<BucketStats | null> {
    return null;
  }

  async acquireRefreshLock(
    _provider: string,
    _options?: { waitMs?: number; bucket?: string },
  ): Promise<boolean> {
    return true;
  }

  async releaseRefreshLock(
    _provider: string,
    _bucket?: string,
  ): Promise<void> {}

  async acquireAuthLock(
    _provider: string,
    _options?: {
      waitMs?: number;
      bucket?: string;
      onWait?: () => Promise<boolean>;
    },
  ): Promise<boolean> {
    return true;
  }

  async releaseAuthLock(_provider: string, _bucket?: string): Promise<void> {}
}

class RecordingFacade implements BucketFailoverOAuthManagerLike {
  readonly sessionBuckets = new Map<string, string>();
  authenticateCallCount = 0;
  authenticateMultipleBucketsCallCount = 0;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly events: string[],
  ) {}

  getSessionBucket(
    provider: string,
    _metadata?: OAuthTokenRequestMetadata,
  ): string | undefined {
    return this.sessionBuckets.get(provider);
  }

  setSessionBucket(
    provider: string,
    bucket: string,
    _metadata?: OAuthTokenRequestMetadata,
  ): void {
    this.sessionBuckets.set(provider, bucket);
  }

  getOAuthToken(
    providerName: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    return this.tokenStore.getToken(providerName, bucket);
  }

  async authenticate(
    providerName: string,
    bucket = 'default',
    _options?: AuthCompletionOptions,
  ): Promise<void> {
    this.authenticateCallCount += 1;
    this.events.push('local-auth');
    await this.tokenStore.saveToken(
      providerName,
      makeToken('legacy-direct-token'),
      bucket,
    );
  }

  async authenticateMultipleBuckets(
    providerName: string,
    buckets: string[],
    _requestMetadata?: OAuthTokenRequestMetadata,
  ): Promise<void> {
    this.authenticateMultipleBucketsCallCount += 1;
    const bucket = buckets[0] ?? 'default';
    await this.authenticate(providerName, bucket);
  }

  getTokenStore(): TokenStore {
    return this.tokenStore;
  }

  forceRefreshToken(
    _providerName: string,
    _failedAccessToken: string,
    _bucket?: string,
  ): Promise<OAuthToken | null> {
    return Promise.resolve(null);
  }
}

interface AuthHarness {
  readonly coordinator: TokenAccessCoordinator;
  readonly facade: RecordingFacade;
  readonly tokenStore: InMemoryTokenStore;
  readonly events: string[];
}

function createHarness(): AuthHarness {
  const events: string[] = [];
  const tokenStore = new InMemoryTokenStore();
  const registry = new ProviderRegistry();
  const provider: OAuthProvider = {
    name: PROVIDER,
    initiateAuth: async () => makeToken('unused-provider-token'),
    getToken: async () => null,
    refreshToken: async () => null,
  };
  registry.registerProvider(provider);
  registry.setOAuthEnabledState(PROVIDER, true);
  const renewalManager = new ProactiveRenewalManager(
    tokenStore,
    (providerName) => registry.getProvider(providerName),
    (providerName) => registry.isOAuthEnabled(providerName),
  );
  const bucketManager = new OAuthBucketManager(tokenStore);
  const facade = new RecordingFacade(tokenStore, events);
  const coordinator = new TokenAccessCoordinator(
    tokenStore,
    registry,
    renewalManager,
    bucketManager,
    facade,
  );
  coordinator.setAuthenticator(facade);
  coordinator.setGetProfileBucketsDelegate(async () => [BUCKET]);

  return { coordinator, facade, tokenStore, events };
}

function registerRuntime(runtimeKind: RuntimeKind): void {
  const runtimeId = `p04-${runtimeKind}`;
  upsertRuntimeEntry(runtimeId, { runtimeKind });
  setDefaultCliRuntimeId(runtimeId);
}

function getOnlyChallenge(
  challenges: readonly InteractiveAuthChallenge[],
): InteractiveAuthChallenge {
  if (challenges.length === 0) {
    throw new Error('Expected one interactive authentication challenge');
  }
  return challenges[0];
}

/**
 * @plan PLAN-20260827-ISSUE2562.P04
 * @requirement REQ-2562-3
 */
describe('TokenAccessCoordinator host-owned authentication escalation', () => {
  beforeEach(async () => {
    await interactiveAuthCoordinator.dispose();
    interactiveAuthCoordinator.unbindHost();
    resetCliRuntimeRegistryForTesting();
    oauthRuntimeBridge.setAccessors({
      getEphemeralSetting: () => undefined,
      getProviderManager: () => undefined,
      getRuntimeContext: () => undefined,
      getCurrentProfileName: () => null,
      getInteractiveAuthTimeoutMs: () => 5_000,
    });
  });

  afterEach(async () => {
    await interactiveAuthCoordinator.dispose();
    interactiveAuthCoordinator.unbindHost();
    resetCliRuntimeRegistryForTesting();
    oauthRuntimeBridge.setAccessors(undefined);
  });

  it('escalates subagent lazy auth to the host and re-reads the persisted token before request work', async () => {
    const harness = createHarness();
    const challenges: InteractiveAuthChallenge[] = [];
    registerRuntime('subagent');
    interactiveAuthCoordinator.bindHost(async (challenge) => {
      challenges.push(challenge);
      harness.events.push('host-challenge');
      await harness.tokenStore.saveToken(
        challenge.provider,
        makeToken('host-token'),
        challenge.bucket,
      );
    });

    const token = await harness.coordinator.getToken(PROVIDER, BUCKET);
    harness.events.push('request-start');

    expect(token).toBe('host-token');
    expect(harness.facade.authenticateCallCount).toBe(0);
    expect(challenges).toHaveLength(1);
    const challenge = getOnlyChallenge(challenges);
    expect(challenge.provider).toBe(PROVIDER);
    expect(challenge.bucket).toBe(BUCKET);
    expect(challenge.requester.runtimeKind).toBe('subagent');
    expect(challenge.requester.runtimeId).toBe('p04-subagent');
    expect(challenge.reason).toBe('authentication-required');
    expect(challenge.correlationId.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(challenge, 'credentials')).toBe(
      false,
    );
    expect(harness.events).toEqual(['host-challenge', 'request-start']);
  });

  it('marks escalation after expired credential refresh failure as reauthentication', async () => {
    const harness = createHarness();
    const challenges: InteractiveAuthChallenge[] = [];
    registerRuntime('subagent');
    await harness.tokenStore.saveToken(
      PROVIDER,
      { ...makeToken('expired-token'), expiry: 1 },
      BUCKET,
    );
    interactiveAuthCoordinator.bindHost(async (challenge) => {
      challenges.push(challenge);
      await harness.tokenStore.saveToken(
        challenge.provider,
        makeToken('replacement-token'),
        challenge.bucket,
      );
    });

    const token = await harness.coordinator.getToken(PROVIDER, BUCKET);

    expect(token).toBe('replacement-token');
    expect(getOnlyChallenge(challenges).reason).toBe(
      'reauthentication-required',
    );
  });

  it('fails immediately when a subagent has no interactive host', async () => {
    const harness = createHarness();
    registerRuntime('subagent');

    const auth = harness.coordinator.getToken(PROVIDER, BUCKET);

    await expect(auth).rejects.toBeInstanceOf(InteractiveAuthUnavailableError);
    expect(harness.facade.authenticateCallCount).toBe(0);
    expect(interactiveAuthCoordinator.getActiveSessions()).toEqual([]);
  });

  it('surfaces host cancellation as a typed host-directed error', async () => {
    const harness = createHarness();
    registerRuntime('subagent');
    interactiveAuthCoordinator.bindHost(async () => {
      throw new DOMException('Host cancelled authentication', 'AbortError');
    });

    const auth = harness.coordinator.getToken(PROVIDER, BUCKET);

    await expect(auth).rejects.toBeInstanceOf(InteractiveAuthCancelledError);
    const error = await auth.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InteractiveAuthCancelledError);
    if (!(error instanceof Error)) {
      throw new Error('Expected authentication cancellation error');
    }
    expect(error.message).toContain('cancelled at the host');
    expect(error.message).not.toContain('auth dialog will open');
    expect(error.message).not.toContain('authenticate in this context');
    expect(harness.facade.authenticateCallCount).toBe(0);
  });

  it('carries a host failure message in a typed interactive authentication error', async () => {
    const harness = createHarness();
    registerRuntime('subagent');
    interactiveAuthCoordinator.bindHost(async () => {
      throw new Error('Host authorization code was rejected');
    });

    const error = await harness.coordinator
      .getToken(PROVIDER, BUCKET)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InteractiveAuthError);
    if (!(error instanceof InteractiveAuthError)) {
      throw new Error('Expected typed interactive authentication error');
    }
    expect(error.outcomeKind).toBe('failed');
    expect(error.message).toContain('Host authorization code was rejected');
    expect(error.message).toContain('failed at the host');
    expect(harness.facade.authenticateCallCount).toBe(0);
  });

  it('surfaces host session expiry as a typed interactive authentication error', async () => {
    const harness = createHarness();
    registerRuntime('subagent');
    oauthRuntimeBridge.setAccessors({
      getEphemeralSetting: () => undefined,
      getProviderManager: () => undefined,
      getRuntimeContext: () => undefined,
      getCurrentProfileName: () => null,
      getInteractiveAuthTimeoutMs: () => 200,
    });
    interactiveAuthCoordinator.bindHost(
      () => new Promise<void>(() => undefined),
    );

    const error = await harness.coordinator
      .getToken(PROVIDER, BUCKET)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InteractiveAuthError);
    if (!(error instanceof InteractiveAuthError)) {
      throw new Error('Expected typed interactive authentication error');
    }
    expect(error.outcomeKind).toBe('timed_out');
    expect(error.message).toContain('expired at the host');
    expect(harness.facade.authenticateCallCount).toBe(0);
  });

  it('routes a host runtime through the coordinator when a host is bound', async () => {
    const harness = createHarness();
    const challenges: InteractiveAuthChallenge[] = [];
    registerRuntime('cli-interactive');
    interactiveAuthCoordinator.bindHost(async (challenge) => {
      challenges.push(challenge);
      await harness.tokenStore.saveToken(
        challenge.provider,
        makeToken('coordinated-host-token'),
        challenge.bucket,
      );
    });

    const token = await harness.coordinator.getToken(PROVIDER, BUCKET);

    expect(token).toBe('coordinated-host-token');
    expect(challenges).toHaveLength(1);
    expect(getOnlyChallenge(challenges).requester.runtimeKind).toBe(
      'cli-interactive',
    );
    expect(harness.facade.authenticateCallCount).toBe(0);
  });

  it('preserves the legacy direct path for a host runtime without a bound host', async () => {
    const harness = createHarness();
    registerRuntime('cli-interactive');

    const token = await harness.coordinator.getToken(PROVIDER, BUCKET);

    expect(token).toBe('legacy-direct-token');
    expect(harness.facade.authenticateCallCount).toBe(1);
    expect(harness.events).toEqual(['local-auth']);
  });
});
