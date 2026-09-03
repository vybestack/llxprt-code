/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import { beforeEach, describe, expect, it, vi, type Mock } from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  RuntimeProvider as IProvider,
  RuntimeToolDeclaration,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type {
  RuntimeGenerateChatOptions as GenerateChatOptions,
  RuntimeProviderToolset,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeProviderAdapter,
  ToolRegistryView,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  ContextState,
  SubagentTerminateMode,
  type OutputConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import { SubAgentScope } from './subagent.js';
import { executeToolCall } from './nonInteractiveToolExecutor.js';
import {
  createCompletedToolCallResponse,
  createMockConfig,
  createRuntimeOverrides,
  createStatelessRuntimeBundle,
  defaultModelConfig,
  defaultRunConfig,
} from './subagent-test-helpers.js';

const realNonInteractiveToolExecutorModule = {
  ...(await import('./nonInteractiveToolExecutor.js')),
};
void vi.mock('./nonInteractiveToolExecutor.js', () =>
  automock(realNonInteractiveToolExecutorModule),
);

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

const EXPECTED_EMIT_SCHEMA = {
  type: 'object',
  properties: {
    emit_variable_name: {
      description: 'This is the name of the variable to be returned.',
      type: 'string',
    },
    emit_variable_value: {
      description: 'This is the _value_ to be returned for this variable.',
      type: 'string',
    },
  },
  required: ['emit_variable_name', 'emit_variable_value'],
};

type HookMode =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly allowedFunctionNames?: readonly string[];
    };

interface RuntimeHarness {
  readonly requests: GenerateChatOptions[];
  readonly scope: SubAgentScope;
}

type CompletedToolCallFixture = Omit<
  ReturnType<typeof createCompletedToolCallResponse>,
  'status'
> & {
  readonly status: 'success' | 'error' | 'cancelled';
};

function mockCompletedToolCall(response: CompletedToolCallFixture): void {
  const mockedExecutor = executeToolCall as Mock<
    () => Promise<CompletedToolCallFixture>
  >;
  mockedExecutor.mockResolvedValueOnce(response);
}

function mockSuccessfulPause(callId: string, toolName = 'todo_pause'): void {
  mockCompletedToolCall(
    createCompletedToolCallResponse({
      callId,
      responseParts: [
        {
          type: 'tool_response',
          callId,
          toolName,
          result: { message: 'Paused' },
        },
      ],
    }),
  );
}

function mockCancelledPause(callId: string): void {
  const cancellationMessage = 'Tool call cancelled by user.';
  mockCompletedToolCall({
    ...createCompletedToolCallResponse({
      callId,
      responseParts: [
        {
          type: 'tool_response',
          callId,
          toolName: 'todo_pause',
          result: { error: cancellationMessage },
          error: cancellationMessage,
        },
      ],
    }),
    status: 'cancelled',
  });
}

function toolCall(
  name: string,
  parameters: Readonly<Record<string, unknown>>,
  id = name,
): ContentBlock {
  return { type: 'tool_call', id, name, parameters };
}

function emitCall(
  name: keyof typeof OUTPUT_CONFIG.outputs,
  value: string,
): ContentBlock {
  return toolCall(
    'self_emitvalue',
    { emit_variable_name: name, emit_variable_value: value },
    `emit-${name}`,
  );
}

function nativeEmissions(
  entries: ReadonlyArray<readonly [keyof typeof OUTPUT_CONFIG.outputs, string]>,
): IContent {
  return {
    speaker: 'ai',
    blocks: entries.map(([name, value]) => emitCall(name, value)),
  };
}

function hermesEmissions(
  entries: ReadonlyArray<readonly [keyof typeof OUTPUT_CONFIG.outputs, string]>,
): IContent {
  const text = entries
    .map(
      ([name, value]) =>
        `<tool_call>\n${JSON.stringify({ name: 'self_emitvalue', arguments: { emit_variable_name: name, emit_variable_value: value } })}\n</tool_call>`,
    )
    .join('\n');
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function stopped(text = 'Done.'): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function declarationsFrom(
  options: GenerateChatOptions,
): RuntimeToolDeclaration[] {
  if (options.tools === undefined) {
    throw new Error('Expected provider request tool declarations.');
  }
  return options.tools.flatMap((group) => group.functionDeclarations);
}

function requestText(options: GenerateChatOptions): string {
  return options.contents
    .flatMap((content) => content.blocks)
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type !== 'tool_response') return '';
      return JSON.stringify(block.result);
    })
    .join('\n');
}

function findMissingOutputNudge(
  requests: readonly GenerateChatOptions[],
): GenerateChatOptions {
  const request = requests.find((candidate) =>
    requestText(candidate).includes('not emitted'),
  );
  if (request === undefined) {
    throw new Error('Expected a missing-output nudge request.');
  }
  return request;
}

function createHookConfig(config: Config, mode: HookMode): Config {
  const hookConfig = Object.create(config) as Config;
  Object.defineProperties(hookConfig, {
    getEnableHooks: { value: () => mode.enabled },
    getHookSystem: {
      value: () => {
        if (!mode.enabled) return undefined;
        return {
          initialize: async () => undefined,
          isInitialized: () => true,
          fireBeforeToolSelectionEvent: async () => ({
            applyToolConfigModifications: () =>
              mode.allowedFunctionNames === undefined
                ? { toolConfig: {} }
                : {
                    toolConfig: {
                      allowedFunctionNames: [...mode.allowedFunctionNames],
                    },
                  },
          }),
          fireBeforeModelEvent: async () => undefined,
          fireAfterModelEvent: async () => undefined,
        };
      },
    },
  });
  return hookConfig;
}

async function createHarness(params: {
  readonly responses: readonly IContent[];
  readonly hookMode?: HookMode;
  readonly toolConfig?: { readonly tools: readonly string[] };
  readonly outputConfig?: OutputConfig | null;
}): Promise<RuntimeHarness> {
  const { config, toolRegistry } = await createMockConfig();
  const requests: GenerateChatOptions[] = [];
  let responseIndex = 0;
  function generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  function generateChatCompletion(
    content: IContent[],
    tools?: RuntimeProviderToolset,
    signal?: AbortSignal,
  ): AsyncIterableIterator<IContent>;
  function generateChatCompletion(
    input: GenerateChatOptions | IContent[],
  ): AsyncIterableIterator<IContent> {
    return (async function* () {
      if (Array.isArray(input)) {
        throw new Error('Expected request options from the runtime.');
      }
      requests.push(input);
      const response = params.responses[responseIndex] ?? stopped();
      responseIndex += 1;
      yield response;
    })();
  }
  const provider: IProvider = {
    name: 'gemini',
    getModels: async () => [],
    getDefaultModel: () => defaultModelConfig.model,
    getServerTools: () => [],
    invokeServerTool: vi.fn(),
    generateChatCompletion,
  };
  const providerAdapter: AgentRuntimeProviderAdapter = {
    getActiveProvider: () => provider,
    getProviderByName: () => provider,
    setActiveProvider: vi.fn(),
  };
  const toolsView: ToolRegistryView = {
    listToolNames: () => ['read_file', 'run_shell_command', 'todo_pause'],
    getToolMetadata: (name) => ({
      name,
      description: `${name} description`,
      parameterSchema: { type: 'object', properties: {} },
    }),
  };
  const baseBundle = createStatelessRuntimeBundle({
    providerAdapter,
    toolRegistry,
    toolsView,
    history: new HistoryService(),
  });
  const hookConfig = createHookConfig(
    config,
    params.hookMode ?? { enabled: false },
  );
  const runtimeContext: AgentRuntimeContext = {
    ...baseBundle.runtimeContext,
    providerRuntime: {
      ...baseBundle.runtimeContext.providerRuntime,
      config: hookConfig,
    },
  };
  const runtimeBundle = { ...baseBundle, runtimeContext };
  const { overrides } = createRuntimeOverrides({ runtimeBundle, toolRegistry });
  const toolConfig = params.toolConfig
    ? { tools: [...params.toolConfig.tools] }
    : undefined;
  const scope = await SubAgentScope.create(
    'issue3526-agent',
    config,
    { systemPrompt: 'Complete the task and emit each required output.' },
    defaultModelConfig,
    defaultRunConfig,
    toolConfig,
    params.outputConfig === null
      ? undefined
      : (params.outputConfig ?? OUTPUT_CONFIG),
    overrides,
  );
  return { requests, scope };
}

const FOUR_VALUES = [
  ['alpha', 'A'],
  ['beta', 'B'],
  ['gamma', 'C'],
  ['delta', 'D'],
] as const;

describe('non-interactive scope-local output emitter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readTodos.mockResolvedValue([]);
  });

  it.each([
    [
      'no whitelist with hooks disabled',
      undefined,
      { enabled: false } as const,
    ],
    [
      'empty whitelist with hooks disabled',
      { tools: [] as const },
      { enabled: false } as const,
    ],
    [
      'hook without allowedFunctionNames',
      undefined,
      { enabled: true } as const,
    ],
  ])(
    'provides one correctly shaped emitter for %s',
    async (_name, toolConfig, hookMode) => {
      const harness = await createHarness({
        responses: [nativeEmissions(FOUR_VALUES), stopped()],
        toolConfig,
        hookMode,
      });

      await harness.scope.runNonInteractive(new ContextState());

      const emitters = declarationsFrom(harness.requests[0]).filter(
        (declaration) => declaration.name === 'self_emitvalue',
      );
      expect(emitters).toStrictEqual([
        expect.objectContaining({
          name: 'self_emitvalue',
          parametersJsonSchema: EXPECTED_EMIT_SCHEMA,
        }),
      ]);
    },
  );

  it.each([
    ['ordinary allowlist', ['read_file'] as const, ['read_file']],
    [
      'allowlist omitting emitter',
      ['run_shell_command'] as const,
      ['run_shell_command'],
    ],
    ['empty allowlist', [] as const, []],
  ])(
    'retains the emitter while filtering ordinary tools for %s',
    async (_name, allowedFunctionNames, expectedOrdinaryNames) => {
      const harness = await createHarness({
        responses: [nativeEmissions(FOUR_VALUES), stopped()],
        hookMode: { enabled: true, allowedFunctionNames },
      });

      await harness.scope.runNonInteractive(new ContextState());

      const names = declarationsFrom(harness.requests[0]).map(
        (declaration) => declaration.name,
      );
      expect(names.filter((name) => name === 'self_emitvalue')).toHaveLength(1);
      expect(names.filter((name) => name !== 'self_emitvalue')).toStrictEqual(
        expectedOrdinaryNames,
      );
    },
  );

  it('completes four native emissions with GOAL after one provider request', async () => {
    const harness = await createHarness({
      responses: [nativeEmissions(FOUR_VALUES)],
    });

    await harness.scope.runNonInteractive(new ContextState());

    expect(harness.scope.output.emitted_vars).toStrictEqual({
      alpha: 'A',
      beta: 'B',
      gamma: 'C',
      delta: 'D',
    });
    expect(harness.scope.output.terminate_reason).toBe(
      SubagentTerminateMode.GOAL,
    );
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests.map(requestText).join('\n')).not.toContain(
      'not emitted',
    );
  });

  it('completes four Hermes emissions with GOAL after one provider request', async () => {
    const harness = await createHarness({
      responses: [hermesEmissions(FOUR_VALUES)],
    });

    await harness.scope.runNonInteractive(new ContextState());

    expect(harness.scope.output.emitted_vars).toStrictEqual({
      alpha: 'A',
      beta: 'B',
      gamma: 'C',
      delta: 'D',
    });
    expect(harness.scope.output.terminate_reason).toBe(
      SubagentTerminateMode.GOAL,
    );
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests.map(requestText).join('\n')).not.toContain(
      'not emitted',
    );
  });

  it('terminates on the provider request containing the final partial emissions', async () => {
    const harness = await createHarness({
      responses: [
        nativeEmissions(FOUR_VALUES.slice(0, 2)),
        stopped('Waiting.'),
        nativeEmissions(FOUR_VALUES.slice(2)),
      ],
    });

    await harness.scope.runNonInteractive(new ContextState());

    const nudgeRequest = findMissingOutputNudge(harness.requests);
    expect(requestText(nudgeRequest)).toContain('gamma, delta');
    expect(requestText(nudgeRequest)).not.toContain('alpha, beta');
    expect(
      declarationsFrom(nudgeRequest).filter(
        (declaration) => declaration.name === 'self_emitvalue',
      ),
    ).toHaveLength(1);
    expect(
      harness.requests.map(
        (request) =>
          declarationsFrom(request).filter(
            (declaration) => declaration.name === 'self_emitvalue',
          ).length,
      ),
    ).toStrictEqual([1, 1, 1]);
    expect(harness.requests).toHaveLength(3);
    expect(harness.scope.output.terminate_reason).toBe(
      SubagentTerminateMode.GOAL,
    );
    expect(harness.scope.output.emitted_vars).toStrictEqual({
      alpha: 'A',
      beta: 'B',
      gamma: 'C',
      delta: 'D',
    });
  });

  it('stops immediately with ERROR after a successful case-insensitive todo_pause', async () => {
    const harness = await createHarness({
      responses: [
        {
          speaker: 'ai',
          blocks: [
            toolCall('TODO_PAUSE', { reason: 'blocked' }, 'pause-success'),
          ],
        },
      ],
    });

    mockSuccessfulPause('pause-success', 'TODO_PAUSE');

    await harness.scope.runNonInteractive(new ContextState());

    expect(harness.scope.output.terminate_reason).toBe(
      SubagentTerminateMode.ERROR,
    );
    expect(harness.scope.output.final_message).toContain(
      'todo_pause before completing required outputs: alpha, beta, gamma, delta',
    );
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests.map(requestText).join('\n')).not.toContain(
      'not emitted',
    );
  });

  it.each([
    ['no output configuration', null],
    ['an empty output map', { outputs: {} } satisfies OutputConfig],
  ])(
    'reports GOAL when successful todo_pause has %s',
    async (_name, outputConfig) => {
      const harness = await createHarness({
        responses: [
          {
            speaker: 'ai',
            blocks: [
              toolCall(
                'todo_pause',
                { reason: 'complete' },
                'pause-no-outputs',
              ),
            ],
          },
        ],
        outputConfig,
      });
      mockSuccessfulPause('pause-no-outputs');

      await harness.scope.runNonInteractive(new ContextState());

      expect(harness.scope.output.terminate_reason).toBe(
        SubagentTerminateMode.GOAL,
      );
      expect(harness.requests).toHaveLength(1);
    },
  );

  it('does not treat an inherited emitted_vars property as a completed output before todo_pause', async () => {
    const harness = await createHarness({
      responses: [
        {
          speaker: 'ai',
          blocks: [
            toolCall(
              'todo_pause',
              { reason: 'blocked' },
              'pause-inherited-key',
            ),
          ],
        },
      ],
      outputConfig: { outputs: { toString: 'required value' } },
    });
    mockSuccessfulPause('pause-inherited-key');

    await harness.scope.runNonInteractive(new ContextState());

    expect(harness.scope.output.terminate_reason).toBe(
      SubagentTerminateMode.ERROR,
    );
    expect(harness.scope.output.final_message).toContain('toString');
  });

  it('reports GOAL when successful todo_pause follows the final required emissions', async () => {
    const harness = await createHarness({
      responses: [
        {
          speaker: 'ai',
          blocks: [
            ...FOUR_VALUES.map(([name, value]) => emitCall(name, value)),
            toolCall('TODO_PAUSE', { reason: 'complete' }, 'pause-complete'),
          ],
        },
      ],
    });

    mockSuccessfulPause('pause-complete', 'TODO_PAUSE');

    await harness.scope.runNonInteractive(new ContextState());

    expect(harness.scope.output.emitted_vars).toStrictEqual({
      alpha: 'A',
      beta: 'B',
      gamma: 'C',
      delta: 'D',
    });
    expect(harness.scope.output.terminate_reason).toBe(
      SubagentTerminateMode.GOAL,
    );
    expect(harness.requests).toHaveLength(1);
  });

  it('does not count shell output as declared output emission', async () => {
    const harness = await createHarness({
      responses: [
        {
          speaker: 'ai',
          blocks: [
            toolCall(
              'run_shell_command',
              { command: 'printf "alpha=A beta=B gamma=C delta=D"' },
              'shell-output',
            ),
          ],
        },
        stopped('Shell command completed.'),
        nativeEmissions(FOUR_VALUES),
        stopped(),
      ],
    });
    mockCompletedToolCall(
      createCompletedToolCallResponse({
        callId: 'shell-output',
        responseParts: [
          { type: 'text', text: 'alpha=A beta=B gamma=C delta=D' },
        ],
      }),
    );

    await harness.scope.runNonInteractive(new ContextState());

    expect(requestText(findMissingOutputNudge(harness.requests))).toContain(
      'alpha, beta, gamma, delta',
    );
    expect(harness.scope.output.terminate_reason).toBe(
      SubagentTerminateMode.GOAL,
    );
    expect(harness.scope.output.emitted_vars).toStrictEqual({
      alpha: 'A',
      beta: 'B',
      gamma: 'C',
      delta: 'D',
    });
  });

  it('returns a cancelled todo_pause result to the model and continues', async () => {
    const harness = await createHarness({
      responses: [
        {
          speaker: 'ai',
          blocks: [toolCall('todo_pause', {}, 'pause-cancelled')],
        },
        nativeEmissions(FOUR_VALUES),
      ],
    });
    mockCancelledPause('pause-cancelled');

    await harness.scope.runNonInteractive(new ContextState());

    expect(requestText(harness.requests[1])).toContain('cancelled');
    expect(harness.requests).toHaveLength(2);
    expect(harness.scope.output.terminate_reason).toBe(
      SubagentTerminateMode.GOAL,
    );
    expect(harness.scope.output.emitted_vars).toStrictEqual({
      alpha: 'A',
      beta: 'B',
      gamma: 'C',
      delta: 'D',
    });
  });

  it.each([
    ['failed', 'pause rejected', new Error('pause rejected'), undefined],
    [
      'malformed',
      'reason is required',
      undefined,
      ToolErrorType.INVALID_TOOL_PARAMS,
    ],
  ])(
    'returns a %s todo_pause failure to the model and continues',
    async (_name, errorMessage, error, errorType) => {
      const harness = await createHarness({
        responses: [
          {
            speaker: 'ai',
            blocks: [toolCall('todo_pause', {}, 'pause-failure')],
          },
          nativeEmissions(FOUR_VALUES),
          stopped(),
        ],
      });
      mockCompletedToolCall(
        createCompletedToolCallResponse({
          callId: 'pause-failure',
          responseParts: [
            {
              type: 'tool_response',
              callId: 'pause-failure',
              toolName: 'todo_pause',
              result: { error: errorMessage },
              error: errorMessage,
            },
          ],
          error,
          errorType,
        }),
      );

      await harness.scope.runNonInteractive(new ContextState());

      expect(requestText(harness.requests[1])).toContain(errorMessage);
      expect(harness.scope.output.terminate_reason).toBe(
        SubagentTerminateMode.GOAL,
      );
      expect(harness.scope.output.emitted_vars).toStrictEqual({
        alpha: 'A',
        beta: 'B',
        gamma: 'C',
        delta: 'D',
      });
    },
  );
});
