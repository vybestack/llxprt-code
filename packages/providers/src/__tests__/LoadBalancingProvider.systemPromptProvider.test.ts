/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests proving the load balancer threads the concrete candidate
 * provider name (not the wrapper's 'load-balancer' name) through the
 * system-prompt assembler on every round-robin selection and every failover
 * attempt (issue #3176, finding D).
 *
 * Mutation sensitivity: if provider forwarding were removed the assembler
 * would receive `undefined` instead of the concrete provider name, and the
 * rendered prompt would not contain the candidate's provider sentinel.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type ResolvedSubProfile,
} from '../LoadBalancingProvider.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function createTextContent(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function createResolvedSubProfile(
  overrides: Partial<ResolvedSubProfile>,
): ResolvedSubProfile {
  return {
    name: overrides.name ?? 'sub',
    providerName: overrides.providerName ?? 'openai',
    model: overrides.model ?? 'gpt-4.1',
    authToken: overrides.authToken ?? 'test-token',
    ephemeralSettings: overrides.ephemeralSettings ?? {},
    modelParams: overrides.modelParams ?? {},
  };
}

interface CapturingProvider extends IProvider {
  readonly captured: GenerateChatOptions[];
}

function createCapturingProvider(name: string): CapturingProvider {
  const captured: GenerateChatOptions[] = [];
  return {
    name,
    captured,
    async *generateChatCompletion(
      optionsOrContents: GenerateChatOptions | IContent[],
    ): AsyncGenerator<IContent> {
      if (Array.isArray(optionsOrContents)) {
        throw new Error('Legacy chat arguments are not used by this test');
      }
      captured.push(optionsOrContents);
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
    },
    getModels: async () => [],
    getDefaultModel: () => 'test',
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
  };
}

/**
 * Assembler that encodes both provider and model into the rendered prompt so
 * assertions can prove the concrete candidate identity reached the assembler.
 */
function providerModelAssembler(): {
  assembler: {
    assemble: (request: {
      provider: string | undefined;
      model: string;
    }) => Promise<string>;
  };
  invocations: Array<{ provider: string | undefined; model: string }>;
} {
  const invocations: Array<{ provider: string | undefined; model: string }> =
    [];
  return {
    assembler: {
      assemble: async (request: {
        provider: string | undefined;
        model: string;
      }): Promise<string> => {
        invocations.push({
          provider: request.provider,
          model: request.model,
        });
        return `[provider=${request.provider} model=${request.model}]`;
      },
    },
    invocations,
  };
}

async function consume(
  provider: LoadBalancingProvider,
  options: GenerateChatOptions,
): Promise<void> {
  for await (const _ of provider.generateChatCompletion(options)) {
    void _;
  }
}

describe('LoadBalancingProvider - provider-specific prompt rendering (issue #3176)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  it('round-robin: each candidate renders its own provider+model sentinel', async () => {
    const delegateOpenai = createCapturingProvider('openai');
    const delegateAnthropic = createCapturingProvider('anthropic');
    providerManager.registerProvider(delegateOpenai);
    providerManager.registerProvider(delegateAnthropic);

    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'rr-provider-render',
      strategy: 'round-robin',
      contextLimit: 1_000_000,
      subProfiles: [
        createResolvedSubProfile({
          name: 'a',
          providerName: 'openai',
          model: 'model-a',
        }),
        createResolvedSubProfile({
          name: 'b',
          providerName: 'anthropic',
          model: 'model-b',
        }),
      ],
    };
    const lb = new LoadBalancingProvider(lbConfig, providerManager);

    const { assembler, invocations } = providerModelAssembler();

    await consume(lb, {
      contents: [createTextContent('first')],
      systemInstruction: '[provider=load-balancer]',
      systemPromptAssembler: assembler,
    });
    await consume(lb, {
      contents: [createTextContent('second')],
      systemInstruction: '[provider=load-balancer]',
      systemPromptAssembler: assembler,
    });

    expect(invocations).toEqual([
      { provider: 'openai', model: 'model-a' },
      { provider: 'anthropic', model: 'model-b' },
    ]);
    expect(delegateOpenai.captured[0].systemInstruction).toBe(
      '[provider=openai model=model-a]',
    );
    expect(delegateAnthropic.captured[0].systemInstruction).toBe(
      '[provider=anthropic model=model-b]',
    );
  });

  it('failover: each attempted backend renders its own provider+model sentinel', async () => {
    const openaiCaptured: GenerateChatOptions[] = [];
    let openaiAttempts = 0;
    const openai: IProvider = {
      name: 'openai',
      async *generateChatCompletion(
        optionsOrContents: GenerateChatOptions | IContent[],
      ): AsyncGenerator<IContent> {
        if (Array.isArray(optionsOrContents)) {
          throw new Error('Legacy chat arguments are not used by this test');
        }
        openaiCaptured.push(optionsOrContents);
        openaiAttempts++;
        if (openaiAttempts === 1) {
          throw new Error('primary down');
        }
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'model-a',
      getServerTools: () => [],
      invokeServerTool: async () => ({}),
    };
    const anthropicCaptured: GenerateChatOptions[] = [];
    const anthropic: IProvider = {
      name: 'anthropic',
      async *generateChatCompletion(
        optionsOrContents: GenerateChatOptions | IContent[],
      ): AsyncGenerator<IContent> {
        if (Array.isArray(optionsOrContents)) {
          throw new Error('Legacy chat arguments are not used by this test');
        }
        anthropicCaptured.push(optionsOrContents);
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'model-b',
      getServerTools: () => [],
      invokeServerTool: async () => ({}),
    };
    providerManager.registerProvider(openai);
    providerManager.registerProvider(anthropic);

    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'failover-provider-render',
      strategy: 'failover',
      contextLimit: 1_000_000,
      lbProfileEphemeralSettings: {
        failover_retry_count: 1,
        failover_retry_delay_ms: 0,
      },
      subProfiles: [
        createResolvedSubProfile({
          name: 'a',
          providerName: 'openai',
          model: 'model-a',
        }),
        createResolvedSubProfile({
          name: 'b',
          providerName: 'anthropic',
          model: 'model-b',
        }),
      ],
    };
    const lb = new LoadBalancingProvider(lbConfig, providerManager);

    const { assembler, invocations } = providerModelAssembler();

    await consume(lb, {
      contents: [createTextContent('request')],
      systemInstruction: '[provider=load-balancer]',
      systemPromptAssembler: assembler,
    });

    expect(invocations).toEqual([
      { provider: 'openai', model: 'model-a' },
      { provider: 'anthropic', model: 'model-b' },
    ]);
    expect(openaiCaptured[0].systemInstruction).toBe(
      '[provider=openai model=model-a]',
    );
    expect(anthropicCaptured[0].systemInstruction).toBe(
      '[provider=anthropic model=model-b]',
    );
  });
});
