/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IContent,
  ContentBlock,
  AgentRequestInput,
} from '@vybestack/llxprt-code-core';
/**
 * Integration tests for useAgentEventStream that drive the REAL engine
 * (createAgenticLoop + mapLoopStream) through the hook. The only mock boundary
 * is the provider stream (a scripted AgentClientContract whose
 * sendMessageStream yields canned ServerAgentStreamEvents) and the tool
 * implementations (real MockTool infra). This mirrors mocking the LLM provider,
 * which is infrastructure.
 *
 * The fake Agent below (createRealEngineAgent) is a hand-built stub that runs
 * the REAL AgenticLoop + mapLoopStream per stream() call over a scripted
 * client, approximating AgentImpl.stream's composition while bypassing
 * fromConfig / AgentImpl construction. The public Agent facade's own behavior
 * (stale-client guard, ToolControl notify taps) is covered by packages/agents
 * tests, not here.
 *
 * These tests verify the acceptance criteria of issue #2372:
 *  (i)   streaming a multi-turn tool-call conversation through the hook,
 *  (ii)  cancellation mid-stream,
 *  (iii) approval flow via the production confirmationDetails.onConfirm path
 *        (approve via ProceedOnce AND reject via Cancel), NOT via an
 *        approvalHandler — production never wires one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { act } from 'react';
import {
  createAgenticLoop,
  createToolScheduler,
  mapLoopStream,
  type AgentEvent,
  type Agent,
  type AgentInput,
  type DisplayCallbacks,
  type AgentClientContract,
} from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  AgentEventType,
  type ServerAgentStreamEvent,
} from '@vybestack/llxprt-code-core/core/turn.js';
import type {
  CompletedToolCall,
  ToolCall,
  WaitingToolCall,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  getOrCreateScheduler,
  disposeScheduler,
  clearAllSchedulers,
} from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  ToolRegistry,
  ToolCallConfirmationDetails,
} from '@vybestack/llxprt-code-tools';
import type { AgentEventRouter } from '../useAgentEventStream.js';
import { useAgentEventStream } from '../useAgentEventStream.js';
import {
  toolCallRequestEvent,
  contentEvent,
  finishedEvent,
  agentRequestInputToIContent,
  agentRequestInputToBlocks,
  type ScriptedClientState,
} from './loopTestHelpers.js';

function createScriptedAgentClient(scripts: ServerAgentStreamEvent[][]): {
  client: AgentClientContract;
  state: ScriptedClientState;
} {
  const state: ScriptedClientState = {
    scriptQueue: [...scripts],
    history: [],
    turnMessages: [],
    recordedToolCalls: [],
    sendMessageStreamCalls: [],
  };

  const chat = {
    async *sendMessageStream() {},
    getHistory() {
      return state.history;
    },
    setHistory(h: IContent[]) {
      state.history.splice(0, state.history.length, ...h);
    },
    clearHistory() {
      state.history.splice(0, state.history.length);
    },
    getHistoryService: () => null,
    wasRecentlyCompressed: () => false,
    performCompression: async () =>
      'compressed' as Parameters<
        ReturnType<AgentClientContract['getChat']>['performCompression']
      >[0],
    recordCompletedToolCalls: (
      _model: string,
      completed: CompletedToolCall[],
    ) => {
      state.recordedToolCalls.push([...completed]);
    },
  } as unknown as ReturnType<AgentClientContract['getChat']>;

  const client: AgentClientContract = {
    ...createClientBase(),
    getChat() {
      return chat;
    },
    async getHistory() {
      return state.history;
    },
    storeHistoryServiceForReuse: () => {},
    storeHistoryForLaterUse: (h: IContent[]) => state.history.push(...h),
    addHistory: async (content: IContent) => {
      state.history.push(content);
    },
    async *sendMessageStream(
      req: AgentRequestInput,
      signal: AbortSignal,
      _promptId: string,
    ): AsyncGenerator<ServerAgentStreamEvent> {
      state.sendMessageStreamCalls.push(req);
      state.turnMessages.push(req);
      state.history.push(agentRequestInputToIContent(req));
      const script = state.scriptQueue.shift();
      if (script === undefined) return;
      for (const event of script) {
        if (signal.aborted) return;
        yield event;
      }
    },
  };

  return { client, state };
}

// ─── Config / ToolRegistry / PolicyEngine fixtures ─────────────────────────
// These replicate the minimal fixtures from packages/agents test helpers
// (agenticLoop-test-helpers.ts), which are not publicly exported. We build
// real, correctly-typed lambdas for every Config method the loop calls.

function createTestConfig(options: {
  messageBus: MessageBus;
  toolRegistry: ToolRegistry;
  policyEngine: PolicyEngine;
  interactive: boolean;
  approvalMode?: ApprovalMode;
}): Config {
  const { messageBus, toolRegistry, policyEngine, interactive } = options;
  const approvalMode = options.approvalMode ?? ApprovalMode.YOLO;
  const fixture: Record<string, unknown> = {
    getSessionId: () => 'loop-integration-test',
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    getApprovalMode: () => approvalMode,
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
    isInteractive: () => interactive,
    getNonInteractive: () => !interactive,
    getToolSchedulerFactory: () => createToolScheduler,
    getOrCreateScheduler: (
      sessionId: string,
      callbacks: Parameters<Config['getOrCreateScheduler']>[1],
      schedulerOptions: Parameters<Config['getOrCreateScheduler']>[2],
      deps: Parameters<Config['getOrCreateScheduler']>[3],
    ) => {
      const schedulerMessageBus = deps?.messageBus;
      if (!schedulerMessageBus)
        throw new Error('Test config requires deps.messageBus');
      return getOrCreateScheduler(
        fixture as unknown as Config,
        sessionId,
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

function createToolRegistryForTest(tools: MockTool[]): ToolRegistry {
  const toolMap = new Map<string, MockTool>();
  for (const tool of tools) toolMap.set(tool.name, tool);
  return {
    getToolByName: (name: string) => toolMap.get(name) ?? null,
    getTool: (name: string) => toolMap.get(name) ?? null,
    getFunctionDeclarations: () => [],
    getTools: () => tools,
    discoverTools: async () => {},
    getAllTools: () => tools,
    getAllToolNames: () => tools.map((t) => t.name),
    getToolsByServer: () => [],
    registerTool: () => {},
    getToolByDisplayName: () => null,
    tools: toolMap,
    discovery: {},
  } as unknown as ToolRegistry;
}

function createAllowPolicyEngine(): PolicyEngine {
  return new PolicyEngine({
    rules: [],
    defaultDecision: PolicyDecision.ALLOW,
    nonInteractive: false,
  });
}

function createAskPolicyEngine(): PolicyEngine {
  return new PolicyEngine({
    rules: [],
    defaultDecision: PolicyDecision.ASK_USER,
    nonInteractive: false,
  });
}

// ─── Hand-built fake Agent wrapping the REAL engine ───────────────────────

interface RealEngineAgentOptions {
  agentClient: AgentClientContract;
  config: Config;
  messageBus: MessageBus;
  interactiveMode?: boolean;
  displayCallbacks?: DisplayCallbacks;
  /** Recorded display-callback holders (for test inspection + unmount tests). */
  displayCallbacksHolder?: { current: DisplayCallbacks };
  editorCallbacksHolder?: { current: Record<string, unknown> };
}

function createRealEngineAgent(opts: RealEngineAgentOptions): Agent {
  const displayCallbacksHolder =
    opts.displayCallbacksHolder ??
    ({ current: {} } as { current: DisplayCallbacks });
  const editorCallbacksHolder =
    opts.editorCallbacksHolder ??
    ({ current: {} } as { current: Record<string, unknown> });
  const agent = {
    async chat() {
      return { text: '', toolCalls: [], finishReason: 'stop' };
    },
    async *stream(
      input: AgentInput,
      streamOpts?: {
        readonly signal?: AbortSignal;
        readonly promptId?: string;
      },
    ): AsyncIterable<AgentEvent> {
      const loop = createAgenticLoop({
        agentClient: opts.agentClient,
        config: opts.config,
        messageBus: opts.messageBus,
        interactiveMode: opts.interactiveMode ?? true,
        displayCallbacks: displayCallbacksHolder.current,
      });
      yield* mapLoopStream(
        loop.run(
          input as never,
          streamOpts?.signal ?? new AbortController().signal,
          streamOpts?.promptId ?? 'test',
        ),
      );
    },
    getProvider: () => 'test',
    async setProvider() {
      return {
        changed: false,
        previousProvider: 'test',
        nextProvider: 'test',
        infoMessages: [],
      };
    },
    getProviderStatus: () => ({
      provider: 'test',
      model: 'test-model',
      authStatus: 'authenticated',
    }),
    getModel: () => 'test-model',
    async setModel() {},
    getCurrentSequenceModel: () => null,
    getApprovalMode: () => ApprovalMode.DEFAULT,
    setApprovalMode: () => {},
    getRuntimeId: () => 'loop-integration-agent',
    getEphemeralSetting: () => undefined,
    setEphemeralSetting: () => {},
    getEphemeralSettings: () => ({}),
    getModelParams: () => ({}),
    setModelParam: () => {},
    clearModelParam: () => {},
    getUserTier: () => undefined,
    tools: {
      list: () => [],
      get: () => undefined,
      async setEnabled() {},
      onConfirmationRequest: () => () => {},
      respondToConfirmation: () => {},
      onToolUpdate: () => () => {},
      setEditorCallbacks: (cbs: Record<string, unknown>) => {
        editorCallbacksHolder.current = cbs;
      },
      setDisplayCallbacks: (cbs: DisplayCallbacks) => {
        displayCallbacksHolder.current = cbs;
      },
      recordCompletedToolCalls: () => {},
    },
    async getHistory() {
      return [];
    },
    async setHistory() {},
    async addHistory() {},
    async restoreHistory() {},
    async resetChat() {},
    async updateSystemInstruction() {},
    async addDirectoryContext() {},
    async compress() {
      return { status: 'skipped' };
    },
    getStats: () => ({
      promptTokens: 0,
      candidateTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      contextWindowSize: 0,
      contextWindowUsed: 0,
      turnCount: 0,
    }),
    onStats: () => () => {},
    async generate() {
      return '';
    },
    async generateJson() {
      return {};
    },
    async generateEmbedding() {
      return [];
    },
    listProviders: () => [],
    listTools: () => [],
    async dispose() {},
  } as unknown as Agent;
  return agent;
}

function unused(): never {
  throw new Error('not used');
}

function createClientBase(): AgentClientContract {
  return {
    async initialize() {},
    isInitialized: () => true,
    hasChatInitialized: () => true,
    getChat: () => {
      throw new Error('override getChat');
    },
    async getHistory() {
      return [];
    },
    getHistoryService: () => null,
    storeHistoryServiceForReuse: () => {},
    storeHistoryForLaterUse: () => {},
    dispose: () => {},
    setTools: async () => {},
    clearTools: () => {},
    updateSystemInstruction: async () => {},
    addHistory: async () => {},
    resetChat: async () => {},
    resumeChat: async () => {},
    setHistory: async () => {},
    restoreHistory: async () => {},
    addDirectoryContext: async () => {},
    getContentGenerator: () => unused(),
    startChat: async () => unused(),
    generateDirectMessage: () => unused(),
    generateJson: async () => ({}),
    generateContent: () => unused(),
    generateEmbedding: async () => [],
    async *sendMessageStream(): AsyncGenerator<ServerAgentStreamEvent> {
      /* override */
    },
    getUserTier: () => undefined,
    getCurrentSequenceModel: () => null,
  } as unknown as AgentClientContract;
}
// ─── Hook harness ──────────────────────────────────────────────────────────

interface HookHarness {
  result: {
    current: {
      runStream: (
        msg: AgentRequestInput,
        sig: AbortSignal,
        pid: string,
      ) => Promise<void>;
    };
  };
  routedEvents: AgentEvent[];
  addItem: ReturnType<typeof vi.fn>;
  onToolCallsUpdate: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function setupHookWithAgent(agent: Agent): HookHarness {
  const routedEvents: AgentEvent[] = [];
  const processAgentEventRef: React.MutableRefObject<AgentEventRouter | null> =
    { current: null };
  const addItem = vi.fn();
  const onToolCallsUpdate = vi.fn();
  const { result, unmount } = renderHook(() =>
    useAgentEventStream({
      agent,
      addItem,
      processAgentEventRef,
      flushPendingHistoryItem: vi.fn(),
      clearPendingHistoryItem: vi.fn(),
      performMemoryRefresh: vi.fn().mockResolvedValue(undefined),
      onTodoPause: vi.fn(),
      markToolsAsDisplayCleared: vi.fn(),
      onToolCallsUpdate,
      outputUpdateHandler: vi.fn(),
      getPreferredEditor: vi.fn(),
      onEditorOpen: vi.fn(),
      onEditorClose: vi.fn(),
    }),
  );
  processAgentEventRef.current = (e: AgentEvent) => {
    routedEvents.push(e);
  };
  return { result, routedEvents, addItem, onToolCallsUpdate, unmount };
}

function hasFunctionResponse(history: IContent[]): boolean {
  return history
    .filter((h) => h.speaker === 'human' || h.speaker === 'tool')
    .flatMap((h) => h.blocks)
    .some((b) => b.type === 'tool_response');
}

describe('useAgentEventStream loop integration', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('(i) multi-turn: real loop drives tool-call continuation end-to-end', async () => {
    const tool = new MockTool({
      name: 'echo_tool',
      execute: async () => ({ llmContent: 'echoed', returnDisplay: 'echoed' }),
    });
    const toolRegistry = createToolRegistryForTest([tool]);
    const policyEngine = createAllowPolicyEngine();
    const messageBus = new MessageBus(policyEngine, false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine,
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client, state } = createScriptedAgentClient([
      [
        toolCallRequestEvent('echo_tool', 'call-1', { text: 'hi' }),
        finishedEvent(),
      ],
      [contentEvent('final answer'), finishedEvent()],
    ]);

    const agent = createRealEngineAgent({
      agentClient: client,
      config,
      messageBus,
      interactiveMode: true,
    });
    const harness = setupHookWithAgent(agent);

    const controller = new AbortController();
    await act(async () => {
      await harness.result.current.runStream(
        'user message' as AgentRequestInput,
        controller.signal,
        'prompt-1',
      );
    });

    // The loop (not the CLI) drove the continuation: sendMessageStream called
    // exactly twice — once for the initial turn, once for the functionResponse
    // continuation.
    expect(state.sendMessageStreamCalls).toHaveLength(2);
    expect(state.turnMessages).toHaveLength(2);

    // The second turn's message contained a tool_response block.
    expect(hasFunctionResponse(state.history)).toBe(true);
    const turn2Blocks = agentRequestInputToBlocks(state.turnMessages[1]);
    expect(turn2Blocks.some((b) => b.type === 'tool_response')).toBe(true);

    expect(tool.executeFn).toHaveBeenCalledTimes(1);

    const toolResults = harness.routedEvents.filter(
      (e) => e.type === 'tool-result',
    );
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toMatchObject({
      type: 'tool-result',
      result: { id: 'call-1', name: 'echo_tool' },
    });

    const textValues = harness.routedEvents
      .filter((e) => e.type === 'text')
      .map((e) => (e as { text: string }).text);
    expect(textValues).toContain('final answer');
    const toolResultIdx = harness.routedEvents.findIndex(
      (e) => e.type === 'tool-result',
    );
    const finalTextIdx = harness.routedEvents.findIndex(
      (e) =>
        e.type === 'text' && (e as { text: string }).text === 'final answer',
    );
    expect(toolResultIdx).toBeGreaterThanOrEqual(0);
    expect(finalTextIdx).toBeGreaterThan(toolResultIdx);
    expect(harness.addItem).toHaveBeenCalledTimes(1);
  });

  it('(ii) cancellation mid-stream: abort settles the hook run', async () => {
    const policyEngine = createAllowPolicyEngine();
    const messageBus = new MessageBus(policyEngine, false);
    const toolRegistry = createToolRegistryForTest([]);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine,
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });

    let callCount = 0;
    const hangingChat = {
      getHistory: () => [] as IContent[],
      setHistory: () => {},
      clearHistory: () => {},
      getHistoryService: () => null,
      wasRecentlyCompressed: () => false,
      performCompression: async () => PerformCompressionResult.COMPRESSED,
      recordCompletedToolCalls: () => {},
    } as unknown as ReturnType<AgentClientContract['getChat']>;

    const hangingClient: AgentClientContract = {
      ...createClientBase(),
      getChat: () => hangingChat,
      addHistory: async () => {},
      async *sendMessageStream(
        _req: string | ContentBlock[] | IContent,
        signal: AbortSignal,
        _promptId: string,
      ): AsyncGenerator<ServerAgentStreamEvent> {
        callCount++;
        yield contentEvent('partial-text');
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        if (signal.aborted) {
          yield {
            type: AgentEventType.UserCancelled,
            value: undefined,
          } as ServerAgentStreamEvent;
        }
      },
    };

    const agent = createRealEngineAgent({
      agentClient: hangingClient,
      config,
      messageBus,
      interactiveMode: true,
    });
    const harness = setupHookWithAgent(agent);

    const controller = new AbortController();
    const runPromise = act(async () => {
      await harness.result.current.runStream(
        'go' as AgentRequestInput,
        controller.signal,
        'prompt-cancel',
      );
    });

    // Abort mid-stream after the partial text is routed (deterministic).
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (harness.routedEvents.some((e) => e.type === 'text')) {
          resolve();
          return;
        }
        setTimeout(check, 5);
      };
      check();
    });
    controller.abort();

    // The hook run must settle (not hang).
    await runPromise;

    // The hook received the partial content before abort.
    const textEvents = harness.routedEvents.filter((e) => e.type === 'text');
    const textValues = textEvents.map((e) => (e as { text: string }).text);
    expect(textValues).toContain('partial-text');

    // The hook stopped iterating after abort: only the partial text was
    // routed, no additional content chunks or tool results leaked through.
    expect(callCount).toBe(1);
    // The signal is aborted as expected.
    expect(controller.signal.aborted).toBe(true);
  });

  // ─── Helpers for the production confirmation path ──────────────────────

  /**
   * Polls forwarded onToolCallsUpdate calls until callId reaches target status.
   * If `runPromise` is provided, fails fast when the run settles before the
   * status is reached (avoids waiting the full timeout on an early-settled run).
   */
  function waitForToolCallStatus(
    harness: HookHarness,
    callId: string,
    status: ToolCall['status'],
    timeoutMs = 5000,
    runPromise?: Promise<unknown>,
  ): Promise<ToolCall> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      let settled = false;
      if (runPromise) {
        void Promise.resolve(runPromise)
          .catch(() => {})
          .then(() => {
            settled = true;
          });
      }
      const check = (): void => {
        const all: ToolCall[] = harness.onToolCallsUpdate.mock.calls.flatMap(
          (c) => c[0] as ToolCall[],
        );
        const found = all.find(
          (tc) => tc.request.callId === callId && tc.status === status,
        );
        if (found) {
          resolve(found);
          return;
        }
        if (settled) {
          reject(new Error(`Run settled before ${callId} reached "${status}"`));
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out: ${callId} never reached "${status}"`));
          return;
        }
        setTimeout(check, 10);
      };
      check();
    });
  }

  function getOnConfirm(
    tc: WaitingToolCall,
  ): (outcome: ToolConfirmationOutcome) => Promise<void> {
    return (tc.confirmationDetails as ToolCallConfirmationDetails).onConfirm;
  }

  function setupConfirmationTest(
    toolName: string,
    callId: string,
    scripts: ServerAgentStreamEvent[][],
  ): { harness: HookHarness; controller: AbortController } {
    const tool = new MockTool({ name: toolName });
    tool.shouldConfirm = true;
    tool.executeFn.mockResolvedValue({
      llmContent: 'should-not-matter',
      returnDisplay: 'should-not-matter',
    });
    const toolRegistry = createToolRegistryForTest([tool]);
    const policyEngine = createAskPolicyEngine();
    const messageBus = new MessageBus(policyEngine, false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine,
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });
    const { client } = createScriptedAgentClient(scripts);
    const agent = createRealEngineAgent({
      agentClient: client,
      config,
      messageBus,
      interactiveMode: true,
    });
    return {
      harness: setupHookWithAgent(agent),
      controller: new AbortController(),
    };
  }

  it('(iii-a) approval: ProceedOnce via confirmationDetails.onConfirm resolves the tool and the loop continues', async () => {
    const { harness, controller } = setupConfirmationTest(
      'confirm_tool',
      'call-appr',
      [
        [
          toolCallRequestEvent('confirm_tool', 'call-appr', { x: 1 }),
          finishedEvent(),
        ],
        [contentEvent('approved-and-done'), finishedEvent()],
      ],
    );
    const runPromise = act(async () => {
      await harness.result.current.runStream(
        'go' as AgentRequestInput,
        controller.signal,
        'prompt-appr',
      );
    });
    const awaitingTc = await waitForToolCallStatus(
      harness,
      'call-appr',
      'awaiting_approval',
      5000,
      runPromise,
    );
    const waitingTc = awaitingTc as WaitingToolCall;
    expect(waitingTc.confirmationDetails).toBeDefined();
    await getOnConfirm(waitingTc)(ToolConfirmationOutcome.ProceedOnce);
    await runPromise;
    expect(
      await waitForToolCallStatus(harness, 'call-appr', 'success'),
    ).toBeDefined();
    const textValues = harness.routedEvents
      .filter((e) => e.type === 'text')
      .map((e) => (e as { text: string }).text);
    expect(textValues).toContain('approved-and-done');
    expect(harness.addItem).toHaveBeenCalledTimes(1);
  });

  it('(iii-b) approval: Cancel via confirmationDetails.onConfirm rejects the tool and the turn ends with cancelled status', async () => {
    const { harness, controller } = setupConfirmationTest(
      'confirm_tool',
      'call-rej',
      [[toolCallRequestEvent('confirm_tool', 'call-rej'), finishedEvent()]],
    );
    const runPromise = act(async () => {
      await harness.result.current.runStream(
        'go' as AgentRequestInput,
        controller.signal,
        'prompt-rej',
      );
    });
    const awaitingTc = await waitForToolCallStatus(
      harness,
      'call-rej',
      'awaiting_approval',
      5000,
      runPromise,
    );
    const waitingTc = awaitingTc as WaitingToolCall;
    expect(waitingTc.confirmationDetails).toBeDefined();
    await getOnConfirm(waitingTc)(ToolConfirmationOutcome.Cancel);
    await runPromise;
    expect(
      await waitForToolCallStatus(harness, 'call-rej', 'cancelled'),
    ).toBeDefined();
    const doneEvents = harness.routedEvents.filter((e) => e.type === 'done');
    expect(doneEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('(issue 2) unmount clears display callbacks so stale closures do not linger', () => {
    const policyEngine = createAllowPolicyEngine();
    const messageBus = new MessageBus(policyEngine, false);
    const toolRegistry = createToolRegistryForTest([]);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine,
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });
    const { client } = createScriptedAgentClient([]);
    const displayCallbacksHolder = { current: {} as DisplayCallbacks };
    const editorCallbacksHolder = { current: {} as Record<string, unknown> };
    const agent = createRealEngineAgent({
      agentClient: client,
      config,
      messageBus,
      interactiveMode: true,
      displayCallbacksHolder,
      editorCallbacksHolder,
    });
    const harness = setupHookWithAgent(agent);
    expect(displayCallbacksHolder.current).toHaveProperty('onToolCallsUpdate');
    expect(displayCallbacksHolder.current).toHaveProperty(
      'onAllToolCallsComplete',
    );
    expect(editorCallbacksHolder.current).toHaveProperty('getPreferredEditor');
    harness.unmount();
    expect(Object.keys(displayCallbacksHolder.current)).toHaveLength(0);
    expect(Object.keys(editorCallbacksHolder.current)).toHaveLength(0);
  });
});
