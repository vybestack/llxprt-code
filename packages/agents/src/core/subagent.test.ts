/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope core tests: ContextState, SubAgentScope, stateless compliance.
 */

import { vi, describe, it, expect } from 'vitest';
import { SubAgentScope } from './subagent.js';
import { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { PromptConfig } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { AgentRuntimeProviderAdapter } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import {
  createMockConfig,
  defaultModelConfig,
  defaultRunConfig,
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
} from './subagent-test-helpers.js';

vi.mock('@vybestack/llxprt-code-ide-integration', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@vybestack/llxprt-code-ide-integration')
    >();
  return {
    ...actual,
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        getConnectionStatus: vi.fn(),
        initialize: vi.fn(),
        shutdown: vi.fn(),
      }),
    },
  };
});
vi.mock(
  '@vybestack/llxprt-code-core/core/prompts.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@vybestack/llxprt-code-core/core/prompts.js')
      >();
    return {
      ...actual,
      getCoreSystemPromptAsync: vi.fn().mockResolvedValue('Core Prompt'),
    };
  },
);

describe('subagent.ts', () => {
  describe('ContextState', () => {
    it('should set and get values correctly', () => {
      const context = new ContextState();
      context.set('key1', 'value1');
      context.set('key2', 123);
      expect(context.get('key1')).toBe('value1');
      expect(context.get('key2')).toBe(123);
      expect(context.get_keys()).toStrictEqual(['key1', 'key2']);
    });

    it('should return undefined for missing keys', () => {
      const context = new ContextState();
      expect(context.get('missing')).toBeUndefined();
    });
  });

  describe('SubAgentScope', () => {
    describe('Stateless compliance (STATELESS7)', () => {
      it('should not read provider manager directly from Config', async () => {
        const { config } = await createMockConfig();
        const promptConfig: PromptConfig = { systemPrompt: 'Stateless' };
        const getProviderManagerSpy = vi.spyOn(config, 'getProviderManager');

        const providerAdapter: AgentRuntimeProviderAdapter = {
          getActiveProvider: vi.fn(
            () =>
              ({
                name: 'gemini',
                generateChatCompletion: vi.fn(async function* () {
                  yield { speaker: 'ai', blocks: [] };
                }),
                getDefaultModel: () => defaultModelConfig.model,
                getServerTools: () => [],
                invokeServerTool: vi.fn(),
              }) as IProvider,
          ),
          setActiveProvider: vi.fn(),
        };

        const { overrides } = createRuntimeOverrides({
          runtimeBundle: createStatelessRuntimeBundle({
            providerAdapter,
          }),
        });

        await SubAgentScope.create(
          'stateless-agent',
          config,
          promptConfig,
          defaultModelConfig,
          defaultRunConfig,
          undefined,
          undefined,
          overrides,
        );

        expect(getProviderManagerSpy).not.toHaveBeenCalled();
      });
    });
  });
});
