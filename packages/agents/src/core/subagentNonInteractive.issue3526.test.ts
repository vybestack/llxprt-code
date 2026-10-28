import { afterAll } from 'bun:test';
import { createChatPolicyFixture } from './__tests__/session-policy-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SubagentTerminateMode,
  type OutputConfig,
  type OutputObject,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import {
  toModelStreamChunk,
  type ToolDeclaration,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
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
import {
  checkGoalCompletion,
  type ExecutionLoopContext,
} from './subagentExecution.js';
import { executeNonInteractiveRun } from './subagentNonInteractive.js';
import { getScopeLocalFuncDefs } from './subagentRuntimeSetup.js';
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

const OUTPUT_CONFIG: OutputConfig = {
  outputs: {
    alpha: 'first value',
    beta: 'second value',
    gamma: 'third value',
    delta: 'fourth value',
  },
};

const FOUR_VALUES = [
  ['alpha', 'A'],
  ['beta', 'B'],
  ['gamma', 'C'],
  ['delta', 'D'],
] as const;

function toolCall(
  name: string,
  parameters: Readonly<Record<string, unknown>>,
  id = name,
): ContentBlock {
  return { type: 'tool_call', id, name, parameters };
}

function nativeEmissions(): IContent {
  return {
    speaker: 'ai',
    blocks: FOUR_VALUES.map(([name, value]) =>
      toolCall(
        'self_emitvalue',
        { emit_variable_name: name, emit_variable_value: value },
        `emit-${name}`,
      ),
    ),
  };
}

function hermesEmissions(): IContent {
  const text = FOUR_VALUES.map(
    ([name, value]) =>
      `<tool_call>\n${JSON.stringify({ name: 'self_emitvalue', arguments: { emit_variable_name: name, emit_variable_value: value } })}\n</tool_call>`,
  ).join('\n');
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function stopped(): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text: 'Done.' }] };
}

async function runDirectNonInteractive(
  retainSubagentCleanup: (close: () => void | Promise<void>) => () => void,
  params: {
    readonly outputConfig: OutputConfig;
    readonly declarations: readonly ToolDeclaration[];
    readonly responses: readonly IContent[];
    readonly emittedVars?: Readonly<Record<string, string>>;
  },
): Promise<{ readonly output: OutputObject; readonly requestCount: number }> {
  const configSettings = seedSubagentSettings();
  const config = createSubagentConfig(configSettings, retainSubagentCleanup);
  await acquireSubagentSettings(config, configSettings, retainSubagentCleanup);
  await acquireSubagentWorkspace(config, retainSubagentCleanup);
  const baseBundle = createStatelessRuntimeBundle();
  const output: OutputObject = {
    terminate_reason: SubagentTerminateMode.ERROR,
    emitted_vars: { ...params.emittedVars },
  };
  const logger = new DebugLogger('issue3526-test');
  const execCtx: ExecutionLoopContext = {
    output,
    subagentId: 'direct-issue3526-agent',
    runConfig: defaultRunConfig,
    outputConfig: params.outputConfig,
    textToolParser: new GemmaToolCallParser(),
    resolveToolName: (name) =>
      name && baseBundle.runtimeContext.tools.getToolMetadata(name)
        ? name
        : null,
    logger,
  };
  let requestCount = 0;
  const chat = {
    ...createChatPolicyFixture(),
    sendMessageStream: async () => {
      const response = params.responses[requestCount] ?? stopped();
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
    [...params.declarations],
    new AbortController(),
    [{ speaker: 'human', blocks: [{ type: 'text', text: 'start' }] }],
    Date.now(),
    {
      ...execCtx,
      resolveToolName: (name) =>
        name && baseBundle.runtimeContext.tools.getToolMetadata(name)
          ? name
          : null,
    },
    {
      output,
      subagentId: 'direct-issue3526-agent',
      name: 'direct-issue3526-agent',
      sessionId: config.getSessionId(),
      logger,
      runConfig: defaultRunConfig,
      outputConfig: params.outputConfig,
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
            subagentId: 'direct-issue3526-agent',
            logger,
            imagePayloadBudgetBytes: config.getImagePayloadBudgetBytes(),
            executeToolCall: async () => {
              throw new Error('Unexpected ordinary tool call in emitter test');
            },
          },
          allowedToolNames,
        ),
      readTodoCompletionPrompt: async () => null,
    },
    () => undefined,
  );

  return { output, requestCount };
}

describe('issue 3526 non-interactive emitter completion invariants', () => {
  const retainSubagentCleanup = installSubagentCleanup();

  beforeEach(() => {
    vi.clearAllMocks();
    readTodos.mockResolvedValue([]);
  });

  it('resolves raw Hermes emitter calls without an ordinary registry entry', async () => {
    const { output, requestCount } = await runDirectNonInteractive(
      retainSubagentCleanup,
      {
        outputConfig: OUTPUT_CONFIG,
        declarations: getScopeLocalFuncDefs(OUTPUT_CONFIG),
        responses: [hermesEmissions()],
      },
    );

    expect(output.emitted_vars).toStrictEqual({
      alpha: 'A',
      beta: 'B',
      gamma: 'C',
      delta: 'D',
    });
    expect(output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
    expect(requestCount).toBe(1);
  });

  it('uses a callable emitter when duplicate effective declarations are present', async () => {
    const emitterDeclarations = getScopeLocalFuncDefs(OUTPUT_CONFIG);

    const { output, requestCount } = await runDirectNonInteractive(
      retainSubagentCleanup,
      {
        outputConfig: OUTPUT_CONFIG,
        declarations: [...emitterDeclarations, ...emitterDeclarations],
        responses: [nativeEmissions()],
      },
    );

    expect(output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
    expect(output.emitted_vars).toStrictEqual({
      alpha: 'A',
      beta: 'B',
      gamma: 'C',
      delta: 'D',
    });
    expect(requestCount).toBe(1);
  });

  it('fails once without nudging when required outputs lack an effective emitter', async () => {
    const { output, requestCount } = await runDirectNonInteractive(
      retainSubagentCleanup,
      {
        outputConfig: OUTPUT_CONFIG,
        declarations: [
          {
            name: 'read_file',
            description: 'Read a file',
            parametersJsonSchema: { type: 'object', properties: {} },
          },
        ],
        responses: [
          {
            speaker: 'ai',
            blocks: [toolCall('read_file', { file_path: 'report.md' })],
          },
        ],
        emittedVars: { alpha: 'A', beta: 'B' },
      },
    );

    expect(output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    expect(output.final_message).toContain('self_emitvalue');
    expect(output.final_message).toContain('gamma, delta');
    expect(output.emitted_vars).toStrictEqual({ alpha: 'A', beta: 'B' });
    expect(requestCount).toBe(1);
  });

  it('fails missing-emitter provisioning when the required output key is named toString', async () => {
    const outputConfig: OutputConfig = {
      outputs: { toString: 'required value' },
    };

    const { output } = await runDirectNonInteractive(retainSubagentCleanup, {
      outputConfig,
      declarations: [],
      responses: [stopped()],
    });

    expect(output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    expect(output.final_message).toContain('toString');
  });

  it('nudges when the required output key named toString has not been emitted', async () => {
    const output: OutputObject = {
      terminate_reason: SubagentTerminateMode.ERROR,
      emitted_vars: {},
    };

    const nextMessages = await checkGoalCompletion(
      {
        output,
        outputConfig: { outputs: { toString: 'required value' } },
        subagentId: 'prototype-key-agent',
        logger: new DebugLogger('issue3526-test'),
      },
      null,
      0,
    );

    expect(nextMessages?.[0]?.blocks).toStrictEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('toString'),
      }),
    ]);
  });
});

describe('module isolation', () => {
  afterAll(() => {
    void vi.mock('@vybestack/llxprt-code-tools', () => toolsModule);
  });
});
