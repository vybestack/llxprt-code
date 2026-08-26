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
  UNLIMITED_OUTPUT_TOKENS_TOTAL,
  type OutputConfig,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { SubAgentScope } from './subagent.js';
import {
  checkOutputBudget,
  checkTerminationConditions,
  GeneratedOutputCounter,
  recordTurnOutputTokens,
} from './subagentExecution.js';
import {
  createMockConfig,
  createRuntimeOverrides,
  createStatelessRuntimeBundle,
  defaultModelConfig,
} from './subagent-test-helpers.js';

interface ProviderTurn {
  readonly text?: string;
  readonly thought?: string;
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
        : [
            ...(turn.thought === undefined
              ? []
              : [{ type: 'thinking' as const, thought: turn.thought }]),
            { type: 'text' as const, text: turn.text ?? 'complete' },
          ];
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

  it('counts reasoning toward the estimate, not just visible text', async () => {
    // The profile that motivated #3335 ran reasoning at high effort with
    // includeInContext, so reasoning dwarfed visible text. Counting only the
    // visible text would leave the budget unenforceable for exactly that shape.
    const { config } = await createMockConfig();
    const reasoningHeavy = new ControlledUsageProvider([
      { thought: 'r'.repeat(4000), text: 'ok' },
    ]);
    const scope = await createBudgetScope(config, reasoningHeavy, {
      max_time_minutes: 5,
      max_turns: 20,
      max_output_tokens_total: 100,
    });

    await scope.runNonInteractive(new ContextState());

    expect(scope.output.terminate_reason).toBe(
      SubagentTerminateMode.MAX_OUTPUT,
    );

    // The same visible text with no reasoning stays well under the budget,
    // which is what proves the reasoning is what tripped it.
    const { config: textOnlyConfig } = await createMockConfig();
    const textOnly = new ControlledUsageProvider([{ text: 'ok' }]);
    const textOnlyScope = await createBudgetScope(textOnlyConfig, textOnly, {
      max_time_minutes: 5,
      max_turns: 20,
      max_output_tokens_total: 100,
    });

    await textOnlyScope.runNonInteractive(new ContextState());

    expect(textOnlyScope.output.terminate_reason).not.toBe(
      SubagentTerminateMode.MAX_OUTPUT,
    );
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

  describe('mid-turn budget check scope', () => {
    /**
     * The budget must be checkable mid-turn, but the turn and time limits must
     * not be, or a subagent on its last allowed turn would have the tool calls
     * it just emitted thrown away instead of executed.
     */
    const exhaustedTurns = {
      runConfig: { max_turns: 1, max_time_minutes: 5 },
      subagentId: 'sub-1',
      output: { output_tokens_total: 0, emitted_vars: {} },
      logger: { warn: () => {}, debug: () => {} },
    } as unknown as Parameters<typeof checkOutputBudget>[0];

    it('does not stop on an exhausted turn budget', () => {
      expect(checkOutputBudget(exhaustedTurns).shouldStop).toBe(false);
    });

    it('still stops on turns when the full check runs at the top of the loop', () => {
      const result = checkTerminationConditions(1, Date.now(), exhaustedTurns);

      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe(SubagentTerminateMode.MAX_TURNS);
    });

    it('counts a cumulative reasoning span once, not once per delta', () => {
      // Providers that carry a streamId re-emit the whole accumulated thought
      // on every delta. Summing them counts an N-character thought about N^2/2
      // times, which would trip an aggregate budget during legitimate work on a
      // high-reasoning profile.
      const counter = new GeneratedOutputCounter();
      for (let length = 1; length <= 100; length += 1) {
        counter.add([
          {
            type: 'thinking',
            thought: 'x'.repeat(length),
            streamId: 'span-1',
          },
        ] as never);
      }

      expect(counter.total).toBe(100);
    });

    it('sums thinking deltas that carry no stream identity', () => {
      // Without a streamId the provider is sending true increments, so they do
      // add up. Collapsing these would undercount reasoning to nearly nothing.
      const counter = new GeneratedOutputCounter();
      for (let index = 0; index < 10; index += 1) {
        counter.add([{ type: 'thinking', thought: 'xxx' }] as never);
      }

      expect(counter.total).toBe(30);
    });

    it('falls back to the estimate when usage reports zero despite output', () => {
      // Some providers normalise a missing completion count to 0. Treating that
      // as authoritative stops the run being counted at all.
      const ctx = { output: {} } as unknown as Parameters<
        typeof recordTurnOutputTokens
      >[0];

      expect(recordTurnOutputTokens(ctx, 0, 400)).toBe(100);
    });

    it('trusts an accurate report even when text is denser than the estimate', () => {
      // Real tokenizers pack code and JSON far tighter than four characters per
      // token. Overriding the provider here would stop runs early.
      const ctx = { output: {} } as unknown as Parameters<
        typeof recordTurnOutputTokens
      >[0];

      expect(recordTurnOutputTokens(ctx, 6, 400)).toBe(6);
    });

    it('treats a budget of 0 as stop-immediately, not unlimited', () => {
      // -1 is the only unlimited sentinel. A `> 0` guard anywhere in the chain
      // would turn a deliberate 0 into its opposite.
      const zeroBudget = {
        runConfig: { max_output_tokens_total: 0, max_time_minutes: 5 },
        subagentId: 'sub-1',
        output: { output_tokens_total: 1, emitted_vars: {} },
        logger: { warn: () => {}, debug: () => {} },
      } as unknown as Parameters<typeof checkOutputBudget>[0];

      const result = checkOutputBudget(zeroBudget);

      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe(SubagentTerminateMode.MAX_OUTPUT);
    });

    it('does not enforce the unlimited sentinel', () => {
      const unlimited = {
        runConfig: {
          max_output_tokens_total: UNLIMITED_OUTPUT_TOKENS_TOTAL,
          max_time_minutes: 5,
        },
        subagentId: 'sub-1',
        output: { output_tokens_total: 999_999_999, emitted_vars: {} },
        logger: { warn: () => {}, debug: () => {} },
      } as unknown as Parameters<typeof checkOutputBudget>[0];

      expect(checkOutputBudget(unlimited).shouldStop).toBe(false);
    });

    it('stops on an exceeded output budget', () => {
      const overBudget = {
        runConfig: { max_output_tokens_total: 100, max_time_minutes: 5 },
        subagentId: 'sub-1',
        output: { output_tokens_total: 101, emitted_vars: {} },
        logger: { warn: () => {}, debug: () => {} },
      } as unknown as Parameters<typeof checkOutputBudget>[0];

      const result = checkOutputBudget(overBudget);

      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe(SubagentTerminateMode.MAX_OUTPUT);
    });
  });
});
