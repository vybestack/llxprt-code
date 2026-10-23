import { ProviderReadFixture } from '../../../agents/src/api/__tests__/helpers/provider-read-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  MessageBus,
  PolicyDecision,
} from '@vybestack/llxprt-code-core';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import { OAuthManager } from '../auth/index.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { ProviderManager } from '../ProviderManager.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import {
  captureAgentCreation as createAgent,
  fixtureAgentResources,
} from '../../../agents/src/api/__tests__/helpers/agent-resource-capture.js';

import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../../agents/src/api/preferred-provider-acquisition.js';

describe('explicit provider primitives under the owning Agent assembly', () => {
  const credentials = useOwnedCredentials();
  let directory: string;
  let previousHome: string | undefined;
  let config: Config;
  let settings: SettingsService;
  let owner: SessionSettingsOwner;
  let policy: RuntimePolicyOwner;
  let manager: ProviderManager;
  let files: ProviderFileLifecycle;
  let release: AcquisitionRelease;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'provider-owned-assembly-'));
    previousHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = directory;
    await writeFile(
      join(directory, 'settings.json'),
      JSON.stringify({ oauthEnabledProviders: { anthropic: true } }),
    );
    settings = new SettingsService();
    settings.set('activeProvider', 'openai');
    config = new Config({
      targetDir: directory,
      cwd: directory,
      sessionId: 'same-label',
      provider: 'openai',
      model: 'owned-model',
      debugMode: false,
      telemetry: { enabled: false },
      policyEngineConfig: {
        rules: [
          {
            toolName: 'assemble-oauth-denied-tool',
            decision: PolicyDecision.DENY,
            priority: 100,
          },
        ],
      },
    });
    owner = new SessionSettingsOwner(settings);
    owner.bindTelemetry(config);
    policy = new RuntimePolicyOwner(config);
    files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    release = new AcquisitionRelease();
    release.acquire('settings', () => owner.dispose());
    release.acquire('policy', () => policy.dispose());
    manager = acquirePreferredProviderManager(
      config,
      settings,
      owner,
      files,
      'same-label',
      credentials().authority,
      release,
    );
  });
  afterEach(async () => {
    try {
      await release.close();
      await config.dispose();
    } finally {
      if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = previousHome;
      await rm(directory, { recursive: true, force: true });
    }
  });
  function acquireOAuth(
    selection?: IOAuthSettingsProvider | null,
  ): OAuthManager {
    return acquirePreferredOAuth(
      undefined,
      policy.session.messageBus,
      config,
      settings,
      manager,
      'same-label',
      undefined,
      credentials().authority,
      release,
      selection,
    );
  }
  async function populate(oauth: OAuthManager): Promise<void> {
    await preparePreferredProviderCompletion(
      config,
      settings,
      owner,
      manager,
      oauth,
      'same-label',
      createRuntimeTokenizerFactory(),
      undefined,
    );
  }

  it('owns session-bus construction internally and binds the OAuth manager to that exact bus', () => {
    const oauth = acquireOAuth();
    expect(policy.session.messageBus).toBeInstanceOf(MessageBus);
    expect(oauth.runtimeMessageBus).toBe(policy.session.messageBus);
  });
  it('keeps same-label foreground owners separate when bootstrapped together', async () => {
    const first = await createAgent({
      provider: 'openai',
      model: 'owned-model',
      sessionId: 'same-label',
      workingDir: directory,
      credentialAuthority: credentials().authority,
    });
    const second = await createAgent({
      provider: 'openai',
      model: 'owned-model',
      sessionId: 'same-label',
      workingDir: directory,
      credentialAuthority: credentials().authority,
    });
    try {
      expect(fixtureAgentResources(first).messageBus).not.toBe(
        fixtureAgentResources(second).messageBus,
      );
      expect(fixtureAgentResources(first).manager).not.toBe(
        fixtureAgentResources(second).manager,
      );
      const retained = await first.retainProviderFile({
        cacheKey: 'same-cache',
        fileId: 'first-file',
        bytes: 1,
        identity: {
          provider: 'openai',
          baseURL: 'http://127.0.0.1',
          credentialHash: 'first',
        },
        policy: {
          mode: 'enabled',
          scope: 'session',
          retentionMs: 60000,
          deletion: 'delete',
          zeroDataRetention: 'incompatible-while-retained',
        },
        deleteRemote: async () => undefined,
      });
      await retained.lease.release();
      expect([
        first.captureProviderFiles().retainedFiles,
        second.captureProviderFiles().retainedFiles,
      ]).toStrictEqual([1, 0]);
      expect(() => Reflect.construct(ProviderReadFixture, [])).toThrow(
        'Provider reads require an explicit session owner',
      );
      expect(() => Reflect.construct(ProviderReadFixture, [])).toThrow(
        'Provider reads require an explicit session owner',
      );
    } finally {
      await Promise.all([first.dispose(), second.dispose()]);
    }
  });
  it('populates the supplied provider manager with the standard providers', async () => {
    await populate(acquireOAuth());
    expect(manager.listProviders().sort()).toStrictEqual(
      expect.arrayContaining(['anthropic', 'openai']),
    );
  });
  it('acquires a real OAuth owner without requiring the CLI to construct it', () => {
    const oauth = acquireOAuth();
    expect(oauth).toBeInstanceOf(OAuthManager);
    expect(oauth.getSupportedProviders().sort()).toStrictEqual(
      expect.arrayContaining(['claudecode']),
    );
  });
  it('keeps a configured OAuth provider enabled when the settings selection is omitted', () => {
    expect(acquireOAuth().isOAuthEnabled('anthropic')).toBe(true);
  });
  it('reports a not-configured provider as disabled through the same file-backed selection', () => {
    expect(acquireOAuth().isOAuthEnabled('gemini')).toBe(false);
  });
  it('honors explicit null by producing a settings-less OAuth owner', () => {
    expect(acquireOAuth(null).isOAuthEnabled('anthropic')).toBe(false);
  });
  it('binds the OAuth manager to the final Config-derived bus identity and policy', async () => {
    const oauth = acquireOAuth();
    expect(oauth.runtimeMessageBus).toBe(policy.session.messageBus);
    await expect(
      policy.session.messageBus.requestConfirmation(
        { name: 'assemble-oauth-denied-tool' },
        {},
      ),
    ).resolves.toBe(false);
    expect(oauth.isOAuthEnabled('anthropic')).toBe(true);
  });
});
