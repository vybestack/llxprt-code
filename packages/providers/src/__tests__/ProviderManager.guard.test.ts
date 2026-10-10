/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

class HarnessProvider extends BaseProvider {
  lastOptions?: NormalizedGenerateChatOptions;
  constructor(name = 'openai') {
    super({ name, apiKey: 'fixture-key' });
  }
  async getModels(): Promise<never[]> {
    return [];
  }
  getDefaultModel(): string {
    return 'default-model';
  }
  protected supportsOAuth(): boolean {
    return false;
  }
  protected async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.lastOptions = options;
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: options.resolved.model }],
    };
  }
}

function fixture() {
  const settings = new SettingsService();
  settings.setProviderSetting('openai', 'model', 'owner-model');
  settings.setProviderSetting('openai', 'base-url', 'http://127.0.0.1:1/v1');
  const config = createRuntimeConfigStub(settings);
  const manager = new ProviderManager({ settingsService: settings, config });
  const provider = new HarnessProvider();
  manager.registerProvider(provider);
  return { manager, provider, settings };
}

describe('ProviderManager owner admission', () => {
  it('captures policy and forwards no SettingsService or Config through normalized requests', async () => {
    const { manager, provider } = fixture();
    const options = manager.normalizeRuntimeInputs({ contents: [] }, 'openai');
    const result = await provider.generateChatCompletion(options).next();
    expect(result.value).toMatchObject({ blocks: [{ text: 'owner-model' }] });
    expect(provider.lastOptions).not.toHaveProperty('settings');
    expect(provider.lastOptions).not.toHaveProperty('config');
    expect(provider.lastOptions?.runtime).not.toHaveProperty('settingsService');
    expect(provider.lastOptions?.runtime).not.toHaveProperty('config');
  });

  it('keeps an admitted policy when the owner changes and observes changes on fresh admission', () => {
    const { manager, settings } = fixture();
    const first = manager.normalizeRuntimeInputs({ contents: [] }, 'openai');
    settings.setProviderSetting('openai', 'model', 'replacement-model');
    const retained = manager.normalizeRuntimeInputs(first, 'openai');
    const fresh = manager.normalizeRuntimeInputs({ contents: [] }, 'openai');
    expect(retained.resolved?.model).toBe('owner-model');
    expect(fresh.resolved?.model).toBe('replacement-model');
  });

  it('honors explicit admission by a different owner without recovering its services', () => {
    const { manager } = fixture();
    const other = new SettingsService();
    other.setProviderSetting('openai', 'model', 'other-owner-model');
    other.setProviderSetting('openai', 'base-url', 'http://127.0.0.1:2/v1');
    const invocation = captureProviderInvocation(
      { settingsService: other, runtimeId: 'same-label' },
      'openai',
    );
    const options = manager.normalizeRuntimeInputs(
      { contents: [], invocation },
      'openai',
    );
    expect(options.resolved).toMatchObject({
      model: 'other-owner-model',
      baseURL: 'http://127.0.0.1:2/v1',
    });
    expect(options.runtime).not.toHaveProperty('settingsService');
  });

  it('does not apply an active provider endpoint to another provider', () => {
    const { manager, settings } = fixture();
    settings.set('activeProvider', 'openai');
    settings.set('base-url', 'http://127.0.0.1:3/v1');
    manager.registerProvider(new HarnessProvider('anthropic'));
    const options = manager.normalizeRuntimeInputs(
      { contents: [] },
      'anthropic',
    );
    expect(options.resolved?.model).toBe('default-model');
    expect(options.resolved?.baseURL).toBeUndefined();
  });

  for (const absent of ['', '   ']) {
    it(`treats a ${JSON.stringify(absent)} resolved model and endpoint as absent`, () => {
      const { manager } = fixture();
      const options = manager.normalizeRuntimeInputs(
        { contents: [], resolved: { model: absent, baseURL: absent } },
        'openai',
      );
      expect(options.resolved).toMatchObject({
        model: 'owner-model',
        baseURL: 'http://127.0.0.1:1/v1',
      });
    });
  }

  it('retains live cancellation and merges invocation metadata', () => {
    const { manager } = fixture();
    const controller = new AbortController();
    const options = manager.normalizeRuntimeInputs(
      {
        contents: [],
        metadata: { requestId: 'request', abortSignal: controller.signal },
      },
      'openai',
    );
    controller.abort();
    expect(options.invocation?.signal?.aborted).toBe(true);
    expect(options.metadata).toMatchObject({
      requestId: 'request',
      _normalized: true,
      _provider: 'openai',
    });
  });

  it('fails closed when no provider is active or targeted', () => {
    const settingsService = new SettingsService();
    const manager = new ProviderManager({ settingsService });
    expect(() => manager.normalizeRuntimeInputs({ contents: [] })).toThrow(
      'No provider is active or targeted',
    );
  });
});

describe('ProviderManager admission fallback and isolation', () => {
  it('does not admit model or endpoint policy from a mismatched Config owner', () => {
    const own = new SettingsService();
    own.setProviderSetting('openai', 'model', 'owned-model');
    const foreign = new SettingsService();
    const config = createRuntimeConfigStub(foreign, {
      getModel: () => 'foreign-model',
      getEphemeralSetting: (key) =>
        key === 'base-url' ? 'https://foreign.example.test/v1' : undefined,
    });
    const manager = new ProviderManager({ settingsService: own, config });
    manager.registerProvider(new HarnessProvider());
    const normalized = manager.normalizeRuntimeInputs(
      { contents: [] },
      'openai',
    );
    expect(normalized.resolved?.model).toBe('owned-model');
    expect(normalized.resolved?.baseURL).toBeUndefined();
  });

  for (const absent of [undefined, '', '   ']) {
    it(`captures the owner Config endpoint for absent endpoint ${JSON.stringify(absent)}`, () => {
      const settingsService = new SettingsService();
      settingsService.set('base-url', 'https://config.example.test/v1');
      const config = createRuntimeConfigStub(settingsService, {});
      const manager = new ProviderManager({ settingsService, config });
      manager.registerProvider(new HarnessProvider());
      const normalized = manager.normalizeRuntimeInputs(
        { contents: [], resolved: { baseURL: absent } },
        'openai',
      );
      expect(normalized.resolved?.baseURL).toBe(
        'https://config.example.test/v1',
      );
      expect(normalized.runtime).not.toHaveProperty('config');
    });
  }

  it('prefers a provider-scoped model over the applicable Config model', () => {
    const settingsService = new SettingsService();
    settingsService.setProviderSetting('anthropic', 'model', 'scoped-model');
    const config = createRuntimeConfigStub(settingsService, {
      getModel: () => 'config-model',
    });
    const manager = new ProviderManager({ settingsService, config });
    manager.registerProvider(new HarnessProvider('anthropic'));
    expect(
      manager.normalizeRuntimeInputs({ contents: [] }, 'anthropic').resolved
        ?.model,
    ).toBe('scoped-model');
  });

  it('does not inject an active provider credential into another provider request', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', 'openai');
    settingsService.set('auth-key', 'foreground-credential');
    const config = createRuntimeConfigStub(settingsService);
    const manager = new ProviderManager({ settingsService, config });
    manager.registerProvider(new HarnessProvider('anthropic'));
    expect(
      manager.normalizeRuntimeInputs({ contents: [] }, 'anthropic').resolved
        ?.authToken,
    ).toBeUndefined();
  });

  it('retains an explicit live credential port supplied by a different owner', () => {
    const { manager } = fixture();
    let revoked = false;
    const port = {
      provide: () => (revoked ? undefined : 'other-owner-credential'),
    };
    const admitted = manager.normalizeRuntimeInputs(
      { contents: [], resolved: { authToken: port } },
      'openai',
    );
    expect(admitted.resolved?.authToken).toBe(port);
    revoked = true;
    expect(port.provide()).toBeUndefined();
  });

  it('fails closed for a truly missing model with no provider default', () => {
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService, {
      getModel: () => '',
    });
    const manager = new ProviderManager({ settingsService, config });
    expect(() =>
      manager.normalizeRuntimeInputs(
        { contents: [], resolved: { model: '' } },
        'unknown-provider',
      ),
    ).toThrow('Incomplete runtime resolution (model)');
  });

  it('fails closed for a truly missing endpoint on a provider that requires one', () => {
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService, {
      getModel: () => '',
    });
    const manager = new ProviderManager({ settingsService, config });
    expect(() =>
      manager.normalizeRuntimeInputs(
        { contents: [], resolved: { model: 'explicit-model', baseURL: '' } },
        'unknown-provider',
      ),
    ).toThrow('Incomplete runtime resolution (baseURL)');
  });
});
