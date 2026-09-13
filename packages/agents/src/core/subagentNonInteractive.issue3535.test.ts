/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3535 — a subagent whose tool dispatch hits a fatal tool error
 * (TOOL_DISABLED / TOOL_NOT_REGISTERED) must terminate with ERROR when no
 * later tool execution succeeded, and with GOAL when it recovered.
 *
 * Non-interactive cases use the same direct-runtime harness as issue #3540
 * (real GemmaToolCallParser, real scheduler via createMockConfig, real
 * dispatch) so a native tool_call with an unknown/absent name flows through
 * the real scheduler → ToolDispatcher → TOOL_NOT_REGISTERED path and back.
 *
 * Interactive cases drive the real SubAgentScope interactive loop with a
 * real CoreToolScheduler (same session config as the direct harness) plus a
 * scripted provider. The provider also records every request's content,
 * which is how the structured tool_response pairing is verified.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import {
  getOrCreateScheduler,
  disposeScheduler,
} from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import {
  BaseTool,
  Kind,
  type ToolResult,
} from '@vybestack/llxprt-code-tools/tools/tools.js';

import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';

class RuntimeDisabledTool extends BaseTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor() {
    super(
      'runtime_disabled',
      'Runtime disabled',
      'Unavailable image backend',
      Kind.Think,
      {
        type: 'object',
        properties: {},
      },
    );
  }

  override getDescription(): string {
    return 'Unavailable image backend';
  }

  override async execute(): Promise<ToolResult> {
    return {
      llmContent: 'Image backend unavailable',
      returnDisplay: 'Image backend unavailable',
      error: {
        type: ToolErrorType.TOOL_DISABLED,
        message: 'Image backend unavailable',
      },
    };
  }
}

class UppercaseTool extends BaseTool<{ text: string }, ToolResult> {
  constructor() {
    super('uppercase', 'Uppercase', 'Uppercase text', Kind.Think, {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    });
  }

  override getDescription(): string {
    return 'Uppercase text';
  }

  override async execute(params: { text: string }): Promise<ToolResult> {
    return {
      llmContent: params.text.toUpperCase(),
      returnDisplay: params.text.toUpperCase(),
    };
  }
}
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeModel } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeModel.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { AgentRuntimeProviderAdapter } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  ContextState,
  SubagentTerminateMode,
  type OutputConfig,
  type OutputObject,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { ChatSession, StreamEventType } from './chatSession.js';
import { executeNonInteractiveRun } from './subagentNonInteractive.js';
import type { ExecutionLoopContext } from './subagentExecution.js';
import {
  getScopeLocalFuncDefs,
  createToolExecutionConfig,
} from './subagentRuntimeSetup.js';
import { CoreToolScheduler } from './coreToolScheduler.js';
import { SubAgentScope } from './subagent.js';
import { classifyToolCompletions } from './subagentToolProcessing.js';
import {
  createStatelessRuntimeBundle,
  defaultModelConfig,
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

// Issue #3535: each run needs a FRESH session. The scheduler singleton keys its
// entries by sessionId and tracks seenCallIds per session, so reusing a fixed id
// lets state leak between tests and masks the missing onAllToolCallsComplete wiring.
let sessionCounter = 0;
let lastSessionId = '';

function createEmptyRegistryConfig(): Config {
  const policyEngine = new PolicyEngine({});
  policyEngine.setApprovalMode(ApprovalMode.YOLO);
  const messageBus = new MessageBus(policyEngine, false);
  const messageBusAdapter = new CoreMessageBusAdapter(messageBus);
  const toolRegistry = new ToolRegistry(
    {
      getEphemeralSettings: () => ({}),
      getCoreTools: () => [],
      getExcludeTools: () => [],
    },
    messageBusAdapter,
  );
  const sessionId = `issue-3535-session-${sessionCounter++}`;
  lastSessionId = sessionId;
  const fixture = {
    getSessionId: () => sessionId,
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    getApprovalMode: () => ApprovalMode.YOLO,
    getEphemeralSettings: () => ({}),
    getEphemeralSetting: () => undefined,
    getAllowedTools: () => [],
    getExcludeTools: () => [],
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    getModel: () => 'test-model',
    getToolRegistry: () => toolRegistry,
    getMessageBus: () => messageBus,
    getPolicyEngine: () => policyEngine,
    getTelemetryLogPromptsEnabled: () => false,
    getImagePayloadBudgetBytes: () => 50_000,
    isInteractive: () => false,
    // Prompt-assembly path (createChatObject → buildSystemInstruction →
    // resolvePromptMemory). JIT is disabled, so user memory is the empty
    // fixture and the JIT lookup short-circuits.
    isJitContextEnabled: () => false,
    getUserMemory: () => undefined,
    getGlobalMemory: () => undefined,
    getCoreMemory: () => undefined,
    getJitMemoryForPath: async () => undefined,
    getMcpInstructions: () => undefined,
    getWorkingDir: () => process.cwd(),
    // Forward the options object verbatim, mirroring production
    // (packages/agents/src/api/runtimeFactories.ts). The factory previously
    // cherry-picked constructor args and DROPPED onAllToolCallsComplete /
    // onToolCallsUpdate / outputUpdateHandler, so a scheduler born in a fresh
    // session never fired onAllToolCallsComplete (test deadlock, issue #3535).
    getToolSchedulerFactory:
      () => (options: ConstructorParameters<typeof CoreToolScheduler>[0]) =>
        new CoreToolScheduler(options),
    getOrCreateScheduler: (
      _sessionId: string,
      callbacks: Parameters<Config['getOrCreateScheduler']>[1],
      schedulerOptions: Parameters<Config['getOrCreateScheduler']>[2],
      deps: Parameters<Config['getOrCreateScheduler']>[3],
    ) => {
      const schedulerMessageBus = deps?.messageBus;
      if (!schedulerMessageBus) {
        throw new Error(
          'test config requires an explicit scheduler MessageBus',
        );
      }
      return getOrCreateScheduler(
        fixture as unknown as Config,
        _sessionId,
        callbacks,
        schedulerOptions,
        {
          messageBus: schedulerMessageBus,
          toolRegistry: deps.toolRegistry ?? toolRegistry,
        },
      );
    },
    disposeScheduler: (sessionId: string) => disposeScheduler(sessionId),
  };
  return fixture as unknown as Config;
}

function disposeLastScheduler(): void {
  if (lastSessionId) {
    disposeScheduler(lastSessionId);
    lastSessionId = '';
  }
}

function toolCallBlock(
  name: string | undefined,
  args: Readonly<Record<string, unknown>> = {},
  id = name ?? 'call-unnamed',
): IContent {
  // Issue #3535: an ABSENT name is the doomed native tool_call. The block's
  // `name` is typed `string`, but the semantic absent-name is what the issue is
  // about, so build through a plain-object facade.
  const block = {
    type: 'tool_call' as const,
    id,
    parameters: args,
    ...(name === undefined ? {} : { name }),
  } as unknown as ContentBlock;
  return { speaker: 'ai', blocks: [block] };
}

function emitCall(name: string, value: string): IContent {
  return toolCallBlock(
    'self_emitvalue',
    { emit_variable_name: name, emit_variable_value: value },
    `emit-${name}`,
  );
}

function stopped(): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text: 'Done.' }] };
}

async function runDirectNonInteractive(
  responses: readonly IContent[],
  options: { outputConfig?: OutputConfig } = { outputConfig: OUTPUT_CONFIG },
): Promise<{
  readonly output: OutputObject;
  readonly requestCount: number;
  readonly requestContents: readonly IContent[][];
}> {
  const config = createEmptyRegistryConfig();
  const baseBundle = createStatelessRuntimeBundle();
  const output: OutputObject = {
    terminate_reason: SubagentTerminateMode.ERROR,
    emitted_vars: {},
  };
  const logger = new DebugLogger('issue3535-test');
  const execCtx: ExecutionLoopContext = {
    output,
    subagentId: 'direct-issue3535-agent',
    runConfig: defaultRunConfig,
    outputConfig: options.outputConfig,
    textToolParser: new GemmaToolCallParser(),
    toolsView: baseBundle.runtimeContext.tools,
    logger,
  };
  let requestCount = 0;
  const requestContents: IContent[][] = [];
  const chat = {
    // `message` is the block list of the turn being sent (the non-interactive
    // runner passes currentMessages[0].blocks, which may be empty).
    sendMessageStream: async (params: {
      message: readonly ContentBlock[] | undefined;
    }) => {
      const response = responses[requestCount] ?? stopped();
      // Capture the content of THIS request (the tool message from the
      // previous dispatch travels in here). Wrap the block list as a single
      // tool-speaker turn so the paired tool_response is searchable.
      if (params.message && params.message.length > 0) {
        requestContents.push([
          { speaker: 'tool', blocks: [...params.message] },
        ]);
      }
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
    [...getScopeLocalFuncDefs(options.outputConfig)],
    new AbortController(),
    [{ speaker: 'human', blocks: [{ type: 'text', text: 'start' }] }],
    Date.now(),
    execCtx,
    {
      output,
      subagentId: 'direct-issue3535-agent',
      name: 'direct-issue3535-agent',
      runtimeContext: baseBundle.runtimeContext,
      logger,
      config,
      runConfig: defaultRunConfig,
      outputConfig: options.outputConfig,
      toolExecutorContext: config,
      messageBus: (
        config as unknown as { getMessageBus: () => MessageBus }
      ).getMessageBus(),
    },
    () => undefined,
  );

  return { output, requestCount, requestContents };
}

// ---------------------------------------------------------------------------
// Interactive harness: real SubAgentScope interactive loop, real CoreToolScheduler
// ---------------------------------------------------------------------------

function runtimeProviderFor(
  responses: readonly IContent[],
  requests: RuntimeGenerateChatOptions[],
): RuntimeProvider {
  let index = 0;
  return {
    name: 'issue3535-scripted',
    getModels: async (): Promise<RuntimeModel[]> => [],
    getDefaultModel: () => defaultModelConfig.model,
    generateChatCompletion: (
      input: unknown,
    ): AsyncIterableIterator<IContent> => {
      if (Array.isArray(input)) {
        throw new Error('Expected request options from the runtime.');
      }
      const options = input as RuntimeGenerateChatOptions;
      requests.push(options);
      const response = responses[index] ?? stopped();
      index += 1;
      // The stream validator requires a finishReason on the model output;
      // a tool_call turn ends with 'tool_calls', a plain stop with 'stop'.
      const blocks = response.blocks;
      const hasToolCall = blocks.some(
        (block): block is Extract<ContentBlock, { type: 'tool_call' }> =>
          block.type === 'tool_call',
      );
      return (async function* () {
        yield {
          ...response,
          finishReason: hasToolCall ? 'tool_calls' : 'stop',
        };
      })();
    },
  } as RuntimeProvider;
}

function findToolResponsesByCallId(
  contents: readonly IContent[],
  callId: string,
): ContentBlock[] {
  return contents
    .flatMap((content) => content.blocks)
    .filter(
      (block) => block.type === 'tool_response' && block.callId === callId,
    );
}

async function runInteractiveDirect(responses: readonly IContent[]): Promise<{
  readonly output: OutputObject;
  readonly requestContents: readonly IContent[][];
}> {
  const config = createEmptyRegistryConfig();
  config.getToolRegistry().registerTool(new UppercaseTool());
  config.getToolRegistry().registerTool(new RuntimeDisabledTool());
  const requests: RuntimeGenerateChatOptions[] = [];
  const provider = runtimeProviderFor(responses, requests);
  // The ChatSession resolves its provider via adapter.getActiveProvider()
  // (see subagent.aggregate-output-budget.test.ts): the adapter method must
  // itself return a zero-arg fn that hands back the provider, and the name
  // must match the runtime state provider so no provider switch is forced.
  const providerAdapter = {
    getActiveProvider: vi.fn(() => provider),
    getProviderByName: vi.fn(() => provider),
    setActiveProvider: vi.fn(),
  } as unknown as AgentRuntimeProviderAdapter;
  // The interactive path builds a REAL ChatSession (createChatObject), whose
  // SemanticMediaPurgeCoordinator reads history.getAll at construction, so
  // the bundle carries a real HistoryService here (the non-interactive direct
  // harness fakes the chat and keeps the mock history). Pass providerAdapter
  // as a bundle option so runtimeContext.provider is the scripted provider —
  // spreading it after construction would leave runtimeContext with the
  // default adapter, which yields an empty blocks[] IContent.
  const bundle = createStatelessRuntimeBundle({
    history: new HistoryService(),
    providerAdapter,
  });
  const toolRegistry = config.getToolRegistry();
  const toolExecutorContext = createToolExecutionConfig(
    bundle,
    toolRegistry,
    config,
    (config as unknown as { getMessageBus: () => MessageBus }).getMessageBus(),
  );
  const scope = new (SubAgentScope as unknown as new (
    ...args: unknown[]
  ) => SubAgentScope)(
    'interactive-issue3535-agent',
    bundle.runtimeContext,
    defaultModelConfig,
    defaultRunConfig,
    { systemPrompt: 'Do the task.' },
    undefined,
    toolExecutorContext,
    async () => [],
    config,
    (config as unknown as { getMessageBus: () => MessageBus }).getMessageBus(),
    undefined,
    OUTPUT_CONFIG,
    undefined,
    undefined,
    {},
  );
  await scope.runInteractive(new ContextState());
  return {
    output: scope.output,
    requestContents: requests.map((r) => r.contents),
  };
}

describe('issue 3535 fatal-tool-error termination semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readTodos.mockResolvedValue([]);
  });

  afterEach(() => {
    // Issue #3535: drop the scheduler singleton entry for this run so a fresh
    // session never inherits stale callbacks or seenCallIds.
    disposeLastScheduler();
  });

  it('skips unresolved scheduler IDs without inventing recovery', () => {
    expect(
      classifyToolCompletions([{ callId: 'previously-seen' }], []),
    ).toStrictEqual({
      recovered: false,
      fatalCall: undefined,
    });
    expect(
      classifyToolCompletions(
        [
          { callId: 'previously-seen' },
          { status: 'success' },
          { callId: 'also-seen' },
        ],
        [],
      ),
    ).toStrictEqual({ recovered: true, fatalCall: undefined });
  });

  it('recovers after a deduplicated fatal pair followed by a distinct successful call', async () => {
    const { output, requestContents } = await runInteractiveDirect([
      {
        speaker: 'ai',
        blocks: [
          ...toolCallBlock('', {}, 'duplicate-fatal').blocks,
          ...toolCallBlock('', {}, 'duplicate-fatal').blocks,
          ...toolCallBlock(
            'uppercase',
            { text: 'recovered' },
            'distinct-success',
          ).blocks,
        ],
      },
      emitCall('alpha', 'A'),
      emitCall('beta', 'B'),
    ]);

    expect(
      findToolResponsesByCallId(requestContents[1], 'duplicate-fatal'),
    ).toHaveLength(1);
    expect(
      findToolResponsesByCallId(requestContents[1], 'distinct-success'),
    ).toMatchObject([
      { type: 'tool_response', result: { output: 'RECOVERED' } },
    ]);
    expect(output.unrecovered_fatal_tool_error).toBeUndefined();
    expect(output.emitted_vars).toStrictEqual({ alpha: 'A', beta: 'B' });
    expect(output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
  });

  it('preserves an earlier interactive fatal across a batch of only non-fatal failures', async () => {
    const { output } = await runInteractiveDirect([
      toolCallBlock('', {}, 'earlier-fatal'),
      {
        speaker: 'ai',
        blocks: [
          ...toolCallBlock('uppercase', {}, 'invalid-uppercase').blocks,
          ...toolCallBlock('self_emitvalue', { emit_variable_name: 'alpha' })
            .blocks,
        ],
      },
      stopped(),
    ]);

    expect(output.unrecovered_fatal_tool_error).toContain('is not available');
    expect(output.emitted_vars).toStrictEqual({});
    expect(output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
  });

  it('preserves a fatal after a scheduled success in request order', async () => {
    const { output, requestContents } = await runInteractiveDirect([
      {
        speaker: 'ai',
        blocks: [
          ...toolCallBlock('uppercase', { text: 'recovered' }, 'valid-mixed')
            .blocks,
          ...toolCallBlock('', {}, 'fatal-mixed').blocks,
        ],
      },
      stopped(),
    ]);

    expect(
      findToolResponsesByCallId(requestContents[1], 'valid-mixed'),
    ).toMatchObject([
      { type: 'tool_response', result: { output: 'RECOVERED' } },
    ]);
    expect(output.emitted_vars).toStrictEqual({});
    expect(output.unrecovered_fatal_tool_error).toContain('is not available');
    expect(output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
  });

  it('recovers when a scheduled success follows a fatal in request order', async () => {
    const { output } = await runInteractiveDirect([
      {
        speaker: 'ai',
        blocks: [
          ...toolCallBlock('', {}, 'fatal-first').blocks,
          ...toolCallBlock('uppercase', { text: 'recovered' }, 'valid-last')
            .blocks,
        ],
      },
      stopped(),
    ]);

    expect(output.unrecovered_fatal_tool_error).toBeUndefined();
  });

  it('recovers when a manual emit follows a scheduler fatal in request order', async () => {
    const { output } = await runInteractiveDirect([
      {
        speaker: 'ai',
        blocks: [
          ...toolCallBlock('', {}, 'fatal-before-emit').blocks,
          ...emitCall('alpha', 'A').blocks,
        ],
      },
      stopped(),
    ]);

    expect(output.emitted_vars).toStrictEqual({ alpha: 'A' });
    expect(output.unrecovered_fatal_tool_error).toBeUndefined();
  });

  it('preserves a runtime availability fatal after a successful scheduled call', async () => {
    const { output } = await runInteractiveDirect([
      {
        speaker: 'ai',
        blocks: [
          ...toolCallBlock(
            'uppercase',
            { text: 'ok' },
            'success-before-runtime',
          ).blocks,
          ...toolCallBlock('runtime_disabled', {}, 'runtime-fatal').blocks,
        ],
      },
      stopped(),
    ]);

    expect(output.unrecovered_fatal_tool_error).toContain(
      'Image backend unavailable',
    );
    expect(output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
  });

  it('recovers to GOAL after an emit and plain stop without declared outputs', async () => {
    const { output } = await runDirectNonInteractive(
      [toolCallBlock(''), emitCall('alpha', 'A'), stopped()],
      {},
    );

    expect(output.emitted_vars).toStrictEqual({ alpha: 'A' });
    expect(output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
    expect(output.unrecovered_fatal_tool_error).toBeUndefined();
  });

  it('ends ERROR when the first and only tool call has an empty name', async () => {
    const { output } = await runDirectNonInteractive([
      toolCallBlock(''),
      stopped(),
    ]);

    expect(output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    expect(output.final_message).toContain('is not available');
    expect(output.final_message).toContain('could not be loaded');
  });

  it('ends ERROR with the raw garbage name when the tool name cannot be normalized', async () => {
    const garbage = 'not a tool!!';
    const { output } = await runDirectNonInteractive([
      toolCallBlock(garbage),
      stopped(),
    ]);

    expect(output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    expect(output.final_message).toContain('is not available');
    expect(output.final_message).toContain(garbage);
  });

  it('keeps ERROR when a failed non-fatal call follows the fatal call', async () => {
    // Finding 1: a self_emitvalue call with a missing argument is a non-fatal
    // INVALID_TOOL_PARAMS failure, not a recovery. The fatal flag must survive.
    const { output } = await runDirectNonInteractive([
      toolCallBlock(''),
      toolCallBlock('self_emitvalue', {
        emit_variable_name: 'alpha',
      }),
      stopped(),
    ]);

    expect(output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    expect(output.final_message).toContain('is not available');
    expect(output.final_message).toContain('could not be loaded');
  });

  it('recovers to GOAL when all declared outputs are emitted after a fatal empty-name call', async () => {
    const { output } = await runDirectNonInteractive([
      toolCallBlock(''),
      emitCall('alpha', 'A'),
      emitCall('beta', 'B'),
    ]);

    expect(output.emitted_vars).toStrictEqual({ alpha: 'A', beta: 'B' });
    expect(output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
    // Finding 5: the GOAL site clears the flag explicitly, so the output
    // object is consistent with a recovered run.
    expect(output.unrecovered_fatal_tool_error).toBeUndefined();
  });

  it('ends ERROR when a fatal call is followed by a second fatal call', async () => {
    const { output } = await runDirectNonInteractive([
      toolCallBlock(''),
      toolCallBlock('also_missing_tool'),
      stopped(),
    ]);

    expect(output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    expect(output.final_message).toContain('is not available');
  });

  it('clears the flag when a successful call follows the fatal one in the same batch', async () => {
    // Finding 4: batch order is [fatal, success]. A success after the last
    // fatal proves recovery, so the stop must end GOAL, not ERROR.
    const { output } = await runDirectNonInteractive([
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call' as const,
            id: 'fatal-mixed',
            name: '',
            parameters: {},
          } as unknown as ContentBlock,
          emitCall('alpha', 'A').blocks[0],
          emitCall('beta', 'B').blocks[0],
        ],
      },
    ]);

    expect(output.emitted_vars).toStrictEqual({ alpha: 'A', beta: 'B' });
    expect(output.unrecovered_fatal_tool_error).toBeUndefined();
    expect(output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
  });

  it('carries a tool_response paired to the doomed call in the follow-up request', async () => {
    // AC1: the fatal dispatch must produce a proper tool_response. The
    // dispatcher's structured response block (pairing the doomed call's
    // callId) must reach the next provider request, not just the fatal text.
    const doomedCallId = 'doomed-call-1';
    const { output, requestContents } = await runDirectNonInteractive([
      toolCallBlock('', {}, doomedCallId),
      stopped(),
    ]);

    expect(output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    expect(requestContents.length).toBeGreaterThanOrEqual(2);
    const paired = findToolResponsesByCallId(requestContents[1], doomedCallId);
    expect(paired).toHaveLength(1);
  });

  it('ends ERROR when an interactive run hits a fatal call and then stops with plain text', async () => {
    // Finding 2: the model's plain stop text ("Done.") overwrote final_message
    // in the interactive path, destroying the malformed-call diagnostic.
    const { output, requestContents } = await runInteractiveDirect([
      toolCallBlock('', {}, 'interactive-doomed-1'),
      stopped(),
    ]);

    expect(output.terminate_reason).toBe(SubagentTerminateMode.ERROR);
    expect(output.final_message).toContain('is not available');
    expect(output.final_message).toContain('could not be loaded');
    expect(output.final_message).not.toBe('Done.');
    // The interactive follow-up request also carries the paired tool_response.
    const paired = findToolResponsesByCallId(
      requestContents[1],
      'interactive-doomed-1',
    );
    expect(paired).toHaveLength(1);
  });

  it('ends GOAL with the diagnostic restored when a fatal call is followed by a successful call and a stop', async () => {
    // Interactive path: fatal, then a real successful dispatch, then plain-text
    // stop. The flag is cleared by the success, so the run ends GOAL.
    const { output } = await runInteractiveDirect([
      toolCallBlock('', {}, 'mixed-interactive-fatal'),
      toolCallBlock('self_emitvalue', {
        emit_variable_name: 'alpha',
        emit_variable_value: 'A',
      }),
      toolCallBlock('self_emitvalue', {
        emit_variable_name: 'beta',
        emit_variable_value: 'B',
      }),
    ]);

    expect(output.emitted_vars).toStrictEqual({ alpha: 'A', beta: 'B' });
    expect(output.unrecovered_fatal_tool_error).toBeUndefined();
    expect(output.terminate_reason).toBe(SubagentTerminateMode.GOAL);
  });
});
