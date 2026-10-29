import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ProviderReadFixture } from '../../../agents/src/api/__tests__/helpers/provider-read-fixture.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from '../../../agents/src/api/__tests__/helpers/provider-acquisition.js';

import { describe, expect, it, vi } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '../ProviderManager.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IProvider } from '../IProvider.js';
import { replayableContents } from '../utils/collectContents.js';

function config(settings: SettingsService, label = 'shared-label') {
  const host = new Config({
    sessionId: label,
    cwd: process.cwd(),
    targetDir: process.cwd(),
    model: 'test-model',
    debugMode: false,
  });
  const settingsOwner = new SessionSettingsOwner(settings);
  settingsOwner.bindTelemetry(host);
  return {
    config: host,
    settingsService: settings,
    settingsOwner,
    dispose: async (): Promise<void> => {
      await settingsOwner.dispose();
      await host.dispose();
    },
  };
}
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
      contents: replayableContents([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'local request before release' }],
        },
      ]),
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
  it('keeps borrowed manager subscriptions usable after facade runtime cleanup', async () => {
    const settings = new SettingsService();
    const owner = config(settings);
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      owner.config,
      undefined,
      undefined,
      owner.settingsOwner,
    );
    const provider = new CacheProvider();
    manager.registerProvider(provider);
    manager.setActiveProvider(provider.name);
    const release = new AcquisitionRelease();
    const policy = new RuntimePolicyOwner(owner.config);
    acquirePreferredOAuth(
      undefined,
      policy.session.messageBus,
      owner.config,
      settings,
      manager,
      'borrowed-manager',
      undefined,
      credentials().authority,
      release,
      undefined,
    );
    try {
      await release.close();
      const revision = provider.clientRevision;
      owner.settingsService.set('base-url', 'http://127.0.0.1:2');
      expect(provider.clientRevision).toBe(revision + 1);
      expect(manager.getActiveProviderName()).toBe(provider.name);
    } finally {
      await release.close();
      await policy.dispose();
      manager.dispose();
      await owner.dispose();
    }
  });
  it('stops owned-manager Config subscriptions after runtime cleanup', async () => {
    const owner = config(new SettingsService());
    const release = new AcquisitionRelease();
    const files = new ProviderFileLifecycle({ maxFiles: 100, maxBytes: 1024 });
    const providerManager = acquirePreferredProviderManager(
      owner.config,
      owner.settingsService,
      owner.settingsOwner,
      files,
      'shared-label',
      credentials().authority,
      release,
    );
    const handle = {
      providerManager,
      cleanup: () => release.close(),
    };
    const provider = new CacheProvider();
    handle.providerManager.registerProvider(provider);
    handle.providerManager.setActiveProvider(provider.name);
    try {
      owner.settingsService.set('base-url', 'http://127.0.0.1:1');
      const attached = provider.clientRevision;
      expect(attached).toBeGreaterThan(0);
      await handle.cleanup();
      owner.settingsService.set('base-url', 'http://127.0.0.1:2');
      expect(attached).toBe(provider.clientRevision);
    } finally {
      await handle.cleanup();
      await owner.dispose();
    }
  });
  it('retains the pre-Config root manager and token totals across explicit host adoption', async () => {
    const settings = new SettingsService();
    const owner = config(settings);
    const release = new AcquisitionRelease();
    const files = new ProviderFileLifecycle({ maxFiles: 100, maxBytes: 1024 });
    const policy = new RuntimePolicyOwner(owner.config);
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      files,
      settings,
      undefined,
      createProviderRuntimeContext({ runtimeId: 'shared-label' }),
      credentials().authority,
      owner.settingsOwner,
    );
    release.acquire('manager', () => manager.dispose());
    const oauth = acquirePreferredOAuth(
      undefined,
      policy.session.messageBus,
      owner.config,
      settings,
      manager,
      'shared-label',
      undefined,
      credentials().authority,
      release,
      undefined,
    );
    const early = { providerManager: manager, oauthManager: oauth };
    early.providerManager.accumulateSessionTokens('openai', {
      input: 9,
      output: 3,
      cache: 0,
      tool: 0,
      thought: 0,
    });
    try {
      manager.setRuntimeContext(
        createProviderRuntimeContext({ runtimeId: 'shared-label' }),
        owner.settingsOwner,
        settings,
        owner.config,
      );
      const final = {
        providerManager: manager,
        oauthManager: oauth,
        runtimeMessageBus: policy.session.messageBus,
      };
      expect(final.providerManager).toBe(early.providerManager);
      expect(final.oauthManager).toBe(early.oauthManager);
      expect(final.oauthManager.runtimeMessageBus).toBe(
        final.runtimeMessageBus,
      );
      owner.settingsService.set('auth.noBrowser', true);
      expect(final.oauthManager.isBrowserDisabled()).toBe(true);
      owner.settingsService.set('auth.noBrowser', false);
      expect(final.oauthManager.isBrowserDisabled()).toBe(false);
      expect(final.providerManager.getSessionTokenUsage().total).toBe(12);
    } finally {
      await release.close();
      await policy.dispose();
      await owner.dispose();
    }
  });
  it('invalidates only the active same-label owner caches and detaches the former settings store', async () => {
    const left = config(new SettingsService());
    const right = config(new SettingsService());
    const a = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      left.settingsService,
      left.config,
      undefined,
      undefined,
      left.settingsOwner,
    );
    const b = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      right.settingsService,
      right.config,
      undefined,
      undefined,
      right.settingsOwner,
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
      left.settingsService.set('base-url', 'http://127.0.0.1:1');
      expect(initialA).toBeLessThan(first.clientRevision);
      expect(initialB).toBe(second.clientRevision);
      const detached = first.clientRevision;
      a.setRuntimeContext(
        createProviderRuntimeContext({
          runtimeId: 'rebound-owner',
        }),
        right.settingsOwner,
        right.settingsService,
        right.config,
      );
      left.settingsService.set('auth-key', 'former-owner-key');
      expect(detached).toBe(first.clientRevision);
      expect(right.settingsService.get('auth-key')).toBeUndefined();
    } finally {
      a.dispose();
      b.dispose();
      await left.dispose();
      await right.dispose();
    }
  });
  it('rewraps only the telemetry owner and leaves sibling accounting untouched', async () => {
    const left = config(new SettingsService());
    const right = config(new SettingsService());
    const a = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      left.settingsService,
      left.config,
      undefined,
      undefined,
      left.settingsOwner,
    );
    const b = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      right.settingsService,
      right.config,
      undefined,
      undefined,
      right.settingsOwner,
    );
    a.registerProvider(new CacheProvider());
    b.registerProvider(new CacheProvider());
    a.setActiveProvider('cache-provider');
    b.setActiveProvider('cache-provider');
    const beforeA = a.getActiveProvider();
    const beforeB = b.getActiveProvider();
    try {
      await left.settingsOwner.updateTelemetrySettings({
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
      await left.dispose();
      await right.dispose();
    }
  });
});
