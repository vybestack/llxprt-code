import { createProviderConfigFixture } from '../runtime/__tests__/provider-config-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';

import { afterEach, describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { assembleCliProviderRuntime } from '../runtime/assembleCliProviderRuntime.js';
import { OAuthManager } from './oauth-manager.js';
import {
  MemoryTokenStore,
  createTestProvider,
  makeToken,
} from './__tests__/behavioral/test-utils.js';
import {
  interactiveAuthCoordinator,
  InteractiveAuthUnavailableError,
  type InteractiveAuthChallenge,
} from './interactive-auth-coordinator.js';
import {
  createIsolatedRuntimeContext,
  type IsolatedRuntimeContextHandle,
  type RuntimeActivationBindings,
} from '../runtime/runtimeContextFactory.js';
import { requestInteractiveAuthentication } from './interactive-auth-request.js';

const activationBindings: RuntimeActivationBindings = {
  resetInfrastructure: () => {},
  setRuntimeContext: () => {},
  registerInfrastructure: () => {},
  linkProviderManager: (config, manager) => {
    configureProviderRuntimeFactories(config, manager);
  },
};

describe('explicit OAuth owner identity', () => {
  const configs: Config[] = [];
  const handles: IsolatedRuntimeContextHandle[] = [];
  function ownedRuntime(
    options: Omit<
      Parameters<typeof createIsolatedRuntimeContext>[0],
      'activationBindings'
    >,
    settingsService: SettingsService,
  ): IsolatedRuntimeContextHandle {
    const handle = createIsolatedRuntimeContext(
      {
        ...options,
        activationBindings,
      },
      settingsService,
    );
    handles.push(handle);
    return handle;
  }
  afterEach(async () => {
    await interactiveAuthCoordinator.dispose();
    interactiveAuthCoordinator.unbindHost();
    await Promise.all(handles.splice(0).map((handle) => handle.cleanup()));
    await Promise.all(configs.splice(0).map((config) => config.dispose()));
  });
  function ownerConfig(): ReturnType<typeof createProviderConfigFixture> {
    const root = createProviderConfigFixture({
      sessionId: 'same-label',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test',
      settingsService: new SettingsService(),
    });
    root.settingsOwner.writeUserParameter('auth-key', 'test-key');
    configs.push(root.config);
    return root;
  }
  function owner(runtimeKind: RuntimeKind) {
    return (() => {
      const {
        config: capturedConfig3,
        settingsService,
        settingsOwner,
      } = ownerConfig();
      return ownedRuntime(
        {
          config: capturedConfig3,
          settingsOwner,
          runtimeId: 'same-label',
          runtimeKind,
        },
        settingsService,
      );
    })();
  }
  it('gives same-label runtime owners distinct default credential stores', () => {
    const first = owner('agent');
    const second = owner('agent');
    expect(first.oauthManager.getTokenStore()).not.toBe(
      second.oauthManager.getTokenStore(),
    );
  });
  it('keeps caller-owned credentials separate across interleaved same-label runtimes', async () => {
    const firstStore = new MemoryTokenStore();
    const secondStore = new MemoryTokenStore();
    const first = (() => {
      const {
        config: capturedConfig4,
        settingsService,
        settingsOwner,
      } = ownerConfig();
      return ownedRuntime(
        {
          runtimeId: 'same-label',
          tokenStore: firstStore,
          config: capturedConfig4,
          settingsOwner,
        },
        settingsService,
      );
    })();
    const second = (() => {
      const {
        config: capturedConfig5,
        settingsService,
        settingsOwner,
      } = ownerConfig();
      return ownedRuntime(
        {
          runtimeId: 'same-label',
          tokenStore: secondStore,
          config: capturedConfig5,
          settingsOwner,
        },
        settingsService,
      );
    })();
    expect(first.oauthManager.getTokenStore()).toBe(firstStore);
    expect(second.oauthManager.getTokenStore()).toBe(secondStore);
    await Promise.all([
      (async () => {
        await Promise.resolve();
        await first.oauthManager
          .getTokenStore()
          .saveToken('codex', makeToken('first'));
      })(),
      (async () => {
        await Promise.resolve();
        await second.oauthManager
          .getTokenStore()
          .saveToken('codex', makeToken('second'));
      })(),
    ]);
    expect((await firstStore.getToken('codex'))?.access_token).toBe('first');
    expect((await secondStore.getToken('codex'))?.access_token).toBe('second');
  });
  async function enable(oauth: OAuthManager): Promise<void> {
    oauth.registerProvider(createTestProvider('owner-identity'));
    if (!oauth.isOAuthEnabled('owner-identity'))
      await oauth.toggleOAuthEnabled('owner-identity');
  }
  it('routes same-label owners outside ALS independently and reads activation overrides', async () => {
    const first = owner('agent');
    const second = owner('cli-interactive');
    await enable(first.oauthManager);
    await enable(second.oauthManager);
    const challenges: InteractiveAuthChallenge[] = [];
    interactiveAuthCoordinator.bindHost(async (challenge) => {
      challenges.push(challenge);
    });
    await Promise.all([
      first.oauthManager.getToken('owner-identity', 'alpha'),
      second.oauthManager.getToken('owner-identity', 'beta'),
    ]);
    expect(
      [...challenges]
        .sort((a, b) => a.bucket.localeCompare(b.bucket))
        .map((c) => c.requester),
    ).toStrictEqual([
      { runtimeKind: 'agent', runtimeId: 'same-label' },
      { runtimeKind: 'cli-interactive', runtimeId: 'same-label' },
    ]);
    await first.activate({
      runtimeId: 'activated-owner',
      runtimeKind: 'subagent',
    });

    await second.oauthManager.getToken('owner-identity', 'gamma');
    await first.oauthManager.getToken('owner-identity', 'delta');
    expect(challenges.slice(2).map((c) => c.requester)).toStrictEqual([
      { runtimeKind: 'cli-interactive', runtimeId: 'same-label' },
      { runtimeKind: 'subagent', runtimeId: 'activated-owner' },
    ]);
  });
  it('reads CLI manager identity changes without borrowing the active runtime', async () => {
    const isolated = owner('agent');
    const cli = assembleCliProviderRuntime({
      config: isolated.config,
      settingsService: isolated.settingsService,
      runtimeId: 'foreground',
      metadata: { source: 'cli-bootstrap' },
    });
    if (!cli.oauthManager) throw new Error('Expected assembled OAuth manager');
    await enable(cli.oauthManager);
    const challenges: InteractiveAuthChallenge[] = [];
    interactiveAuthCoordinator.bindHost(async (challenge) => {
      challenges.push(challenge);
    });

    await cli.oauthManager.getToken('owner-identity', 'bootstrap');
    cli.providerManager.setRuntimeContext({
      ...cli.runtime,
      runtimeId: 'foreground-active',
      runtimeKind: 'cli-interactive',
    });
    await isolated.activate({
      runtimeId: 'unrelated',
      runtimeKind: 'subagent',
    });

    await cli.oauthManager.getToken('owner-identity', 'foreground');
    expect(challenges.map((c) => c.requester)).toStrictEqual([
      { runtimeId: 'foreground', runtimeKind: 'cli-bootstrap' },
      { runtimeId: 'foreground-active', runtimeKind: 'cli-interactive' },
    ]);
  });
  it('rejects background authentication without a host using a typed error', async () => {
    const handle = owner('subagent');
    await enable(handle.oauthManager);
    await expect(
      handle.oauthManager.getToken('owner-identity', 'required'),
    ).rejects.toBeInstanceOf(InteractiveAuthUnavailableError);
  });
  it('preserves an adopted OAuth manager owner when the adopting runtime activates', async () => {
    const live = owner('cli-interactive');
    await enable(live.oauthManager);
    const adopted = ownedRuntime(
      {
        config: live.config,
        runtimeId: 'adopter',
        runtimeKind: 'agent',
        oauthManager: live.oauthManager,
      },
      live.settingsService,
    );
    await adopted.activate({
      runtimeId: 'adopter-active',
      runtimeKind: 'subagent',
    });

    const challenges: InteractiveAuthChallenge[] = [];
    interactiveAuthCoordinator.bindHost(async (challenge) => {
      challenges.push(challenge);
    });
    await adopted.oauthManager.getToken('owner-identity', 'adopted');
    expect(challenges.map((c) => c.requester)).toStrictEqual([
      { runtimeId: 'same-label', runtimeKind: 'cli-interactive' },
    ]);
  });
  it('keeps undefined identity unregistered and excludes mismatched requester IDs', async () => {
    const challenges: InteractiveAuthChallenge[] = [];
    interactiveAuthCoordinator.bindHost(async (challenge) => {
      challenges.push(challenge);
    });
    const oauth = new OAuthManager(new MemoryTokenStore());
    await enable(oauth);
    await oauth.getToken('owner-identity', 'unknown');
    await requestInteractiveAuthentication(
      'owner-identity',
      'mismatch',
      'subagent',
      'authentication-required',
      undefined,
      { runtimeId: 'foreground', runtimeKind: 'cli-interactive' },
    );
    await requestInteractiveAuthentication(
      'owner-identity',
      'match',
      'agent',
      'authentication-required',
      undefined,
      { runtimeId: 'background', runtimeKind: 'agent' },
    );
    expect(challenges.map((c) => c.requester)).toStrictEqual([
      { runtimeKind: 'unregistered' },
      { runtimeKind: 'subagent' },
      { runtimeKind: 'agent', runtimeId: 'background' },
    ]);
  });
});
