/**
 * @plan PLAN-20250218-STATELESSPROVIDER.P04
 * @requirement REQ-SP-001
 * @pseudocode base-provider.md lines 4-15
 * @pseudocode provider-invocation.md lines 3-12
 */

import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { describe, it, expect, beforeEach } from 'bun:test';
import type {
  BaseProviderConfig,
  NormalizedGenerateChatOptions,
} from './BaseProvider.js';
import { BaseProvider } from './BaseProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IModel } from './IModel.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createProviderWithRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';

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
        id: 'contract-model',
        name: 'Contract Model',
        provider: 'contract',
        supportedToolFormats: [],
      },
    ];
  }

  getDefaultModel(): string {
    return 'contract-model';
  }

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.lastOptions = options;
    yield options.contents[0] ?? asContent('noop');
  }
}

let contractProvider: OptionRecorderProvider;

describe('generateChatCompletion contract', () => {
  beforeEach(() => {
    contractProvider = new OptionRecorderProvider({ name: 'contract' });
  });

  it('normalizes generated call options into options object', async () => {
    const message = asContent('contract-call');

    const options = createProviderCallOptions({
      providerName: contractProvider.name,
      contents: [message],
    });

    await contractProvider.generateChatCompletion(options).next();

    expect(contractProvider.lastOptions?.contents).toStrictEqual([message]);
    expect(contractProvider.lastOptions?.tools).toBeUndefined();
    expect(contractProvider.lastOptions?.resolved.model).toBe(
      contractProvider.getDefaultModel(),
    );
    expect(contractProvider.lastOptions).not.toHaveProperty('settings');
  });

  it('honours provided GenerateChatOptions payload', async () => {
    const {
      provider,
      runtime,
      settingsService: customSettings,
    } = createProviderWithRuntime<OptionRecorderProvider>(
      ({ settingsService: svc }) => {
        svc.set('auth-key', 'options-token');
        return new OptionRecorderProvider({ name: 'contract' });
      },
      {
        runtimeId: 'contract.options',
      },
    );
    const fakeConfig = {
      getUserMemory: () => 'contract-memory',
      getModel: () => 'contract-model',
    } as unknown as Config;

    provider.setRuntimeSettingsService(customSettings);
    provider.setConfig?.(fakeConfig);

    const options = {
      contents: [asContent('options-call')],
      invocation: captureProviderInvocation(
        { settingsService: customSettings, runtimeId: 'options-test' },
        'contract',
      ),
      metadata: { requestId: 'options-test' },
    } satisfies Parameters<OptionRecorderProvider['generateChatCompletion']>[0];

    runtime.config ??= fakeConfig;

    await provider.generateChatCompletion(options).next();

    expect(provider.lastOptions?.invocation.getEphemeral('auth-key')).toBe(
      'options-token',
    );
    expect(provider.lastOptions).not.toHaveProperty('settings');
    expect(provider.lastOptions).not.toHaveProperty('config');
    expect(provider.lastOptions?.metadata).toMatchObject({
      requestId: 'options-test',
    });
  });
});
