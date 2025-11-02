/**
 * @plan PLAN-20250218-STATELESSPROVIDER.P04
 * @requirement REQ-SP-001
 * @pseudocode base-provider.md lines 4-15
 * @pseudocode provider-invocation.md lines 3-12
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BaseProvider,
  BaseProviderConfig,
  NormalizedGenerateChatOptions,
} from './BaseProvider.js';
import type { IContent } from '../services/history/IContent.js';
import { IModel } from './IModel.js';
import type { Config } from '../config/config.js';
import { createProviderWithRuntime } from '../test-utils/runtime.js';
import {
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '../test-utils/providerCallOptions.js';

const asContent = (text: string): IContent => ({
  speaker: 'human',
  blocks: [
    {
      type: 'text',
      text,
    },
  ],
});

class OptionRecorderProvider extends BaseProvider {
  lastOptions?: NormalizedGenerateChatOptions;

  constructor(config: BaseProviderConfig) {
    super(config);
  }

  protected supportsOAuth(): boolean {
    return false;
  }

  async getModels(): Promise<IModel[]> {
    return [
      {
        id: 'compat-model',
        name: 'Compat Model',
        provider: 'compat',
        supportedToolFormats: [],
      },
    ];
  }

  getDefaultModel(): string {
    return 'compat-model';
  }

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.lastOptions = options;
    yield options.contents[0] ?? asContent('noop');
  }
}

let legacyProvider: OptionRecorderProvider;

beforeEach(() => {
  legacyProvider = new OptionRecorderProvider({ name: 'compat' });
});

describe('generateChatCompletion compatibility', () => {
  it('normalizes legacy arguments into options object', async () => {
    const message = asContent('legacy-call');

    const options = createProviderCallOptions({
      providerName: legacyProvider.name,
      contents: [message],
    });

    await legacyProvider.generateChatCompletion(options).next();

    expect(legacyProvider.lastOptions?.contents).toEqual([message]);
    expect(legacyProvider.lastOptions?.tools).toBeUndefined();
    expect(legacyProvider.lastOptions?.settings).toBe(options.settings);
  });

  it('honours provided GenerateChatOptions payload', async () => {
    const {
      provider,
      runtime,
      settingsService: customSettings,
    } = createProviderWithRuntime<OptionRecorderProvider>(
      ({ settingsService: svc }) => {
        svc.set('auth-key', 'options-token');
        return new OptionRecorderProvider({ name: 'compat' });
      },
      {
        runtimeId: 'compat.options',
      },
    );
    const fakeConfig = {
      getUserMemory: () => 'compat-memory',
      getModel: () => 'compat-model',
    } as unknown as Config;

    provider.setRuntimeSettingsService(customSettings);
    provider.setConfig?.(fakeConfig);

    const options = {
      contents: [asContent('options-call')],
      settings: customSettings,
      config: fakeConfig,
      metadata: { requestId: 'options-test' },
    } satisfies Parameters<OptionRecorderProvider['generateChatCompletion']>[0];

    if (!runtime.config) {
      runtime.config = fakeConfig;
    }

    setActiveProviderRuntimeContext(runtime);
    try {
      await provider.generateChatCompletion(options).next();
    } finally {
      clearActiveProviderRuntimeContext();
    }

    expect(provider.lastOptions?.settings).toBe(customSettings);
    expect(provider.lastOptions?.config).toBe(fakeConfig);
    expect(provider.lastOptions?.metadata).toMatchObject({
      requestId: 'options-test',
    });
  });
});
