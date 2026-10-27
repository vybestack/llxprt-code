import { ProviderReadFixture } from './helpers/provider-read-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderTokenizer } from '@vybestack/llxprt-code-providers/composition.js';

import { preparePreferredProviderCompletion } from '../preferred-provider-acquisition.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
} from './helpers/provider-acquisition.js';
import {
  AgentProfilePreflight,
  prepareAgentPreflight,
} from '../profile-preflight.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';

import {
  createSessionAuthPolicyReader,
  createOwnedTokenStoreClose,
} from '@vybestack/llxprt-code-providers/composition.js';
import { createSessionMessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { createOwnerPolicyEvaluation } from '@vybestack/llxprt-code-core/policy/owner-policy-evaluation.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { createFileOAuthSettingsProvider } from '@vybestack/llxprt-code-providers/auth.js';

import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

import { describe, expect, it, vi } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  WorkspaceFilesystemOwner,
  WorkspaceTrustLifecycle,
  assembleWorkspaceMemory,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '@vybestack/llxprt-code-providers/ProviderManager.js';

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IProvider } from '@vybestack/llxprt-code-providers/IProvider.js';

class CacheProvider implements IProvider {
  readonly name = 'cache-provider';
  clientRevision = 0;
  authRevision = 0;
  clearClientCache(): void {
    this.clientRevision++;
  }
  clearAuthCache(): void {
    this.authRevision++;
  }
  getDefaultModel(): string {
    return 'test-model';
  }
  getModels(): Promise<[]> {
    return Promise.resolve([]);
  }
  async *generateChatCompletion(): AsyncIterableIterator<IContent> {
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'generated' }] };
  }
}
function contributeCacheProvider(
  provider: CacheProvider,
): ProviderContributionRegistry {
  const providerId = `${provider.name}-contributed`;
  return buildProviderContributionRegistry([
    {
      specifier: `memory:${providerId}`,
      manifest: {
        apiVersion: 1,
        id: providerId,
        providers: [
          {
            providerId,
            createProvider: () => provider,
            builtinAliases: [
              {
                alias: provider.name,
                config: { baseProvider: providerId, 'requires-auth': false },
              },
            ],
          },
        ],
      },
    },
  ]);
}

describe('Config-independent provider owner lifecycle', () => {
  const credentials = useOwnedCredentials();
  it('releases the telemetry subscription even when the real settings unsubscribe throws', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'manager-release-'));
    const outfile = join(directory, 'retained-root.jsonl');
    const settings = new SettingsService();
    const host = new Config({
      sessionId: 'manager-release',
      cwd: directory,
      targetDir: directory,
      model: 'test-model',
      debugMode: false,
      telemetry: { enabled: true, outfile },
    });
    const owner = new SessionSettingsOwner(settings);
    owner.bindTelemetry(host);
    await owner.startTelemetry(host);
    settings.set('model', 'test-model');
    settings.set('base-url', 'http://127.0.0.1:10');
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      host,
      undefined,
      undefined,
      owner,
    );
    const provider = new CacheProvider();
    manager.registerProvider(provider);
    manager.setActiveProvider('cache-provider');
    const selected = manager.getActiveProvider();
    if (selected === undefined)
      throw new Error('Expected active local provider');
    for await (const chunk of selected.generateChatCompletion({
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'local request before release' }],
        },
      ],
    })) {
      expect(chunk.blocks.length).toBeGreaterThan(0);
    }
    expect(manager.getProviderMetrics()?.totalRequests).toBe(1);
    const releaseError = new Error('physical settings release failure');
    const off = vi.spyOn(settings, 'off').mockImplementationOnce(() => {
      throw releaseError;
    });
    let failure: unknown;
    try {
      manager.dispose();
    } catch (error) {
      failure = error;
    }
    off.mockRestore();
    try {
      expect(failure).toBe(releaseError);
      await owner.updateTelemetrySettings({ enabled: false });
      expect(manager.getProviderMetrics()?.totalRequests).toBe(1);
      await owner.updateTelemetrySettings({ enabled: true });
      owner.telemetry.events.record(() => ({
        body: 'root survives failed manager release',
      }));
      await owner.telemetry.flush();
      expect(readFileSync(outfile, 'utf8')).toContain(
        'root survives failed manager release',
      );
      const revision = provider.clientRevision;
      settings.set('base-url', 'http://127.0.0.1:11');
      expect(provider.clientRevision).toBe(revision + 1);
      await owner.dispose();
      settings.set('base-url', 'http://127.0.0.1:12');
      expect(provider.clientRevision).toBe(revision + 1);
    } finally {
      manager.dispose();
      await owner.dispose();
      await host.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a missing listing owner without consulting another session', () => {
    expect(() => Reflect.construct(ProviderReadFixture, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
  });
  it('transfers the preflight provider manager to the foreground agent: settings writes reach the provider until agent disposal and never afterwards', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'borrowed-manager-'));
    const settings = new SettingsService();
    const ownerSettings = settings;
    const provider = new CacheProvider();
    const ownerConfig = new Config({
      sessionId: 'shared-label',
      cwd: directory,
      targetDir: directory,
      model: 'test-model',
      provider: provider.name,
      debugMode: false,
    });
    const ownerSettingsOwner = new SessionSettingsOwner(ownerSettings);
    ownerSettingsOwner.bindTelemetry(ownerConfig);
    const ownerClose = closeConfiguration.bind(
      undefined,
      ownerSettingsOwner,
      ownerConfig,
    );
    const preflight = await prepareAgentPreflight(
      { runtimeId: 'borrowed-manager' },
      credentials().authority,
      settings,
      undefined,
      contributeCacheProvider(provider),
    );
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
    });
    const memory = assembleWorkspaceMemory(ownerConfig, filesystem, trust);
    try {
      settings.set('activeProvider', provider.name);
      await preflight.preparePostConfiguration(
        ownerConfig,
        filesystem,
        memory,
        trust,
        undefined,
        ownerSettingsOwner,
      );
      const intent = {
        provider: provider.name,
        model: 'test-model',
        authMode: 'none' as const,
      };
      const accepted = await preflight.preflight(intent);
      if (accepted.token === undefined)
        throw new Error('Preflight did not accept the activation');
      const agent = await AgentProfilePreflight.createForegroundAgent(
        preflight,
        accepted.token,
        intent,
        {},
      );
      settings.set('base-url', 'http://127.0.0.1:1');
      const attached = provider.clientRevision;
      expect(attached).toBeGreaterThan(0);
      settings.set('base-url', 'http://127.0.0.2:1');
      expect(provider.clientRevision).toBe(attached + 1);
      await agent.dispose();
      settings.set('base-url', 'http://127.0.0.3:1');
      expect(provider.clientRevision).toBe(attached + 1);
    } finally {
      await preflight.dispose();
      await memory.dispose();
      await filesystem.dispose();
      await trust.dispose();
      await ownerClose();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('stops owned-manager Config subscriptions after runtime cleanup', async () => {
    const ownerSettings = new SettingsService();
    const ownerConfig = new Config({
      sessionId: 'shared-label',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      model: 'test-model',
      debugMode: false,
    });
    const ownerSettingsOwner = new SessionSettingsOwner(ownerSettings);
    ownerSettingsOwner.bindTelemetry(ownerConfig);
    const ownerClose = closeConfiguration.bind(
      undefined,
      ownerSettingsOwner,
      ownerConfig,
    );
    const release = new AcquisitionRelease();
    const policy = new RuntimePolicyOwner(ownerConfig);
    release.acquire('policy', () => policy.dispose());
    const files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    release.acquire('files', () =>
      releaseAdoptedFileScope(files, 'owned-manager'),
    );
    const manager = acquirePreferredProviderManager(
      ownerConfig,
      ownerSettings,
      ownerSettingsOwner,
      files,
      'owned-manager',
      credentials().authority,
      release,
    );
    const oauth = acquirePreferredOAuth(
      undefined,
      policy.session.messageBus,
      ownerConfig,
      ownerSettings,
      manager,
      'owned-manager',
      undefined,
      credentials().authority,
      release,
      undefined,
    );
    try {
      await preparePreferredProviderCompletion(
        ownerConfig,
        ownerSettings,
        ownerSettingsOwner,
        manager,
        oauth,
        'owned-manager',
        configureProviderTokenizer(manager),
        undefined,
        process.env.LLXPRT_FAKE_RESPONSES,
      );
      const provider = new CacheProvider();
      manager.registerProvider(provider);
      manager.setActiveProvider(provider.name);
      ownerSettings.set('base-url', 'http://127.0.0.1:1');
      const attached = provider.clientRevision;
      expect(attached).toBeGreaterThan(0);
      await release.close();
      ownerSettings.set('base-url', 'http://127.0.0.1:2');
      expect(attached).toBe(provider.clientRevision);
    } finally {
      await release.close();
      await ownerClose();
    }
  });
  it('retains the pre-Config root manager and token totals across explicit host adoption', async () => {
    const settings = new SettingsService();
    const release = new AcquisitionRelease();
    const bus = createSessionMessageBus(createOwnerPolicyEvaluation());
    release.acquire('bus', () => bus.cancelPendingConfirmations());
    const files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    release.acquire('files', () =>
      releaseAdoptedFileScope(files, 'shared-label'),
    );
    const earlyManager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      files,
      settings,
      undefined,
      createProviderRuntimeContext({
        runtimeId: 'shared-label',
        runtimeKind: 'cli-interactive',
      }),
    );
    release.acquire('manager', () => earlyManager.dispose());
    const keys = credentials().authority.createProviderKeyStorage();
    release.acquire('manager', () => keys.close());
    earlyManager.bindProviderKeyStorage(keys);
    const tokens = credentials().authority.createTokenStore();
    release.acquire('tokens', createOwnedTokenStoreClose(tokens));
    const earlyOAuth = new OAuthManager(
      tokens,
      createFileOAuthSettingsProvider(),
      {
        messageBus: bus,
        readSessionAuthPolicy: createSessionAuthPolicyReader(settings),
      },
    );
    release.acquire('oauth', () => earlyOAuth.dispose());
    earlyManager.accumulateSessionTokens('openai', {
      input: 9,
      output: 3,
      cache: 0,
      tool: 0,
      thought: 0,
    });
    const ownerSettings = settings;
    const ownerConfig = new Config({
      sessionId: 'shared-label',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      model: 'test-model',
      debugMode: false,
    });
    const ownerSettingsOwner = new SessionSettingsOwner(ownerSettings);
    ownerSettingsOwner.bindTelemetry(ownerConfig);
    const ownerClose = closeConfiguration.bind(
      undefined,
      ownerSettingsOwner,
      ownerConfig,
    );
    try {
      await preparePreferredProviderCompletion(
        ownerConfig,
        settings,
        ownerSettingsOwner,
        earlyManager,
        earlyOAuth,
        'shared-label',
        configureProviderTokenizer(earlyManager),
        undefined,
        process.env.LLXPRT_FAKE_RESPONSES,
      );
      expect(earlyOAuth.runtimeMessageBus).toBe(bus);
      ownerSettings.set('auth.noBrowser', true);
      expect(earlyOAuth.isBrowserDisabled()).toBe(true);
      ownerSettings.set('auth.noBrowser', false);
      expect(earlyOAuth.isBrowserDisabled()).toBe(false);
      expect(earlyManager.getSessionTokenUsage().total).toBe(12);
    } finally {
      await release.close();
      await ownerClose();
    }
  });
  it('invalidates only the active same-label owner caches and detaches the former settings store', async () => {
    const leftSettings = new SettingsService();
    const leftConfig = new Config({
      sessionId: 'shared-label',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      model: 'test-model',
      debugMode: false,
    });
    const leftSettingsOwner = new SessionSettingsOwner(leftSettings);
    leftSettingsOwner.bindTelemetry(leftConfig);
    const leftClose = closeConfiguration.bind(
      undefined,
      leftSettingsOwner,
      leftConfig,
    );
    const rightSettings = new SettingsService();
    const rightConfig = new Config({
      sessionId: 'shared-label',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      model: 'test-model',
      debugMode: false,
    });
    const rightSettingsOwner = new SessionSettingsOwner(rightSettings);
    rightSettingsOwner.bindTelemetry(rightConfig);
    const rightClose = closeConfiguration.bind(
      undefined,
      rightSettingsOwner,
      rightConfig,
    );
    const a = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      leftSettings,
      leftConfig,
      undefined,
      undefined,
      leftSettingsOwner,
    );
    const b = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      rightSettings,
      rightConfig,
      undefined,
      undefined,
      rightSettingsOwner,
    );
    const first = new CacheProvider();
    const second = new CacheProvider();
    a.registerProvider(first);
    b.registerProvider(second);
    a.setActiveProvider(first.name);
    b.setActiveProvider(second.name);
    const initialA = first.clientRevision;
    const initialB = second.clientRevision;
    try {
      leftSettings.set('base-url', 'http://127.0.0.1:1');
      expect(initialA).toBeLessThan(first.clientRevision);
      expect(initialB).toBe(second.clientRevision);
      const detached = first.clientRevision;
      a.setRuntimeContext(
        createProviderRuntimeContext({
          runtimeId: 'rebound-owner',
        }),
        rightSettingsOwner,
        rightSettings,
        rightConfig,
      );
      leftSettings.set('auth-key', 'former-owner-key');
      expect(detached).toBe(first.clientRevision);
      expect(rightSettings.get('auth-key')).toBeUndefined();
    } finally {
      a.dispose();
      b.dispose();
      await leftClose();
      await rightClose();
    }
  });
  it('rewraps only the telemetry owner and leaves sibling accounting untouched', async () => {
    const leftSettings = new SettingsService();
    const leftConfig = new Config({
      sessionId: 'shared-label',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      model: 'test-model',
      debugMode: false,
    });
    const leftSettingsOwner = new SessionSettingsOwner(leftSettings);
    leftSettingsOwner.bindTelemetry(leftConfig);
    const leftClose = closeConfiguration.bind(
      undefined,
      leftSettingsOwner,
      leftConfig,
    );
    const rightSettings = new SettingsService();
    const rightConfig = new Config({
      sessionId: 'shared-label',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      model: 'test-model',
      debugMode: false,
    });
    const rightSettingsOwner = new SessionSettingsOwner(rightSettings);
    rightSettingsOwner.bindTelemetry(rightConfig);
    const rightClose = closeConfiguration.bind(
      undefined,
      rightSettingsOwner,
      rightConfig,
    );
    const a = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      leftSettings,
      leftConfig,
      undefined,
      undefined,
      leftSettingsOwner,
    );
    const b = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      rightSettings,
      rightConfig,
      undefined,
      undefined,
      rightSettingsOwner,
    );
    a.registerProvider(new CacheProvider());
    b.registerProvider(new CacheProvider());
    a.setActiveProvider('cache-provider');
    b.setActiveProvider('cache-provider');
    const beforeA = a.getActiveProvider();
    const beforeB = b.getActiveProvider();
    try {
      await leftSettingsOwner.updateTelemetrySettings({
        logConversations: true,
      });
      expect(beforeA).not.toBe(a.getActiveProvider());
      expect(beforeB).toBe(b.getActiveProvider());
      a.accumulateSessionTokens('cache-provider', {
        input: 3,
        output: 2,
        cache: 0,
        tool: 0,
        thought: 0,
      });
      expect(a.getSessionTokenUsage().total).toBe(5);
      expect(b.getSessionTokenUsage().total).toBe(0);
    } finally {
      a.dispose();
      b.dispose();
      await leftClose();
      await rightClose();
    }
  });
});

async function closeConfiguration(
  settingsOwner: SessionSettingsOwner,
  config: Config,
): Promise<void> {
  await runCleanupSteps([
    () => settingsOwner.dispose(),
    () => config.dispose(),
  ]);
}
