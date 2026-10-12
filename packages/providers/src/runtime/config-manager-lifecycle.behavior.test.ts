import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { listProviders } from './providerReadOperations.js';

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
import { createIsolatedRuntimeContext } from './runtimeActivationBindings.js';
import { assembleCliProviderRuntime } from './assembleCliProviderRuntime.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IProvider } from '../IProvider.js';

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
    const manager = new ProviderManager({
      config: host,
      settingsService: settings,
      sessionSettings: owner,
    });
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
    expect(() => Reflect.apply(listProviders, undefined, [])).toThrow(
      'Provider listing requires an explicit owner',
    );
  });
  it('keeps borrowed manager subscriptions usable after facade runtime cleanup', async () => {
    const settings = new SettingsService();
    const owner = config(settings);
    const manager = new ProviderManager({
      config: owner.config,
      settingsService: settings,
    });
    const provider = new CacheProvider();
    manager.registerProvider(provider);
    manager.setActiveProvider(provider.name);
    const handle = createIsolatedRuntimeContext(
      {
        config: owner.config,
        settingsOwner: owner.settingsOwner,
        providerManager: manager,
      },
      owner.settingsService,
    );
    try {
      await handle.activate();
      await handle.cleanup();
      const revision = provider.clientRevision;
      owner.settingsService.set('base-url', 'http://127.0.0.1:2');
      expect(provider.clientRevision).toBe(revision + 1);
      expect(manager.getActiveProviderName()).toBe(provider.name);
    } finally {
      await handle.cleanup();
      manager.dispose();
      await owner.dispose();
    }
  });
  it('stops owned-manager Config subscriptions after runtime cleanup', async () => {
    const owner = config(new SettingsService());
    const handle = createIsolatedRuntimeContext(
      {
        config: owner.config,
        settingsOwner: owner.settingsOwner,
      },
      owner.settingsService,
    );
    const provider = new CacheProvider();
    handle.providerManager.registerProvider(provider);
    await handle.providerManager.setActiveProvider(provider.name);
    try {
      await handle.activate();
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
    const early = assembleCliProviderRuntime({
      settingsService: settings,
      config: undefined,
      runtimeId: 'shared-label',
    });
    const owner = config(settings);
    early.providerManager.accumulateSessionTokens('openai', {
      input: 9,
      output: 3,
      cache: 0,
      tool: 0,
      thought: 0,
    });
    try {
      const final = assembleCliProviderRuntime({
        settingsService: settings,
        config: owner.config,
        runtimeId: 'shared-label',
        registration: early.registration,
        oauthManager: early.oauthManager,
      });
      expect(final.providerManager).toBe(early.providerManager);
      expect(final.oauthManager).toBe(early.oauthManager);
      expect(final.oauthManager?.runtimeMessageBus).toBe(
        final.runtimeMessageBus,
      );
      owner.settingsService.set('auth.noBrowser', true);
      expect(final.oauthManager?.isBrowserDisabled()).toBe(true);
      owner.settingsService.set('auth.noBrowser', false);
      expect(final.oauthManager?.isBrowserDisabled()).toBe(false);
      expect(final.providerManager.getSessionTokenUsage().total).toBe(12);
    } finally {
      early.registration.dispose();
      await owner.dispose();
    }
  });
  it('invalidates only the active same-label owner caches and detaches the former settings store', async () => {
    const left = config(new SettingsService());
    const right = config(new SettingsService());
    const a = new ProviderManager({
      sessionSettings: left.settingsOwner,
      settingsService: left.settingsService,
      config: left.config,
    });
    const b = new ProviderManager({
      sessionSettings: right.settingsOwner,
      settingsService: right.settingsService,
      config: right.config,
    });
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
          config: right.config,
          sessionSettings: right.settingsOwner,
          settingsService: right.settingsService,
          runtimeId: 'rebound-owner',
        }),
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
    const a = new ProviderManager({
      sessionSettings: left.settingsOwner,
      settingsService: left.settingsService,
      config: left.config,
    });
    const b = new ProviderManager({
      sessionSettings: right.settingsOwner,
      settingsService: right.settingsService,
      config: right.config,
    });
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
