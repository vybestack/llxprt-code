/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260616-ISSUE2068
 * Behavioral tests: RetryOrchestrator must not fabricate invocation stubs
 * that lack the RuntimeInvocationContext contract. When the legacy
 * (contents, tools, signal) signature is used, the signal must propagate
 * without producing a malformed invocation that crashes providers calling
 * options.invocation.getModelBehavior.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IModel } from '../IModel.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';

async function consumeStream(
  stream: AsyncIterableIterator<IContent>,
): Promise<void> {
  for await (const _chunk of stream) {
    void _chunk;
  }
}

const PROVIDER_NAME = 'retry-invocation-safety';

/**
 * A real BaseProvider subclass so the full normalization path (which is the
 * production crash site) is exercised. RetryOrchestrator wraps this provider.
 */
class SafetyBaseProvider extends BaseProvider {
  lastNormalized: NormalizedGenerateChatOptions | undefined;

  constructor() {
    super({ name: PROVIDER_NAME });
  }

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'safety-model';
  }

  protected supportsOAuth(): boolean {
    return false;
  }

  protected generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.lastNormalized = options;
    return (async function* () {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'ok' }],
      } as IContent;
    })();
  }
}

function wireProvider(provider: SafetyBaseProvider): SettingsService {
  (
    provider as unknown as {
      authResolver: {
        resolveAuthentication: (input: unknown) => Promise<string>;
        setSettingsService: (settings: SettingsService | undefined) => void;
      };
    }
  ).authResolver = {
    resolveAuthentication: vi.fn().mockResolvedValue('token'),
    setSettingsService: vi.fn(),
  };
  const settings = new SettingsService();
  settings.set('model', `${PROVIDER_NAME}-model`);
  settings.setProviderSetting(PROVIDER_NAME, 'model', `${PROVIDER_NAME}-model`);
  const config = createRuntimeConfigStub(settings);
  setActiveProviderRuntimeContext({ settingsService: settings, config });
  (provider as unknown as { defaultConfig?: unknown }).defaultConfig = config;
  return settings;
}

describe('RetryOrchestrator invocation safety', () => {
  const prompt: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'hi' }],
  } as IContent;

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('does not crash a wrapped BaseProvider when the legacy signal signature is used', async () => {
    const baseProvider = new SafetyBaseProvider();
    wireProvider(baseProvider);
    const orchestrator = new RetryOrchestrator(baseProvider);

    const abortController = new AbortController();

    // Legacy signature: (contents, tools, signal)
    await consumeStream(
      orchestrator.generateChatCompletion(
        [prompt],
        undefined,
        abortController.signal,
      ),
    );

    const normalized = baseProvider.lastNormalized;
    expect(normalized).toBeDefined();
    expect(typeof normalized!.invocation.getModelBehavior).toBe('function');
    expect(normalized!.invocation.signal).toBe(abortController.signal);
  });

  it('does not crash a wrapped BaseProvider when only options + signal are provided', async () => {
    const baseProvider = new SafetyBaseProvider();
    const settings = wireProvider(baseProvider);
    const orchestrator = new RetryOrchestrator(baseProvider);

    const abortController = new AbortController();

    const options: GenerateChatOptions = {
      contents: [prompt],
      settings,
    };

    await consumeStream(
      orchestrator.generateChatCompletion(
        options,
        undefined,
        abortController.signal,
      ),
    );

    const normalized = baseProvider.lastNormalized;
    expect(normalized).toBeDefined();
    expect(typeof normalized!.invocation.getModelBehavior).toBe('function');
    expect(normalized!.invocation.signal).toBe(abortController.signal);
  });

  it('adds an explicit signal to an existing invocation object', async () => {
    const baseProvider = new SafetyBaseProvider();
    const settings = wireProvider(baseProvider);
    const orchestrator = new RetryOrchestrator(baseProvider);

    const existingInvocation = {
      ephemerals: {},
    } as GenerateChatOptions['invocation'];
    const abortController = new AbortController();

    await consumeStream(
      orchestrator.generateChatCompletion(
        {
          contents: [prompt],
          settings,
          invocation: existingInvocation,
        },
        undefined,
        abortController.signal,
      ),
    );

    const normalized = baseProvider.lastNormalized;
    expect(normalized).toBeDefined();
    expect(typeof normalized!.invocation.getModelBehavior).toBe('function');
    expect(normalized!.invocation.signal).toBe(abortController.signal);
  });

  it('preserves abort propagation through the legacy signal signature', async () => {
    let providerCalls = 0;

    const provider: IProvider = {
      name: 'abort-legacy-provider',
      async *generateChatCompletion(_options: GenerateChatOptions) {
        providerCalls++;
        void _options;
        yield* [];
        throw Object.assign(new Error('Transient failure'), { status: 500 });
      },
      async getModels(): Promise<IModel[]> {
        return [];
      },
      getDefaultModel(): string {
        return 'test-model';
      },
      getServerTools(): string[] {
        return [];
      },
      async invokeServerTool(): Promise<unknown> {
        return null;
      },
    };

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 3,
      initialDelayMs: 1000,
    });

    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 50);

    await expect(
      consumeStream(
        orchestrator.generateChatCompletion(
          [prompt],
          undefined,
          abortController.signal,
        ),
      ),
    ).rejects.toThrow(/abort/i);

    expect(providerCalls).toBeGreaterThanOrEqual(1);
  });

  it('propagates signal to the wrapped provider via invocation', async () => {
    let receivedSignal: AbortSignal | undefined;

    const provider: IProvider = {
      name: 'signal-receiver-provider',
      async *generateChatCompletion(options: GenerateChatOptions) {
        receivedSignal = options.invocation?.signal;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'ok' }],
        } as IContent;
      },
      async getModels(): Promise<IModel[]> {
        return [];
      },
      getDefaultModel(): string {
        return 'test-model';
      },
      getServerTools(): string[] {
        return [];
      },
      async invokeServerTool(): Promise<unknown> {
        return null;
      },
    };

    const orchestrator = new RetryOrchestrator(provider);

    const abortController = new AbortController();

    await consumeStream(
      orchestrator.generateChatCompletion(
        [prompt],
        undefined,
        abortController.signal,
      ),
    );

    expect(receivedSignal).toBe(abortController.signal);
  });
});
