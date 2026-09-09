/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3540 — a supported textual (Hermes) `self_emitvalue` call carrying
 * malformed arguments must be rejected by the same scope-local handler that
 * serves native calls: nothing is written to `emitted_vars` and the run never
 * reports `GOAL` from the malformed call. The direct-runtime harness drives
 * the real GemmaToolCallParser so the `<tool_call>` text takes the
 * synthesize-and-resolve route, not a native tool_call chunk.
 */

import { describe, expect, it, vi, beforeEach } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import {
  SubagentTerminateMode,
  type OutputConfig,
  type OutputObject,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ChatSession, StreamEventType } from './chatSession.js';
import { executeNonInteractiveRun } from './subagentNonInteractive.js';
import type { ExecutionLoopContext } from './subagentExecution.js';
import { getScopeLocalFuncDefs } from './subagentRuntimeSetup.js';
import {
  createMockConfig,
  createStatelessRuntimeBundle,
  defaultRunConfig,
} from './subagent-test-helpers.js';

const { readTodos, TodoStoreMock } = (() => {
  const readTodos = vi.fn(async () => []);
  const TodoStoreMock = vi.fn(() => ({ readTodos }));
  return { readTodos, TodoStoreMock };
})();
const toolsModule = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () => ({
  ...toolsModule,
  LocalTodoStore: TodoStoreMock,
}));

const OUTPUT_CONFIG: OutputConfig = {
  outputs: {
    alpha: 'first value',
    beta: 'second value',
  },
};

function hermesEmission(args: Readonly<Record<string, unknown>>): IContent {
  const text = `<tool_call>\n${JSON.stringify({ name: 'self_emitvalue', arguments: args })}\n</tool_call>`;
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function stopped(): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text: 'Done.' }] };
}

async function runDirectNonInteractive(
  responses: readonly IContent[],
): Promise<{ readonly output: OutputObject; readonly requestCount: number }> {
  const { config } = await createMockConfig();
  const baseBundle = createStatelessRuntimeBundle();
  const output: OutputObject = {
    terminate_reason: SubagentTerminateMode.ERROR,
    emitted_vars: {},
  };
  const logger = new DebugLogger('issue3540-test');
  const execCtx: ExecutionLoopContext = {
    output,
    subagentId: 'direct-issue3540-agent',
    runConfig: defaultRunConfig,
    outputConfig: OUTPUT_CONFIG,
    textToolParser: new GemmaToolCallParser(),
    toolsView: baseBundle.runtimeContext.tools,
    logger,
  };
  let requestCount = 0;
  const chat = {
    sendMessageStream: async () => {
      const response = responses[requestCount] ?? stopped();
      requestCount += 1;
      return (async function* () {
        yield {
          type: StreamEventType.CHUNK,
          value: toModelStreamChunk(response),
        };
      })();
    },
  } as unknown as ChatSession;

  await executeNonInteractiveRun(
    chat,
    [...getScopeLocalFuncDefs(OUTPUT_CONFIG)],
    new AbortController(),
    [{ speaker: 'human', blocks: [{ type: 'text', text: 'start' }] }],
    Date.now(),
    execCtx,
    {
      output,
      subagentId: 'direct-issue3540-agent',
      name: 'direct-issue3540-agent',
      runtimeContext: baseBundle.runtimeContext,
      logger,
      config,
      runConfig: defaultRunConfig,
      outputConfig: OUTPUT_CONFIG,
      toolExecutorContext: config,
    },
    () => undefined,
  );

  return { output, requestCount };
}

describe('issue 3540 textual Hermes emitter rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readTodos.mockResolvedValue([]);
  });

  it('rejects a Hermes emitter call with a null value without emitting', async () => {
    const { output } = await runDirectNonInteractive([
      hermesEmission({
        emit_variable_name: 'alpha',
        emit_variable_value: null,
      }),
    ]);

    expect(output.emitted_vars).toStrictEqual({});
    expect(output.terminate_reason).not.toBe(SubagentTerminateMode.GOAL);
  });

  it('rejects a Hermes emitter call with missing arguments without emitting', async () => {
    const { output } = await runDirectNonInteractive([
      hermesEmission({ emit_variable_name: 'alpha' }),
    ]);

    expect(output.emitted_vars).toStrictEqual({});
    expect(output.terminate_reason).not.toBe(SubagentTerminateMode.GOAL);
  });

  it('still completes GOAL when a later Hermes call is well-formed', async () => {
    const { output } = await runDirectNonInteractive([
      hermesEmission({
        emit_variable_name: 'alpha',
        emit_variable_value: null,
      }),
      hermesEmission({ emit_variable_name: 'alpha', emit_variable_value: 'A' }),
      hermesEmission({ emit_variable_name: 'beta', emit_variable_value: 'B' }),
    ]);

    expect(output.emitted_vars).toStrictEqual({ alpha: 'A', beta: 'B' });
    expect(output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
  });
});
