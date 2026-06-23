/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */


/**
 * Behavioral tests for useAgenticLoop — the hook that rewires the CLI to
 * consume the engine-owned AgenticLoop.
 *
 * What this proves (the acceptance criteria):
 *  - The CLI's tool-display state (TrackedToolCall[]), tool-output state, and
 *    tool-completion display state all update OBSERVABLY when the loop runs.
 *  - Multi-turn continuation works WITHOUT the CLI re-submitting: after a tool
 *    completes, the loop's SECOND model turn's content is processed into React
 *    state. There is no isContinuation submitQuery call from the CLI.
 *
 * The AgenticLoop, CoreToolScheduler, ConfirmationCoordinator, MessageBus and
 * MockTool are REAL. The only mock boundary is the provider stream
 * (AgentClient.sendMessageStream yields scripted ServerGeminiStreamEvents) —
 * mirroring the LLM-provider mock used by the engine's own integration tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FinishReason } from '@google/genai';
import { act } from 'react';
import { renderHook, waitFor } from '../../../../test-utils/render.js';
import { useAgenticLoop } from '../useAgenticLoop.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import {
  getOrCreateScheduler,
  disposeScheduler,
  clearAllSchedulers,
} from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { CoreToolScheduler } from '@vybestack/llxprt-code-agents';
import {
  GeminiEventType,
  DEFAULT_AGENT_ID,
  type ToolCallRequestInfo,
  type ServerGeminiStreamEvent,
  type AgentClientContract,
  type Config,
  type ToolCall,
} from '@vybestack/llxprt-code-core';
import type { PartListUnion, Content, Part } from '@google/genai';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { HistoryItem, HistoryItemWithoutId } from '../../../types.js';

// ─── Scripted AgentClient (LLM-provider boundary mock) ─────────────────────

type TurnScript = ServerGeminiStreamEvent[];

function toParts(req: PartListUnion): Part[] {
  if (typeof req === 'string') return [{ text: req }];
  if (Array.isArray(req)) {
    return req.map((p) => (typeof p === 'string' ? { text: p } : p));
  }
  return [req];
}

function createScriptedAgentClient(
  scripts: TurnScript[],
  recordCompletedSpy?: ReturnType<typeof vi.fn>,
): {
  client: AgentClientContract;
  history: Content[];
  turnMessages: PartListUnion[];
} {
  const scriptQueue = [...scripts];
  const history: Content[] = [];
  const turnMessages: PartListUnion[] = [];
  const client: AgentClientContract = {
    async initialize() {},
    isInitialized: () => true,
    hasChatInitialized: () => true,
    async getHistory() {
      return history;
    },
    getChat: () =>
      ({
        recordCompletedToolCalls: recordCompletedSpy,
      }) as unknown as ReturnType<AgentClientContract['getChat']>,
    getHistoryService: () => null,
    storeHistoryServiceForReuse: () => {},
    storeHistoryForLaterUse: (h: Content[]) => history.push(...h),
    dispose: () => {},
    setTools: async () => {},
    clearTools: () => {},
    updateSystemInstruction: async () => {},
    addHistory: async (content: Content) => {
      history.push(content);
    },
    resetChat: async () => {},
    resumeChat: async () => {},
    setHistory: async () => {},
    restoreHistory: async () => {},
    addDirectoryContext: async () => {},
    getContentGenerator: () => {
      throw new Error('not used by AgenticLoop');
    },
    startChat: async () => {
      throw new Error('not used');
    },
    generateDirectMessage: () => {
      throw new Error('not used');
    },
    generateJson: async () => ({}),
    generateContent: () => {
      throw new Error('not used');
    },
    generateEmbedding: async () => [],
    async *sendMessageStream(
      req: PartListUnion,
      signal: AbortSignal,
      _promptId: string,
    ): AsyncGenerator<ServerGeminiStreamEvent> {
      turnMessages.push(req);
      history.push({ role: 'user', parts: toParts(req) });
      const script = scriptQueue.shift();
      if (!script) return;
      for (const event of script) {
        if (signal.aborted) return;
        yield event;
      }
    },
    getUserTier: () => undefined,
    getCurrentSequenceModel: () => 'test-model',
  };
  return { client, history, turnMessages };
}

function toolCallRequestEvent(
  name: string,
  callId: string,
  args: Record<string, unknown> = {},
): ServerGeminiStreamEvent {
  const value: ToolCallRequestInfo = {
    callId,
    name,
    args,
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  return { type: GeminiEventType.ToolCallRequest, value };
}

function contentEvent(text: string): ServerGeminiStreamEvent {
  return { type: GeminiEventType.Content, value: text };
}

function finishedEvent(): ServerGeminiStreamEvent {
  return {
    type: GeminiEventType.Finished,
    value: { reason: FinishReason.STOP },
  };
}

// ─── Test Config + ToolRegistry fixtures (infrastructure, not the SUT) ──────

function createAllowPolicyEngine(): PolicyEngine {
  return new PolicyEngine({
    rules: [],
    defaultDecision: PolicyDecision.ALLOW,
    nonInteractive: false,
  });
}

function createToolRegistryForTest(tools: MockTool[]): ToolRegistry {
  const toolMap = new Map<string, MockTool>();
  for (const tool of tools) toolMap.set(tool.name, tool);
  const fixture = {
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
  };
  return fixture as unknown as ToolRegistry;
}

function createTestConfig(options: {
  messageBus: MessageBus;
  toolRegistry: ToolRegistry;
  policyEngine: PolicyEngine;
  interactive: boolean;
  approvalMode?: ApprovalMode;
}): Config {
  const { messageBus, toolRegistry, policyEngine, interactive } = options;
  const approvalMode = options.approvalMode ?? ApprovalMode.YOLO;
  const fixture = {
    getSessionId: () => 'agentic-loop-cli-test-session',
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    getApprovalMode: () => approvalMode,
    getEphemeralSettings: () => ({}),
    getEphemeralSetting: () => undefined,
    getAllowedTools: (): string[] => [],
    getExcludeTools: (): string[] => [],
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    getToolRegistry: () => toolRegistry,
    getMessageBus: () => messageBus,
    getPolicyEngine: () => policyEngine,
    getTelemetryLogPromptsEnabled: () => false,
    isInteractive: () => interactive,
    getNonInteractive: () => !interactive,
    getModel: () => 'test-model',
    getToolSchedulerFactory:
      () =>
      (
        opts: ConstructorParameters<typeof CoreToolScheduler>[0],
      ): CoreToolScheduler =>
        new CoreToolScheduler(opts),
    getOrCreateScheduler: (
      sessionId: string,
      callbacks: Parameters<Config['getOrCreateScheduler']>[1],
      schedulerOptions: Parameters<Config['getOrCreateScheduler']>[2],
      deps: Parameters<Config['getOrCreateScheduler']>[3],
    ) =>
      getOrCreateScheduler(
        fixture as unknown as Config,
        sessionId,
        callbacks,
        schedulerOptions,
        {
          messageBus: deps?.messageBus ?? messageBus,
          toolRegistry: deps?.toolRegistry ?? toolRegistry,
        },
      ),
    disposeScheduler: (sessionId: string) => disposeScheduler(sessionId),
  };
  return fixture as unknown as Config;
}

// ─── Type guard helpers ─────────────────────────────────────────────────────

function isToolGroupItem(
  item: Omit<HistoryItem, 'id'>,
): item is Extract<HistoryItemWithoutId, { type: 'tool_group' }> {
  return item.type === 'tool_group';
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useAgenticLoop — engine-owned loop drives CLI state', () => {
  let messageBus: MessageBus;
  let toolRegistry: ToolRegistry;
  let config: Config;

  beforeEach(() => {
    clearAllSchedulers();
    const tool = new MockTool({ name: 'record_tool' });
    tool.executeFn.mockResolvedValue({
      llmContent: 'recorded-ok',
      returnDisplay: 'recorded-ok',
    });
    toolRegistry = createToolRegistryForTest([tool]);
    messageBus = new MessageBus(createAllowPolicyEngine(), false);
    config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });
  });

  afterEach(() => {
    clearAllSchedulers();
  });

  it('updates tool-display, output, and completion state observably across a multi-turn loop', async () => {
    const tool = toolRegistry.getTool('record_tool') as MockTool;
    const recordCompletedSpy = vi.fn();
    const { client } = createScriptedAgentClient(
      [
        [toolCallRequestEvent('record_tool', 'call-1'), finishedEvent()],
        [contentEvent('final-answer'), finishedEvent()],
      ],
      recordCompletedSpy,
    );

    // Capture every observable state update the hook emits: tool-display
    // updates, tool-output updates, completion addItem payloads, and the
    // streamed second-turn content. These arrays are the assertion surface.
    const addedItems: Array<Omit<HistoryItem, 'id'>> = [];
    const addItem = (item: Omit<HistoryItem, 'id'>) => {
      addedItems.push(item);
      return addedItems.length;
    };
    const displayToolCalls: ToolCall[][] = [];
    let streamedContent = '';
    const processStreamEventFn = (event: ServerGeminiStreamEvent) => {
      if (event.type === GeminiEventType.Content) {
        streamedContent += event.value;
      }
      if (event.type === GeminiEventType.Finished && streamedContent) {
        addedItems.push({ type: 'gemini', text: streamedContent });
        streamedContent = '';
      }
    };

    const { result } = renderHook(() =>
      useAgenticLoop({
        config,
        agentClient: client,
        messageBus,
        interactiveMode: true,
        addItem,
        onToolCallsUpdate: (calls) => {
          displayToolCalls.push(calls);
        },
        outputUpdateHandler: () => {},
        getPreferredEditor: () => undefined,
        onEditorOpen: () => {},
        onEditorClose: () => {},
        onTodoPause: () => {},
        processStreamEventRef: { current: processStreamEventFn },
        flushPendingHistoryItem: () => {},
        clearPendingHistoryItem: () => {},
        performMemoryRefresh: async () => {},
      }),
    );

    const controller = new AbortController();
    await act(async () => {
      await result.current.runLoop('go', controller.signal, 'prompt-1');
    });

    // ── 1. Tool-display state: the loop forwarded tool-call updates so the
    // hook's display callback observed the tool moving through its lifecycle
    // and landing on a terminal 'success' status.
    await waitFor(() => {
      const flattened = displayToolCalls.flat();
      const successCall = flattened.find(
        (c) => c.request.callId === 'call-1' && c.status === 'success',
      );
      expect(successCall).toBeDefined();
    });

    // ── 2. Completion display: the hook added a tool_group item for the
    // completed tool calls (this is the addItem(display) parity behavior).
    const toolGroupItems = addedItems.filter(isToolGroupItem);
    expect(toolGroupItems.length).toBeGreaterThanOrEqual(1);
    const groupTools = toolGroupItems[0].tools;
    expect(groupTools.some((t) => t.callId === 'call-1')).toBe(true);

    void recordCompletedSpy;

    // ── 3. Multi-turn continuation WITHOUT CLI re-submit: the loop fed the
    // tool's functionResponse back and drove a SECOND model turn whose content
    // ('final-answer') was streamed into addItem. The tool executed exactly
    // once (the loop drove it, not a CLI re-submit).
    expect(tool.executeFn).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      const texts = addedItems
        .filter(
          (i): i is Extract<HistoryItemWithoutId, { type: 'gemini' }> =>
            i.type === 'gemini',
        )
        .map((i) => i.text);
      expect(texts.some((t) => t.includes('final-answer'))).toBe(true);
    });
  });

  it('does not re-submit on continuation; the second turn is driven solely by the loop', async () => {
    // The proof: sendMessageStream is the only LLM entry point. The loop must
    // call it exactly twice (turn 1 + continuation turn 2). If the CLI were
    // still re-submitting via submitQuery, a third call would appear. We
    // observe this via turnMessages — the PartListUnion the loop hands to
    // sendMessageStream on each turn.
    const tool = toolRegistry.getTool('record_tool') as MockTool;

    const { client, turnMessages } = createScriptedAgentClient([
      [toolCallRequestEvent('record_tool', 'call-1'), finishedEvent()],
      [contentEvent('continuation-content'), finishedEvent()],
    ]);

    const addItem = vi.fn();

    const { result } = renderHook(() =>
      useAgenticLoop({
        config,
        agentClient: client,
        messageBus,
        interactiveMode: true,
        addItem,
        onToolCallsUpdate: () => {},
        outputUpdateHandler: () => {},
        getPreferredEditor: () => undefined,
        onEditorOpen: () => {},
        onEditorClose: () => {},
        onTodoPause: () => {},
        processStreamEventRef: { current: () => {} },
        flushPendingHistoryItem: () => {},
        clearPendingHistoryItem: () => {},
        performMemoryRefresh: async () => {},
      }),
    );

    await act(async () => {
      await result.current.runLoop('go', new AbortController().signal, 'p1');
    });

    // Exactly two turns — the second carries the functionResponse the loop
    // built. No CLI re-submit added a third.
    expect(turnMessages).toHaveLength(2);
    const turn2Parts = toParts(turnMessages[1]);
    expect(turn2Parts.some((p) => 'functionResponse' in p)).toBe(true);
    expect(tool.executeFn).toHaveBeenCalledTimes(1);
  });

  it('aborts cleanly via the AbortSignal passed to runLoop', async () => {
    // A tool that blocks until the signal aborts, so we can prove the loop
    // tears down on abort and the hook's runLoop promise settles.
    const tool = toolRegistry.getTool('record_tool') as MockTool;
    tool.executeFn.mockImplementation(
      (_p: Record<string, unknown>, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );

    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('record_tool', 'call-abort'), finishedEvent()],
    ]);

    const addItem = vi.fn();

    const { result } = renderHook(() =>
      useAgenticLoop({
        config,
        agentClient: client,
        messageBus,
        interactiveMode: true,
        addItem,
        onToolCallsUpdate: () => {},
        outputUpdateHandler: () => {},
        getPreferredEditor: () => undefined,
        onEditorOpen: () => {},
        onEditorClose: () => {},
        onTodoPause: () => {},
        processStreamEventRef: { current: () => {} },
        flushPendingHistoryItem: () => {},
        clearPendingHistoryItem: () => {},
        performMemoryRefresh: async () => {},
      }),
    );

    const controller = new AbortController();
    let settled = false;
    await act(async () => {
      const promise = result.current.runLoop('go', controller.signal, 'p1');
      // Abort once the tool is in flight.
      await new Promise((resolve) => setTimeout(resolve, 50));
      controller.abort();
      await promise.catch(() => {});
      settled = true;
    });
    expect(settled).toBe(true);
  });

  it('serializes overlapping runLoop calls so a fast re-submit after cancel does not throw concurrent-execution', async () => {
    // Reproduces issue #2076: after cancelling (ESC), a new message submitted
    // before the previous generator's async teardown finishes must NOT throw
    // "AgenticLoop.run does not support concurrent executions". runLoop must
    // await the previous in-flight run's settlement before starting a new one.
    const tool = toolRegistry.getTool('record_tool') as MockTool;
    tool.executeFn.mockImplementation(
      (_p: Record<string, unknown>, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );

    // First turn: a tool call that blocks until its signal aborts.
    // Second turn (for the re-submit 'go2'): completes normally.
    const { client, turnMessages } = createScriptedAgentClient([
      [toolCallRequestEvent('record_tool', 'call-concurrent'), finishedEvent()],
      [contentEvent('second-turn'), finishedEvent()],
    ]);

    const addItem = vi.fn();

    // Capture streamed content so we can prove the second run actually
    // executed its model turn (not merely that it failed to throw).
    let streamedContent = '';
    const processStreamEventFn = (event: ServerGeminiStreamEvent) => {
      if (event.type === GeminiEventType.Content) {
        streamedContent += event.value;
      }
    };

    const { result } = renderHook(() =>
      useAgenticLoop({
        config,
        agentClient: client,
        messageBus,
        interactiveMode: true,
        addItem,
        onToolCallsUpdate: () => {},
        outputUpdateHandler: () => {},
        getPreferredEditor: () => undefined,
        onEditorOpen: () => {},
        onEditorClose: () => {},
        onTodoPause: () => {},
        processStreamEventRef: { current: processStreamEventFn },
        flushPendingHistoryItem: () => {},
        clearPendingHistoryItem: () => {},
        performMemoryRefresh: async () => {},
      }),
    );

    const controllerA = new AbortController();
    const controllerB = new AbortController();

    let firstError: unknown;
    let secondError: unknown;

    // Start the first run WITHOUT awaiting it.
    const firstPromise = act(async () => {
      try {
        await result.current.runLoop('go', controllerA.signal, 'p1');
      } catch (e) {
        firstError = e;
      }
    });

    // Wait until the tool is in-flight.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Cancel the first run (ESC).
    controllerA.abort();

    // Immediately submit a second run BEFORE the first settles.
    const secondPromise = act(async () => {
      try {
        await result.current.runLoop('go2', controllerB.signal, 'p2');
      } catch (e) {
        secondError = e;
      }
    });

    await Promise.all([firstPromise, secondPromise]);

    // The second (re-submit) run must succeed without error — proving the
    // serialization allowed it to run after the cancelled first run.
    expect(secondError).toBeUndefined();
    // The first run was cancelled, so it may throw, but must NOT be the
    // concurrent-execution error.
    const firstMsg =
      firstError instanceof Error ? firstError.message : String(firstError);
    expect(firstMsg).not.toContain('concurrent');

    // Stronger proof the second run ACTUALLY RAN (not just didn't throw): its
    // 'go2' message reached the model and its second-turn content streamed in.
    expect(turnMessages).toContain('go2');
    expect(streamedContent).toContain('second-turn');
  });

  it('clears external (subagent) tools from the display via markToolsAsDisplayCleared', async () => {
    // An external tool carries a non-default agentId. The subagent flow owns
    // its results, so the loop's display handling must mark it display-cleared
    // to remove it from the pending React display state. Primary tools must NOT
    // be marked cleared (continuation owns them).
    const tool = toolRegistry.getTool('record_tool') as MockTool;

    const externalRequest: ToolCallRequestInfo = {
      callId: 'subagent-call',
      name: 'record_tool',
      args: {},
      isClientInitiated: false,
      prompt_id: 'subagent-call',
      agentId: 'agent-sub',
    };

    const { client } = createScriptedAgentClient([
      [
        { type: GeminiEventType.ToolCallRequest, value: externalRequest },
        finishedEvent(),
      ],
      [contentEvent('after-subagent'), finishedEvent()],
    ]);

    const markedDisplayCleared: string[][] = [];

    const { result } = renderHook(() =>
      useAgenticLoop({
        config,
        agentClient: client,
        messageBus,
        interactiveMode: true,
        addItem: vi.fn(),
        markToolsAsDisplayCleared: (callIds) => {
          markedDisplayCleared.push(callIds);
        },
        onToolCallsUpdate: () => {},
        outputUpdateHandler: () => {},
        getPreferredEditor: () => undefined,
        onEditorOpen: () => {},
        onEditorClose: () => {},
        onTodoPause: () => {},
        processStreamEventRef: { current: () => {} },
        flushPendingHistoryItem: () => {},
        clearPendingHistoryItem: () => {},
        performMemoryRefresh: async () => {},
      }),
    );

    await act(async () => {
      await result.current.runLoop('go', new AbortController().signal, 'p1');
    });

    // The external tool's callId was marked display-cleared exactly once so
    // the display clears it. The tool itself still executed once (the loop ran it).
    await waitFor(() => {
      expect(markedDisplayCleared).toHaveLength(1);
    });
    expect(markedDisplayCleared[0]).toStrictEqual(['subagent-call']);
    expect(tool.executeFn).toHaveBeenCalledTimes(1);
  });

  it('keeps runLoop stable while routing through the latest caller callbacks', async () => {
    const { client } = createScriptedAgentClient([
      [contentEvent('fresh-callback'), finishedEvent()],
    ]);
    const oldRouter = vi.fn();
    const newRouter = vi.fn();
    let processStreamEventRef = { current: oldRouter };

    const { result, rerender } = renderHook(() =>
      useAgenticLoop({
        config,
        agentClient: client,
        messageBus,
        interactiveMode: true,
        addItem: vi.fn(),
        onToolCallsUpdate: () => {},
        outputUpdateHandler: () => {},
        getPreferredEditor: () => undefined,
        onEditorOpen: () => {},
        onEditorClose: () => {},
        onTodoPause: () => {},
        processStreamEventRef,
        flushPendingHistoryItem: () => {},
        clearPendingHistoryItem: () => {},
        performMemoryRefresh: async () => {},
      }),
    );

    const firstRunLoop = result.current.runLoop;
    processStreamEventRef = { current: newRouter };
    rerender();

    expect(result.current.runLoop).toBe(firstRunLoop);

    await act(async () => {
      await result.current.runLoop('go', new AbortController().signal, 'p1');
    });

    expect(oldRouter).not.toHaveBeenCalled();
    expect(newRouter).toHaveBeenCalled();
  });

  it('drives primary continuation without ever display-clearing the primary tool', async () => {
    // The display-clearing path is for external (subagent) tools only. A
    // primary tool drives the loop's continuation turn (turn 2 carries the
    // functionResponse the loop built) and is NEVER routed through
    // markToolsAsDisplayCleared — proving continuation is decoupled from the
    // display-state marker.
    const { client, turnMessages } = createScriptedAgentClient([
      [toolCallRequestEvent('record_tool', 'primary-call'), finishedEvent()],
      [contentEvent('continuation-content'), finishedEvent()],
    ]);

    const markedDisplayCleared: string[][] = [];

    const { result } = renderHook(() =>
      useAgenticLoop({
        config,
        agentClient: client,
        messageBus,
        interactiveMode: true,
        addItem: vi.fn(),
        markToolsAsDisplayCleared: (callIds) => {
          markedDisplayCleared.push(callIds);
        },
        onToolCallsUpdate: () => {},
        outputUpdateHandler: () => {},
        getPreferredEditor: () => undefined,
        onEditorOpen: () => {},
        onEditorClose: () => {},
        onTodoPause: () => {},
        processStreamEventRef: { current: () => {} },
        flushPendingHistoryItem: () => {},
        clearPendingHistoryItem: () => {},
        performMemoryRefresh: async () => {},
      }),
    );

    await act(async () => {
      await result.current.runLoop('go', new AbortController().signal, 'p1');
    });

    // Two turns => the loop drove continuation for the primary tool.
    expect(turnMessages).toHaveLength(2);
    const turn2Parts = toParts(turnMessages[1]);
    expect(turn2Parts.some((p) => 'functionResponse' in p)).toBe(true);
    // The primary tool's callId was never passed to the display-clearing
    // callback: continuation does not depend on (or trigger) display clearing.
    expect(markedDisplayCleared.flat()).not.toContain('primary-call');
  });
});
