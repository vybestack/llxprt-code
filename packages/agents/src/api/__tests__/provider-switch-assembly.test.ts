/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIProvider } from '@vybestack/llxprt-code-providers';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import {
  ProviderManager,
  ProviderFileLifecycle,
} from '@vybestack/llxprt-code-providers';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core';
import { configureProviderTokenizer } from '@vybestack/llxprt-code-providers/composition.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

import {
  MemoryTokenStore,
  createTestProvider,
} from './helpers/provider-auth-fixtures.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';

class SubscriptionProvider extends OpenAIProvider {
  override readonly name = 'claudecode';
  override async hasNonOAuthAuthentication(): Promise<boolean> {
    return false;
  }
}

describe('provider switch assembly', () => {
  const credentials = useOwnedCredentials();
  it('uses the current activation kind and the adopted OAuth owner outside ALS', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'provider-switch-owner-')),
    );
    const settings = new SettingsService();
    const config = new Config({
      sessionId: 'same-label',
      cwd: directory,
      targetDir: directory,
      debugMode: false,
      interactive: true,
      model: 'initial',
    });
    const tokens = new MemoryTokenStore();
    const settingsOwner = new SessionSettingsOwner(settings);
    settingsOwner.bindTelemetry(config);
    settingsOwner.initializeProviderSelection(
      config.getProvider(),
      config.getModel(),
    );
    const policy = new RuntimePolicyOwner(config);
    const oauth = new OAuthManager(tokens, undefined, {
      config,
      messageBus: policy.session.messageBus,
    });
    oauth.registerProvider(createTestProvider('claudecode'));
    const files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      files,
      settings,
      config,
      createProviderRuntimeContext({
        runtimeId: 'same-label',
        runtimeKind: 'agent',
      }),
      credentials().authority,
      settingsOwner,
    );
    manager.registerProvider(new SubscriptionProvider(undefined));
    manager.registerProvider(new OpenAIProvider('key'));
    const switchProvider = assembleProviderSwitch(
      config,
      settings,
      manager,
      oauth,
      () => manager.getAuthIdentity().runtimeKind,
      async () => {},
      settingsOwner,
    );
    try {
      await switchProvider('claudecode');
      expect(await tokens.listBuckets('claudecode')).toStrictEqual([]);
      await switchProvider('openai');
      manager.setRuntimeContext(
        createProviderRuntimeContext({
          runtimeId: 'activated-owner',
          runtimeKind: 'cli-interactive',
        }),
        settingsOwner,
        settings,
        config,
      );
      configureProviderTokenizer(manager);
      manager.setConfig(config);
      const result = await switchProvider('claudecode');
      expect(result.infoMessages.join(' ')).toContain(
        'authentication completed',
      );
      expect(await tokens.listBuckets('claudecode')).toStrictEqual(['default']);
      expect(settingsOwner.readSelectedProvider()).toBe('claudecode');
    } finally {
      await runCleanupSteps([
        () => manager.dispose(),
        () => oauth.dispose(),
        () => policy.dispose(),
        () => settingsOwner.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  });
});
