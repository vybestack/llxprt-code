/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral proof for issue #2643 acceptance criterion: two OAuth members of
 * one load balancer using different accounts of the same provider each
 * authenticate as their own account (no cross-substitution, no shared default).
 *
 * The chain under test is the real one a delegate call drives:
 *   buildResolvedSubProfileOptions → metadata.profileId = member name
 *   → resolveProfileBuckets(provider, { profileId }) → member-scoped buckets.
 *
 * Real ProfileManager and real profile files under the isolated storage root set up
 * by the bun test harness preload (scripts/tests/storage-isolation-guard.ts).
 * No mocks of the code under test.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { randomUUID } from 'node:crypto';

import {
  ProfileManager,
  SettingsService,
  type StandardProfile,
  type LoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';
import { resolveProfileBuckets } from '../token-profile-resolver.js';
import { buildRoundRobinResolvedOptions } from '../../loadBalancing/resolvedOptionsBuilder.js';
import type { ResolvedSubProfile } from '../../LoadBalancingProvider.js';
import type { GenerateChatOptions } from '../../IProvider.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../../BaseProvider.js';
import { OAuthManager } from '../oauth-manager.js';
import { OAuthBucketManager } from '../OAuthBucketManager.js';
import {
  MemoryTokenStore,
  makeToken,
  createTestProvider,
} from './behavioral/test-utils.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  AuthPrecedenceResolver,
  flushRuntimeAuthScope,
  runtimeScopedStates,
  type OAuthTokenRequestMetadata,
} from '@vybestack/llxprt-code-auth';

class RecordingOAuthManager extends OAuthManager {
  readonly requests: Array<OAuthTokenRequestMetadata | undefined> = [];

  override async getToken(
    provider: string,
    metadata?: OAuthTokenRequestMetadata,
  ): Promise<string | null> {
    this.requests.push(metadata);
    return super.getToken(provider, metadata);
  }
}

class AuthProbeProvider extends BaseProvider {
  protected supportsOAuth(): boolean {
    return true;
  }
  async getModels(): Promise<never[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'm1';
  }
  protected async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const token = options.resolved.authToken;
    if (typeof token !== 'string')
      throw new Error('Expected resolved OAuth token');
    yield { speaker: 'ai', blocks: [{ type: 'text', text: token }] };
  }
}

const PROVIDER = 'llbx-oauth-test';
const uniqueSuffix = `${Date.now()}-${randomUUID()}`;
const memberAName = `lb-member-a-${uniqueSuffix}`;
const memberBName = `lb-member-b-${uniqueSuffix}`;
const lbParentName = `lb-parent-${uniqueSuffix}`;

const noopLogger = new DebugLogger('llxprt:test:lb-member-auth');

describe('load balancer member OAuth identity (#2643)', () => {
  let manager: ProfileManager | undefined;

  async function createFixtureProfiles(): Promise<ProfileManager> {
    if (process.env.LLXPRT_TEST_STORAGE_ISOLATED !== '1') {
      throw new Error(
        'lb-member-auth-identity tests require isolated storage (preload guard)',
      );
    }

    const fixtureManager = new ProfileManager();

    const memberA: StandardProfile = {
      version: 1,
      provider: PROVIDER,
      model: 'm1',
      modelParams: {},
      ephemeralSettings: {},
      auth: { type: 'oauth', buckets: ['acct-alpha'] },
    };
    const memberB: StandardProfile = {
      version: 1,
      provider: PROVIDER,
      model: 'm1',
      modelParams: {},
      ephemeralSettings: {},
      auth: { type: 'oauth', buckets: ['acct-beta'] },
    };
    const lbParent: LoadBalancerProfile = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: [memberAName, memberBName],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };

    await fixtureManager.saveProfile(memberAName, memberA);
    await fixtureManager.saveProfile(memberBName, memberB);
    await fixtureManager.saveProfile(lbParentName, lbParent);

    return fixtureManager;
  }

  async function cleanupProfiles(): Promise<void> {
    if (!manager) {
      return;
    }
    // The load balancer references its members, so delete the parent first.
    await manager.deleteProfile(lbParentName).catch((error) => {
      if (!(error instanceof Error) || !error.message.includes('not found')) {
        throw error;
      }
    });
    await manager.deleteProfile(memberAName).catch((error) => {
      if (!(error instanceof Error) || !error.message.includes('not found')) {
        throw error;
      }
    });
    await manager.deleteProfile(memberBName).catch((error) => {
      if (!(error instanceof Error) || !error.message.includes('not found')) {
        throw error;
      }
    });
  }

  afterEach(async () => {
    await cleanupProfiles();
    manager = undefined;
  });

  it('member-scoped bucket resolution returns each member its own account', async () => {
    manager = await createFixtureProfiles();

    const bucketsA = await resolveProfileBuckets(PROVIDER, {
      profileId: memberAName,
    });
    const bucketsB = await resolveProfileBuckets(PROVIDER, {
      profileId: memberBName,
    });

    expect(bucketsA).toStrictEqual(['acct-alpha']);
    expect(bucketsB).toStrictEqual(['acct-beta']);
  });

  it('ambient lookup cannot identify member buckets (old failure mode)', async () => {
    manager = await createFixtureProfiles();

    // No metadata: oauthRuntimeBridge has no current profile in tests, so the
    // bucket resolution has no member to scope to and returns no buckets. The LB
    // parent has provider '' so it can never match the requested provider either.
    const buckets = await resolveProfileBuckets(PROVIDER);
    expect(buckets).toStrictEqual([]);
  });

  it('two members never cross-substitute buckets', async () => {
    manager = await createFixtureProfiles();

    const [bucketsA, bucketsB] = await Promise.all([
      resolveProfileBuckets(PROVIDER, { profileId: memberAName }),
      resolveProfileBuckets(PROVIDER, { profileId: memberBName }),
    ]);

    expect(bucketsA).toStrictEqual(['acct-alpha']);
    expect(bucketsB).toStrictEqual(['acct-beta']);
  });

  it('BaseProvider resolves each delegate through its own OAuth profile and session bucket', async () => {
    manager = await createFixtureProfiles();
    const store = new MemoryTokenStore();
    await store.saveToken(PROVIDER, makeToken('alpha-token'), 'acct-alpha');
    await store.saveToken(PROVIDER, makeToken('beta-token'), 'acct-beta');
    await store.saveToken(PROVIDER, makeToken('ambient-token'));
    const oauth = new RecordingOAuthManager(store);
    oauth.registerProvider(createTestProvider(PROVIDER));
    await oauth.toggleOAuthEnabled(PROVIDER);
    const buckets = new OAuthBucketManager(store);
    const settings = new SettingsService();
    settings.setCurrentProfileName(lbParentName);
    settings.set('authOnly', false);
    settings.setProviderSetting(PROVIDER, 'auth-key', 'ambient-provider-key');
    const config = createRuntimeConfigStub(settings);
    const runtime = {
      settingsService: settings,
      config,
      runtimeId: lbParentName,
    };
    const delegate = new AuthProbeProvider(
      {
        name: PROVIDER,
        supportsOAuth: true,
        isOAuthEnabled: true,
        oauthProvider: PROVIDER,
        oauthManager: oauth,
      },
      undefined,
      config,
      settings,
    );
    const observed: IContent[] = [];
    try {
      for (const name of [memberAName, memberBName, memberAName]) {
        const options = buildRoundRobinResolvedOptions(
          {
            name,
            providerName: PROVIDER,
            model: 'm1',
            ephemeralSettings: {},
            modelParams: {},
            auth: { type: 'oauth' },
          },
          { contents: [], settings, config, runtime },
          {
            lbProfileEphemeralSettings: undefined,
            lbProfileModelParams: undefined,
            logger: noopLogger,
            providerName: 'load-balancer',
            getEffectiveContextLimit: () => undefined,
          },
        );
        for await (const chunk of delegate.generateChatCompletion(options))
          observed.push(chunk);
      }
      expect(observed).toStrictEqual([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'alpha-token' }] },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'beta-token' }] },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'alpha-token' }] },
      ]);
      expect(oauth.requests.map((request) => request?.profileId)).toStrictEqual(
        [memberAName, memberBName, memberAName],
      );
      expect(
        oauth.requests.map((request) =>
          buckets.getSessionBucketScopeKey(PROVIDER, request),
        ),
      ).toStrictEqual([
        `${PROVIDER}::${memberAName}`,
        `${PROVIDER}::${memberBName}`,
        `${PROVIDER}::${memberAName}`,
      ]);
      expect(
        oauth.getSessionBucket(PROVIDER, { profileId: memberAName }),
      ).toStrictEqual('acct-alpha');
      expect(
        oauth.getSessionBucket(PROVIDER, { profileId: memberBName }),
      ).toStrictEqual('acct-beta');
    } finally {
      flushRuntimeAuthScope(lbParentName);
      clearActiveProviderRuntimeContext();
    }
  });

  it('scopes runtime token caches by explicit member and retains ambient fallback', async () => {
    expect(runtimeScopedStates.has(lbParentName)).toStrictEqual(false);
    manager = await createFixtureProfiles();
    const store = new MemoryTokenStore();
    await store.saveToken(PROVIDER, makeToken('alpha-token'), 'acct-alpha');
    await store.saveToken(PROVIDER, makeToken('beta-token'), 'acct-beta');
    const oauth = new RecordingOAuthManager(store);
    oauth.registerProvider(createTestProvider(PROVIDER));
    await oauth.toggleOAuthEnabled(PROVIDER);
    const settings = new SettingsService();
    settings.setCurrentProfileName(memberAName);
    const runtime = { settingsService: settings, runtimeId: lbParentName };
    const resolver = new AuthPrecedenceResolver(
      {
        providerId: PROVIDER,
        oauthProvider: PROVIDER,
        isOAuthEnabled: true,
        supportsOAuth: true,
      },
      {
        settingsService: settings,
        oauthManager: oauth,
        getActiveRuntimeContext: () => runtime,
      },
    );
    try {
      const tokens: Array<string | null> = [];
      for (const profileId of [
        memberAName,
        memberBName,
        undefined,
        memberBName,
      ]) {
        const result = await resolver.resolveAuthenticationResult({
          includeOAuth: true,
          profileId,
        });
        tokens.push(result.token);
      }
      expect(tokens).toStrictEqual([
        'alpha-token',
        'beta-token',
        'alpha-token',
        'beta-token',
      ]);
      expect(oauth.requests.map((request) => request?.profileId)).toStrictEqual(
        [memberAName, memberBName],
      );
      expect([
        ...(runtimeScopedStates.get(lbParentName)?.entries.keys() ?? []),
      ]).toStrictEqual([
        `${lbParentName}::${PROVIDER}::${memberAName}`,
        `${lbParentName}::${PROVIDER}::${memberBName}`,
      ]);
    } finally {
      flushRuntimeAuthScope(lbParentName);
    }
  });

  it('delegate options carry the member identity', async () => {
    const subProfile: ResolvedSubProfile = {
      name: memberAName,
      providerName: PROVIDER,
      model: 'm1',
      ephemeralSettings: {},
      modelParams: {},
    };

    const options: GenerateChatOptions = {
      contents: [],
      metadata: {},
    };

    const result = buildRoundRobinResolvedOptions(subProfile, options, {
      lbProfileEphemeralSettings: undefined,
      lbProfileModelParams: undefined,
      logger: noopLogger,
      providerName: 'llb',
      getEffectiveContextLimit: () => undefined,
    });

    expect(result.metadata?.profileId).toBe(memberAName);
  });
});
