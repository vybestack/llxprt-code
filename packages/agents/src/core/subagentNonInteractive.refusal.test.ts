import { afterAll } from 'bun:test';
import { createChatPolicyFixture } from './__tests__/session-policy-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036: a subagent whose model refuses terminates with
 * `SubagentTerminateMode.REFUSAL`. It must not run the refused attempt's tool
 * calls and must not run the goal check, whose nudge would send another
 * request to the model that just refused.
 */

import {
  SubagentTerminateMode,
  type OutputObject,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  acquireSubagentSettings,
  acquireSubagentWorkspace,
  createStatelessRuntimeBundle,
  createSubagentConfig,
  defaultRunConfig,
  installSubagentCleanup,
  seedSubagentSettings,
} from './__tests__/subagent-test-helpers.js';
import { ChatSession, StreamEventType } from './chatSession.js';
import type { ExecutionLoopContext } from './subagentExecution.js';
import { executeNonInteractiveRun } from './subagentNonInteractive.js';
import { processFunctionCalls } from './subagentToolProcessing.js';

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

const UNREQUESTED: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'this response must never be requested' }],
};

function refusal(
  blocks: IContent['blocks'] = [],
  rawStopReason = 'refusal',
): IContent {
  return {
    speaker: 'ai',
    blocks,
    metadata: { finishReason: 'refusal', rawStopReason },
  };
}

function answer(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { finishReason: 'stop', rawStopReason: 'end_turn' },
  };
}

async function runSubagent(
  retainSubagentCleanup: (close: () => void | Promise<void>) => () => void,
  responses: readonly IContent[],
  todoReminder: string | null,
): Promise<{
  readonly output: OutputObject;
  readonly requestCount: number;
  readonly toolCalls: number;
}> {
  const configSettings = seedSubagentSettings();
  const config = createSubagentConfig(configSettings, retainSubagentCleanup);
  await acquireSubagentSettings(config, configSettings, retainSubagentCleanup);
  await acquireSubagentWorkspace(config, retainSubagentCleanup);
  const baseBundle = createStatelessRuntimeBundle();
  const output: OutputObject = {
    terminate_reason: SubagentTerminateMode.ERROR,
    emitted_vars: {},
  };
  const logger = new DebugLogger('issue4036-test');
  const resolveToolName = (name: string | undefined): string | null =>
    name && baseBundle.runtimeContext.tools.getToolMetadata(name) ? name : null;
  const execCtx: ExecutionLoopContext = {
    output,
    subagentId: 'refusal-agent',
    runConfig: defaultRunConfig,
    textToolParser: new GemmaToolCallParser(),
    resolveToolName,
    logger,
  };
  let requestCount = 0;
  let toolCalls = 0;
  const chat = {
    ...createChatPolicyFixture(),
    sendMessageStream: async () => {
      const response = responses[requestCount] ?? UNREQUESTED;
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
    [],
    new AbortController(),
    [{ speaker: 'human', blocks: [{ type: 'text', text: 'start' }] }],
    Date.now(),
    execCtx,
    {
      output,
      subagentId: 'refusal-agent',
      name: 'refusal-agent',
      sessionId: config.getSessionId(),
      logger,
      runConfig: defaultRunConfig,
      streamTimeoutPolicy: chat.getStreamTimeoutPolicy(),
      imagePayloadBudgetBytes: config.getImagePayloadBudgetBytes(),
      streamModel: (message, tools, signal, promptId, modelParameters) =>
        chat.sendMessageStream(
          {
            message,
            modelParameters,
            hookOwner: undefined,
            config: { abortSignal: signal, tools },
          },
          promptId,
        ),
      executeToolCalls: (calls, controller, promptId, allowedToolNames) =>
        processFunctionCalls(
          calls,
          controller,
          promptId,
          {
            output,
            subagentId: 'refusal-agent',
            logger,
            imagePayloadBudgetBytes: config.getImagePayloadBudgetBytes(),
            executeToolCall: async () => {
              toolCalls += 1;
              throw new Error('Unexpected tool call');
            },
          },
          allowedToolNames,
        ),
      readTodoCompletionPrompt: async () => todoReminder,
    },
    () => undefined,
  );

  return { output, requestCount, toolCalls };
}

describe('subagent non-interactive run whose model refuses (issue #4036)', () => {
  const retainSubagentCleanup = installSubagentCleanup();

  beforeEach(() => {
    vi.clearAllMocks();
    readTodos.mockResolvedValue([]);
  });

  it('terminates with the REFUSAL mode', async () => {
    const { output } = await runSubagent(
      retainSubagentCleanup,
      [refusal(), UNREQUESTED],
      null,
    );

    expect(output.terminate_reason).toBe(SubagentTerminateMode.REFUSAL);
  });

  it('skips the goal check even when the todo list would nudge the model', async () => {
    const { requestCount } = await runSubagent(
      retainSubagentCleanup,
      [refusal(), UNREQUESTED],
      'You still have outstanding todos. Please continue.',
    );

    expect(requestCount).toBe(1);
  });

  it('does not run tool calls carried by the refused attempt', async () => {
    const toolCall = {
      type: 'tool_call' as const,
      id: 'call-1',
      name: 'list_directory',
      parameters: { dir_path: '.' },
    };
    const { toolCalls, requestCount } = await runSubagent(
      retainSubagentCleanup,
      [refusal([toolCall]), UNREQUESTED],
      null,
    );

    expect({ toolCalls, requestCount }).toStrictEqual({
      toolCalls: 0,
      requestCount: 1,
    });
  });

  it('keeps the normal GOAL termination for an answering model', async () => {
    const { output, requestCount } = await runSubagent(
      retainSubagentCleanup,
      [answer('all done')],
      null,
    );

    expect({
      reason: output.terminate_reason,
      requestCount,
    }).toStrictEqual({ reason: SubagentTerminateMode.GOAL, requestCount: 1 });
  });
});

describe('module isolation', () => {
  afterAll(() => {
    void vi.mock('@vybestack/llxprt-code-tools', () => toolsModule);
  });
});
