/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentRuntimeProviderAdapter } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import {
  ContextState,
  SubagentTerminateMode,
  type OutputConfig,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { SubAgentScope } from './subagent.js';
import {
  createMockConfig,
  createRuntimeOverrides,
  createStatelessRuntimeBundle,
  defaultModelConfig,
} from './subagent-test-helpers.js';

interface ProviderTurn {
  readonly text?: string;
  readonly outputTokens?: number;
  readonly continueWithTool?: boolean;
}

class ControlledUsageProvider implements RuntimeProvider {
  readonly name = 'controlled-usage';
  readonly isDefault = true;
  turnCount = 0;

  constructor(private readonly turns: readonly ProviderTurn[]) {}

  getModels() {
    return Promise.resolve([]);
  }

  getDefaultModel() {
    return defaultModelConfig.model;
  }

  getCurrentModel() {
    return defaultModelConfig.model;
  }

  getServerTools() {
    return [];
  }

  invokeServerTool(): Promise<unknown> {
    return Promise.resolve(undefined);
  }

  async *generateChatCompletion(): AsyncIterableIterator<IContent> {
    const turn = this.turns[this.turnCount] ?? { text: 'complete' };
    this.turnCount += 1;
    const usage: UsageStats | undefined =
      turn.outputTokens === undefined
        ? undefined
        : {
            promptTokens: 1,
            completionTokens: turn.outputTokens,
            totalTokens: turn.outputTokens + 1,
          };
    const blocks =
      turn.continueWithTool === true
        ? [
            {
              type: 'tool_call' as const,
              id: `continue-${this.turnCount}`,
              name: 'self_emitvalue',
              parameters: {
                emit_variable_name: 'progress',
                emit_variable_value: String(this.turnCount),
              },
            },
          ]
        : [{ type: 'text' as const, text: turn.text ?? 'complete' }];
    yield {
      speaker: 'ai',
      blocks,
      metadata: {
        finishReason: turn.continueWithTool === true ? 'tool_calls' : 'stop',
        ...(usage === undefined ? {} : { usage }),
      },
    };
  }
}

async function createBudgetScope(
  config: Config,
  provider: ControlledUsageProvider,
  runConfig: RunConfig,
): Promise<SubAgentScope> {
  const providerAdapter: AgentRuntimeProviderAdapter = {
    getActiveProvider: () => provider,
    setActiveProvider: () => undefined,
  };
  const runtimeBundle = createStatelessRuntimeBundle({
    providerAdapter,
    history: new HistoryService(),
  });
  const { overrides } = createRuntimeOverrides({ runtimeBundle });
  const outputConfig: OutputConfig = { outputs: {} };

  return SubAgentScope.create(
    'aggregate-budget-agent',
    config,
    { systemPrompt: 'Exercise aggregate output accounting.' },
    defaultModelConfig,
    runConfig,
    undefined,
    outputConfig,
    overrides,
  );
}

describe('subagent aggregate output token budget', () => {
  it('terminates the real non-interactive loop after provider usage crosses the budget', async () => {
    const { config } = await createMockConfig();
    const provider = new ControlledUsageProvider([
      { outputTokens: 6, continueWithTool: true },
      { outputTokens: 6, continueWithTool: true },
      { outputTokens: 6, continueWithTool: true },
    ]);
    const scope = await createBudgetScope(config, provider, {
      max_time_minutes: 5,
      max_turns: 20,
      max_output_tokens_total: 10,
    });

    await scope.runNonInteractive(new ContextState());

    expect(provider.turnCount).toBe(2);
    expect(scope.output.terminate_reason).toBe(
      SubagentTerminateMode.MAX_OUTPUT,
    );
    expect(scope.output.output_tokens_total).toBe(12);
    expect(scope.output.final_message).toContain(
      'subagent-max-output-tokens-total',
    );
    expect(scope.output.final_message).toContain('12');
    expect(scope.output.final_message).toContain('10');
  });

  it('does not terminate when cumulative provider usage stays below the budget', async () => {
    const { config } = await createMockConfig();
    const provider = new ControlledUsageProvider([
      { outputTokens: 3, continueWithTool: true },
      { outputTokens: 3, text: 'finished below budget' },
    ]);
    const scope = await createBudgetScope(config, provider, {
      max_time_minutes: 5,
      max_turns: 20,
      max_output_tokens_total: 10,
    });

    await scope.runNonInteractive(new ContextState());

    expect(provider.turnCount).toBe(2);
    expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
    expect(scope.output.output_tokens_total).toBe(6);
  });

  it('treats -1 as unlimited and runs past the otherwise effective budget', async () => {
    const { config } = await createMockConfig();
    const provider = new ControlledUsageProvider([
      { outputTokens: 6, continueWithTool: true },
      { outputTokens: 6, continueWithTool: true },
      { outputTokens: 6, text: 'finished without aggregate cap' },
    ]);
    const scope = await createBudgetScope(config, provider, {
      max_time_minutes: 5,
      max_turns: 20,
      max_output_tokens_total: -1,
    });

    await scope.runNonInteractive(new ContextState());

    expect(provider.turnCount).toBe(3);
    expect(scope.output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
    expect(scope.output.output_tokens_total).toBe(18);
  });

  it('uses a character estimate when provider usage metadata is absent', async () => {
    const { config } = await createMockConfig();
    const provider = new ControlledUsageProvider([{ text: 'x'.repeat(80) }]);
    const scope = await createBudgetScope(config, provider, {
      max_time_minutes: 5,
      max_turns: 20,
      max_output_tokens_total: 10,
    });

    await scope.runNonInteractive(new ContextState());

    expect(scope.output.terminate_reason).toBe(
      SubagentTerminateMode.MAX_OUTPUT,
    );
    expect(scope.output.output_tokens_total).toBeGreaterThan(0);
  });

  it('applies the same aggregate budget to the real interactive loop', async () => {
    const { config } = await createMockConfig();
    const provider = new ControlledUsageProvider([
      { outputTokens: 6, continueWithTool: true },
      { outputTokens: 6, continueWithTool: true },
      { outputTokens: 6, continueWithTool: true },
    ]);
    const scope = await createBudgetScope(config, provider, {
      max_time_minutes: 5,
      max_turns: 20,
      max_output_tokens_total: 10,
    });

    await scope.runInteractive(new ContextState(), {
      schedulerFactory: () => ({ schedule: () => undefined }),
    });

    expect(provider.turnCount).toBe(2);
    expect(scope.output.terminate_reason).toBe(
      SubagentTerminateMode.MAX_OUTPUT,
    );
    expect(scope.output.output_tokens_total).toBe(12);
  });
});
