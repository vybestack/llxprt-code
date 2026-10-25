import { createSubagentScope } from './__tests__/helpers/create-subagent-scope.js';
import { scopeInputs } from './__tests__/subagent-test-helpers.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SubAgentScope core tests: ContextState, SubAgentScope, stateless compliance.
 */

import { vi, describe, it, expect } from 'bun:test';
import { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { PromptConfig } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { AgentRuntimeProviderAdapter } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import {
  installSubagentCleanup,
  seedSubagentSettings,
  createSubagentConfig,
  acquireSubagentSettings,
  acquireSubagentWorkspace,
  defaultModelConfig,
  defaultRunConfig,
  createStatelessRuntimeBundle,
  createRuntimeOverrides,
} from './__tests__/subagent-test-helpers.js';

const actual2 = {
  ...(await import('@vybestack/llxprt-code-core/core/prompts.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  ...actual2,
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('Core Prompt'),
}));

describe('subagent.ts', () => {
  const retainSubagentCleanup = installSubagentCleanup();

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
        const configSettings = seedSubagentSettings();
        const config = createSubagentConfig(
          configSettings,
          retainSubagentCleanup,
        );
        await acquireSubagentSettings(
          config,
          configSettings,
          retainSubagentCleanup,
        );
        const mcpRuntime = await acquireSubagentWorkspace(
          config,
          retainSubagentCleanup,
        );
        const promptConfig: PromptConfig = { systemPrompt: 'Stateless' };
        const getProviderManagerSpy = vi.fn(() => {
          throw new Error('Forbidden Config manager discovery');
        });
        Object.defineProperty(config, 'getProviderManager', {
          value: getProviderManagerSpy,
        });

        const providerAdapter: AgentRuntimeProviderAdapter = {
          getActiveProvider: vi.fn(
            () =>
              ({
                name: 'gemini',
                generateChatCompletion: vi.fn(async function* () {
                  yield { speaker: 'ai', blocks: [] };
                }),
                getDefaultModel: () => defaultModelConfig.model,
              }) as IProvider,
          ),
          setActiveProvider: vi.fn(),
        };

        const { overrides } = createRuntimeOverrides(
          mcpRuntime.workspaceFilesystem.paths,
          {
            runtimeBundle: createStatelessRuntimeBundle({
              providerAdapter,
            }),
          },
        );

        await createSubagentScope(
          {
            name: 'stateless-agent',
            prompt: promptConfig,
            model: defaultModelConfig,
            run: defaultRunConfig,
            toolConfig: undefined,
            outputConfig: undefined,
          },
          ...scopeInputs(config, overrides),
        );

        expect(getProviderManagerSpy).not.toHaveBeenCalled();
      });
    });
  });
});
