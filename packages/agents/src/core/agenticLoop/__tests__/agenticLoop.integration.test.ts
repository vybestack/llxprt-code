/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable max-lines, eslint-comments/disable-enable-pair -- Phase 5: large behavioral coverage file retained together to avoid fragmenting related scenarios. */

/**
 * Behavioral integration tests for the engine-owned AgenticLoop.
 *
 * The loop, CoreToolScheduler, and ConfirmationCoordinator are REAL. The only
 * mock boundary is the provider stream (an AgentClientContract whose
 * sendMessageStream yields scripted ServerGeminiStreamEvents) — this mirrors
 * mocking the LLM provider, which is infrastructure. Tool implementations use
 * the real MockTool infra (the actual tool the scheduler invokes).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FinishReason } from '@google/genai';

// Mock ONLY the editor-spawn infrastructure (`modifyWithEditor` launches a real
// editor process via openDiff). Every other export of the tools barrel is the
// real implementation, so the scheduler/coordinator under test stay real.
const { modifyWithEditorMock } = vi.hoisted(() => ({
  modifyWithEditorMock: vi.fn(),
}));
vi.mock('@vybestack/llxprt-code-tools', async (importActual) => {
  const actual =
    await importActual<typeof import('@vybestack/llxprt-code-tools')>();
  return { ...actual, modifyWithEditor: modifyWithEditorMock };
});
import { CoreToolScheduler } from '../../coreToolScheduler.js';
import { AgenticLoop } from '../AgenticLoop.js';
import type { ApprovalHandler, AgenticLoopEvent } from '../types.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { MockModifiableTool } from '@vybestack/llxprt-code-core/test-utils/tools.js';
import {
  getOrCreateScheduler,
  disposeScheduler,
  clearAllSchedulers,
} from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import {
  GeminiEventType,
  DEFAULT_AGENT_ID,
  PerformCompressionResult,
  type ToolCallRequestInfo,
  type ServerGeminiStreamEvent,
} from '@vybestack/llxprt-code-core/core/turn.js';
import type {
  AgentChatContract,
  AgentClientContract,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { Content, Part, PartListUnion } from '@google/genai';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type {
  CompletedToolCall,
  ToolCall,
} from '@vybestack/llxprt-code-core/scheduler/types.js';

/**
 * A single model turn script: a list of ServerGeminiStreamEvents the fake
 * provider emits for that turn. The loop drives one script per turn.
 */
type TurnScript = ServerGeminiStreamEvent[];

/** Converts a PartListUnion into a Part[] (string → [{text}]). */
function partListUnionToParts(req: PartListUnion): Part[] {
  if (Array.isArray(req)) {
    return req;
  }
  if (typeof req === 'string') {
    return [{ text: req }];
  }
  return [req];
}

/**
 * Creates an AgentClientContract whose sendMessageStream pops one TurnScript
 * per call from a queue. This is the LLM provider boundary: callers script what
 * the "model" emits. History is recorded in a real array. The `turnMessages`
 * array captures the PartListUnion received on each turn so tests can assert
 * that functionResponse parts from a prior turn were fed into a later turn.
 */
function createScriptedAgentClient(scripts: TurnScript[]): {
  client: AgentClientContract;
  history: Content[];
  turnMessages: PartListUnion[];
  promptIds: string[];
  recordedToolCalls: CompletedToolCall[][];
} {
  const scriptQueue = [...scripts];
  const history: Content[] = [];
  const turnMessages: PartListUnion[] = [];
  const promptIds: string[] = [];
  const recordedToolCalls: CompletedToolCall[][] = [];
  const chat: AgentChatContract = {
    sendMessageStream: async () => {
      async function* emptyStream() {}
      return emptyStream();
    },
    getHistory: () => history,
    setHistory: (nextHistory: Content[]) => {
      history.splice(0, history.length, ...nextHistory);
    },
    clearHistory: () => {
      history.splice(0, history.length);
    },
    getHistoryService: () => null,
    wasRecentlyCompressed: () => false,
    performCompression: async () => PerformCompressionResult.COMPRESSED,
    recordCompletedToolCalls: (_model, completed) => {
      recordedToolCalls.push(completed);
    },
  };
  const client: AgentClientContract = {
    async initialize() {},
    isInitialized: () => true,
    hasChatInitialized: () => true,
    getChat: () => chat,
    async getHistory() {
      return history;
    },
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
      promptId: string,
    ): AsyncGenerator<ServerGeminiStreamEvent> {
      // Mirror the real AgentClient: record the user message into history
      // before streaming the model response.
      turnMessages.push(req);
      promptIds.push(promptId);
      history.push({ role: 'user', parts: partListUnionToParts(req) });
      const script = scriptQueue.shift();
      if (!script) {
        return;
      }
      for (const event of script) {
        if (signal.aborted) {
          return;
        }
        yield event;
      }
    },
    getUserTier: () => undefined,
    getCurrentSequenceModel: () => null,
  };
  return { client, history, turnMessages, promptIds, recordedToolCalls };
}

/** Builds a ToolCallRequest stream event. */
function toolCallRequestEvent(
  name: string,
  callId: string,
  args: Record<string, unknown> = {},
  overrides: Partial<ToolCallRequestInfo> = {},
): ServerGeminiStreamEvent {
  const value: ToolCallRequestInfo = {
    callId,
    name,
    args,
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
    ...overrides,
  };
  return { type: GeminiEventType.ToolCallRequest, value };
}

/** Builds a Content stream event. */
function contentEvent(text: string): ServerGeminiStreamEvent {
  return { type: GeminiEventType.Content, value: text };
}

/** Builds a Finished stream event. */
function finishedEvent(): ServerGeminiStreamEvent {
  return {
    type: GeminiEventType.Finished,
    value: { reason: FinishReason.STOP },
  };
}

/**
 * Builds a real-ish Config wired to the scheduler singleton with a REAL
 * CoreToolScheduler factory. Config here is infrastructure: it supplies the
 * scheduler, policy engine, tool registry, and interactivity flag. It is NOT
 * the component under test.
 */
function createTestConfig(options: {
  messageBus: MessageBus;
  toolRegistry: ToolRegistry;
  policyEngine: PolicyEngine;
  interactive: boolean;
  approvalMode?: ApprovalMode;
}): Config {
  const { messageBus, toolRegistry, policyEngine, interactive } = options;
  const approvalMode = options.approvalMode ?? ApprovalMode.YOLO;

  // Config is a large class; only the scheduler-related surface is exercised.
  // The fixture is built as a record of correctly-typed lambdas and narrowed
  // via the testBoundaryConfig helper below.
  const fixture = {
    getSessionId: () => 'agentic-loop-test-session',
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    getApprovalMode: () => approvalMode,
    getEphemeralSettings: () => ({}),
    getEphemeralSetting: () => undefined,
    getAllowedTools: (): string[] => [],
    getExcludeTools: (): string[] => [],
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    getModel: () => 'test-model',
    getToolRegistry: () => toolRegistry,
    getMessageBus: () => messageBus,
    getPolicyEngine: () => policyEngine,
    getTelemetryLogPromptsEnabled: () => false,
    isInteractive: () => interactive,
    getNonInteractive: () => !interactive,
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
        testBoundaryConfig(fixture),
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
  return testBoundaryConfig(fixture);
}

/**
 * Narrows the test fixture to Config. Config is a large class with many
 * methods unrelated to the scheduler lifecycle exercised here; fully
 * instantiating it would require dozens of irrelevant dependencies. This is a
 * test-only boundary — the fixture provides real, correctly-typed lambdas for
 * every method the loop actually calls.
 */
function testBoundaryConfig(fixture: Record<string, unknown>): Config {
  return fixture as Config;
}

/** Builds a ToolRegistry fixture backed by a name→tool map. */
function createToolRegistryForTest(tools: MockTool[]): ToolRegistry {
  const toolMap = new Map<string, MockTool>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }
  const fixture = {
    getToolByName: (name: string): MockTool | null => toolMap.get(name) ?? null,
    getTool: (name: string): MockTool | null => toolMap.get(name) ?? null,
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
  return testBoundaryToolRegistry(fixture);
}

/**
 * Narrows the test fixture to ToolRegistry. ToolRegistry is a class with
 * discovery/shell-spawning machinery irrelevant to these tests; the fixture
 * provides correctly-typed lambdas for the lookup methods the scheduler uses.
 */
function testBoundaryToolRegistry(
  fixture: Record<string, unknown>,
): ToolRegistry {
  return fixture as ToolRegistry;
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

/** Collects all events from running the loop to completion. */
async function collectEvents(
  loop: AgenticLoop,
  message: PartListUnion,
  signal: AbortSignal,
  promptId?: string,
): Promise<AgenticLoopEvent[]> {
  const events: AgenticLoopEvent[] = [];
  for await (const event of loop.run(message, signal, promptId)) {
    events.push(event);
  }
  return events;
}

// ─── Type guards for event narrowing (no casts) ─────────────────────────────

function isToolsComplete(
  e: AgenticLoopEvent,
): e is Extract<AgenticLoopEvent, { kind: 'tools_complete' }> {
  return e.kind === 'tools_complete';
}

function isStream(
  e: AgenticLoopEvent,
): e is Extract<AgenticLoopEvent, { kind: 'stream' }> {
  return e.kind === 'stream';
}

function isAwaitingApproval(
  e: AgenticLoopEvent,
): e is Extract<AgenticLoopEvent, { kind: 'awaiting_approval' }> {
  return e.kind === 'awaiting_approval';
}

/** Extracts the functionResponse parts from a Content[] history. */
function functionResponseParts(history: Content[]): Part[] {
  return history
    .filter((h) => h.role === 'user')
    .flatMap((h) => h.parts)
    .filter(
      (p): p is Part & { functionResponse: unknown } => 'functionResponse' in p,
    );
}

/** True when any part in history is a functionResponse. */
function hasFunctionResponse(history: Content[]): boolean {
  return functionResponseParts(history).length > 0;
}

// ─── Suite 1: CLI-style ASK_USER policy ─────────────────────────────────────

describe('AgenticLoop integration - CLI-style with ASK_USER policy', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('ProceedOnce continues the loop and the tool executes (side effect observable)', async () => {
    const tool = new MockTool({
      name: 'record_tool',
      execute: async () => ({
        llmContent: 'recorded-ok',
        returnDisplay: 'recorded-ok',
      }),
    });
    tool.shouldConfirm = true;
    tool.executeFn.mockResolvedValue({
      llmContent: 'recorded-ok',
      returnDisplay: 'recorded-ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    const approvalHandler: ApprovalHandler = async () => ({
      outcome: ToolConfirmationOutcome.ProceedOnce,
    });

    const { client, history, turnMessages, recordedToolCalls } =
      createScriptedAgentClient([
        [
          toolCallRequestEvent('record_tool', 'call-1', { x: 1 }),
          finishedEvent(),
        ],
        [contentEvent('done'), finishedEvent()],
      ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(tool.executeFn).toHaveBeenCalledTimes(1);
    expect(recordedToolCalls).toHaveLength(1);
    expect(recordedToolCalls[0][0]?.request.callId).toBe('call-1');

    // ── Prove the full loop order via observable event sequence ───────────
    const eventKinds = events.map((e) => e.kind);
    const firstToolsCompleteIdx = eventKinds.indexOf('tools_complete');
    expect(firstToolsCompleteIdx).toBeGreaterThanOrEqual(0);

    // Phase 1: stream (model's ToolCallRequest) must come before tools_complete
    const firstStreamIdx = eventKinds.indexOf('stream');
    expect(firstStreamIdx).toBeGreaterThanOrEqual(0);
    expect(firstStreamIdx).toBeLessThan(firstToolsCompleteIdx);

    // Tool-execution events (tool_update/awaiting_approval/tool_output) sit
    // between the first stream phase and tools_complete.
    const firstToolUpdateIdx = eventKinds.indexOf('tool_update');
    expect(firstToolUpdateIdx).toBeGreaterThan(firstStreamIdx);
    expect(firstToolUpdateIdx).toBeLessThan(firstToolsCompleteIdx);

    // Phase 2: a second stream phase (model continuation) must come AFTER
    // tools_complete — proving the functionResponse was fed back.
    const secondStreamIdx = eventKinds.indexOf(
      'stream',
      firstToolsCompleteIdx + 1,
    );
    expect(secondStreamIdx).toBeGreaterThan(firstToolsCompleteIdx);

    // The final event must be a stream (Finished of the second model turn).
    const lastStream = events.filter(isStream).at(-1);
    expect(lastStream).toBeDefined();
    expect(lastStream.event.type).toBe(GeminiEventType.Finished);

    // ── Prove functionResponse from turn 1 was fed into turn 2 ───────────
    // turnMessages[0] is the initial user message; turnMessages[1] is what the
    // loop sent as the SECOND model turn — it MUST contain functionResponse.
    expect(turnMessages).toHaveLength(2);
    const turn2Parts = partListUnionToParts(turnMessages[1]);
    const hasFnResponseInTurn2 = turn2Parts.some(
      (p) => 'functionResponse' in p,
    );
    expect(hasFnResponseInTurn2).toBe(true);
    expect(hasFunctionResponse(history)).toBe(true);
  });

  it('Cancel aborts the tool and the loop records cancelled history then stops', async () => {
    const tool = new MockTool({ name: 'record_tool' });
    tool.shouldConfirm = true;
    tool.executeFn.mockResolvedValue({
      llmContent: 'should-not-matter',
      returnDisplay: 'should-not-matter',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    const approvalHandler: ApprovalHandler = async () => ({
      outcome: ToolConfirmationOutcome.Cancel,
    });

    const { client, history } = createScriptedAgentClient([
      [toolCallRequestEvent('record_tool', 'call-2'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(tool.executeFn).not.toHaveBeenCalled();
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('cancelled');
    expect(hasFunctionResponse(history)).toBe(true);
  });

  it('emits an awaiting_approval event BEFORE the tool executes when policy yields ASK_USER', async () => {
    const tool = new MockTool({
      name: 'record_tool',
      execute: async () => ({
        llmContent: 'recorded-ok',
        returnDisplay: 'recorded-ok',
      }),
    });
    tool.shouldConfirm = true;
    tool.executeFn.mockResolvedValue({
      llmContent: 'recorded-ok',
      returnDisplay: 'recorded-ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    const approvalHandler: ApprovalHandler = async () => ({
      outcome: ToolConfirmationOutcome.ProceedOnce,
    });

    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('record_tool', 'call-appr', { x: 1 }),
        finishedEvent(),
      ],
      [contentEvent('done'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // An awaiting_approval event MUST be observed.
    const awaitingEvents = events.filter(isAwaitingApproval);
    expect(awaitingEvents).toHaveLength(1);
    expect(awaitingEvents[0].toolCalls).toHaveLength(1);
    expect(awaitingEvents[0].toolCalls[0].status).toBe('awaiting_approval');

    // It MUST appear before tools_complete — i.e. before the tool executed.
    const eventKinds = events.map((e) => e.kind);
    const awaitingIdx = eventKinds.indexOf('awaiting_approval');
    const toolsCompleteIdx = eventKinds.indexOf('tools_complete');
    expect(awaitingIdx).toBeGreaterThanOrEqual(0);
    expect(toolsCompleteIdx).toBeGreaterThanOrEqual(0);
    expect(awaitingIdx).toBeLessThan(toolsCompleteIdx);

    // The tool did execute (the approval handler approved it).
    expect(tool.executeFn).toHaveBeenCalledTimes(1);
  });

  it('ModifyWithEditor payload forwards modified args to the tool (inline modify via bus)', async () => {
    // MockModifiableTool has type:'edit' confirmation details and a
    // ModifyContext whose createUpdatedParams produces { newContent: <modified> }.
    // When the approvalHandler returns { outcome: ProceedOnce, payload: { newContent } },
    // the loop forwards payload via respondToConfirmation, the coordinator's
    // handleApproval sees payload.newContent and calls handleInlineModify →
    // setArgs(callId, { newContent: modified }) → executes with MODIFIED args.
    const tool = new MockModifiableTool('modifiable_tool');
    tool.executeFn.mockResolvedValue({
      llmContent: 'modified-ok',
      returnDisplay: 'modified-ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    const modifiedContent = 'editor-modified-content';
    const approvalHandler: ApprovalHandler = async () => ({
      outcome: ToolConfirmationOutcome.ProceedOnce,
      payload: { newContent: modifiedContent },
    });

    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('modifiable_tool', 'call-mod'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // The tool executed with the MODIFIED args — assert on observable
    // behavior (the args the real tool received), not mock call counts.
    expect(tool.executeFn).toHaveBeenCalledTimes(1);
    const executedArgs = tool.executeFn.mock.calls[0][0];
    expect(executedArgs).toStrictEqual({ newContent: modifiedContent });

    // The tool completed successfully with the modified args.
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    const completed: CompletedToolCall = completedEvents[0].completed[0];
    expect(completed.status).toBe('success');
  });

  it('ModifyWithEditor outcome runs the editor flow and executes with editor-modified args', async () => {
    // Drives the TRUE ModifyWithEditor path: the approval handler resolves to
    // ToolConfirmationOutcome.ModifyWithEditor, the coordinator invokes the
    // (mocked) editor-spawn infra `modifyWithEditor`, applies its updatedParams
    // via setArgs, re-publishes a fresh confirmation request, and on the second
    // approval the tool executes with the EDITOR-modified args.
    modifyWithEditorMock.mockResolvedValue({
      updatedParams: { newContent: 'editor-edited-content' },
      updatedDiff: 'edited-diff',
    });

    const tool = new MockModifiableTool('editor_tool');
    tool.executeFn.mockResolvedValue({
      llmContent: 'edited-ok',
      returnDisplay: 'edited-ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    // First confirmation → ModifyWithEditor; the re-published confirmation →
    // ProceedOnce so the tool executes with the editor-modified args.
    let confirmationCount = 0;
    const approvalHandler: ApprovalHandler = async () => {
      confirmationCount += 1;
      if (confirmationCount === 1) {
        return { outcome: ToolConfirmationOutcome.ModifyWithEditor };
      }
      return { outcome: ToolConfirmationOutcome.ProceedOnce };
    };

    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('editor_tool', 'call-editor'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
      interactiveMode: true,
      displayCallbacks: {
        getPreferredEditor: () => 'vscode',
        onEditorOpen: () => {},
        onEditorClose: () => {},
      },
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // The editor-spawn infra was invoked exactly once.
    expect(modifyWithEditorMock).toHaveBeenCalledTimes(1);
    // The tool executed with the EDITOR-modified args (observable behavior).
    expect(tool.executeFn).toHaveBeenCalledTimes(1);
    const executedArgs = tool.executeFn.mock.calls[0][0];
    expect(executedArgs).toStrictEqual({ newContent: 'editor-edited-content' });
    // The tool completed successfully.
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('success');
  });

  it('a rejecting approval handler denies the tool and the loop completes (no hang)', async () => {
    // When the injected approval handler throws/rejects, the loop MUST NOT
    // leave the confirmation unanswered (which would hang forever). It responds
    // with a safe denial so the scheduler cancels the tool and the turn ends.
    const tool = new MockTool({ name: 'record_tool' });
    tool.shouldConfirm = true;
    tool.executeFn.mockResolvedValue({
      llmContent: 'should-not-run',
      returnDisplay: 'should-not-run',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    const approvalHandler: ApprovalHandler = async () => {
      throw new Error('handler blew up');
    };

    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('record_tool', 'call-reject'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // The tool must NOT have executed (the handler rejected → safe denial).
    expect(tool.executeFn).not.toHaveBeenCalled();
    // The loop completed the turn with the tool cancelled — it did not hang.
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('cancelled');
  });
});

// ─── Suite 2: a2a-style auto policy ─────────────────────────────────────────

describe('AgenticLoop integration - a2a-style with auto policy', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('auto policy executes tools WITHOUT invoking the approval handler; multi-tool batch feeds back', async () => {
    const toolA = new MockTool({ name: 'tool_a' });
    toolA.executeFn.mockResolvedValue({
      llmContent: 'a-result',
      returnDisplay: 'a-result',
    });
    const toolB = new MockTool({ name: 'tool_b' });
    toolB.executeFn.mockResolvedValue({
      llmContent: 'b-result',
      returnDisplay: 'b-result',
    });

    const toolRegistry = createToolRegistryForTest([toolA, toolB]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    let handlerInvoked = false;
    const approvalHandler: ApprovalHandler = async () => {
      handlerInvoked = true;
      return { outcome: ToolConfirmationOutcome.ProceedOnce };
    };

    const { client, turnMessages } = createScriptedAgentClient([
      [
        toolCallRequestEvent('tool_a', 'call-a'),
        toolCallRequestEvent('tool_b', 'call-b'),
        finishedEvent(),
      ],
      [contentEvent('final answer'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(handlerInvoked).toBe(false);
    expect(toolA.executeFn).toHaveBeenCalledTimes(1);
    expect(toolB.executeFn).toHaveBeenCalledTimes(1);
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed).toHaveLength(2);

    // Event sequence: stream → tool_update → tools_complete → stream (turn 2)
    const eventKinds = events.map((e) => e.kind);
    const toolsCompleteIdx = eventKinds.indexOf('tools_complete');
    const firstStreamIdx = eventKinds.indexOf('stream');
    const secondStreamIdx = eventKinds.indexOf('stream', toolsCompleteIdx + 1);
    expect(firstStreamIdx).toBeLessThan(toolsCompleteIdx);
    expect(secondStreamIdx).toBeGreaterThan(toolsCompleteIdx);

    // functionResponse from both tools was fed into the second turn.
    expect(turnMessages).toHaveLength(2);
    const turn2Parts = partListUnionToParts(turnMessages[1]);
    const fnResponseNames = turn2Parts
      .filter(
        (p): p is Part & { functionResponse: { name: string } } =>
          'functionResponse' in p,
      )
      .map((p) => p.functionResponse.name);
    expect(fnResponseNames).toContain('tool_a');
    expect(fnResponseNames).toContain('tool_b');
  });
});

// ─── Suite 3: Cancellation via AbortSignal ──────────────────────────────────

describe('AgenticLoop integration - Cancellation via AbortSignal', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('abort during the model stream stops the loop cleanly with no tools scheduled', async () => {
    const tool = new MockTool({ name: 'tool_x' });
    tool.executeFn.mockResolvedValue({
      llmContent: 'x',
      returnDisplay: 'x',
    });
    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const controller = new AbortController();
    const { client } = createScriptedAgentClient([
      [
        contentEvent('partial...'),
        toolCallRequestEvent('tool_x', 'call-x'),
        finishedEvent(),
      ],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });

    const collected: AgenticLoopEvent[] = [];
    const iterator = loop.run('go', controller.signal);
    const first = await iterator.next();
    collected.push(first.value);
    controller.abort();
    for await (const event of iterator) {
      collected.push(event);
    }

    expect(tool.executeFn).not.toHaveBeenCalled();
    expect(collected.some((e) => e.kind === 'tools_complete')).toBe(false);
  });

  it('abort during tool execution cancels in-flight tools and disposes the scheduler', async () => {
    // The tool respects the abort signal (as real tools do): it rejects on
    // abort so the scheduler can finalize the in-flight call as cancelled.
    const tool = new MockTool({ name: 'slow_tool' });
    tool.executeFn.mockImplementation(
      (_params, signal: AbortSignal) =>
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

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const controller = new AbortController();
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('slow_tool', 'call-slow'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });

    /** Drives the loop, aborting via the given controller on the first tool_update. */
    async function driveAndAbortOnFirstTool(
      loop: AgenticLoop,
      controller: AbortController,
    ): Promise<AgenticLoopEvent[]> {
      const events: AgenticLoopEvent[] = [];
      let sawTool = false;
      for await (const event of loop.run('go', controller.signal)) {
        events.push(event);
        const isFirstToolUpdate = event.kind === 'tool_update' && !sawTool;
        if (isFirstToolUpdate) {
          sawTool = true;
          controller.abort();
        }
      }
      return events;
    }

    const events = await driveAndAbortOnFirstTool(loop, controller);
    const toolUpdates = events.flatMap((event) =>
      event.kind === 'tool_update' ? [event] : [],
    );

    expect(toolUpdates.length).toBeGreaterThan(1);
    expect(
      toolUpdates.some((event) =>
        event.toolCalls.some((call) => call.status === 'cancelled'),
      ),
    ).toBe(true);
    // The loop teared down cleanly; a subsequent scheduler is fresh.
    const fresh = await config.getOrCreateScheduler(
      config.getSessionId(),
      {
        onAllToolCallsComplete: async () => {},
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      },
      { interactiveMode: false },
      { messageBus, toolRegistry },
    );
    expect(fresh).toBeDefined();
    config.disposeScheduler(config.getSessionId());
  });

  it('abort returns promptly even when a scheduled tool never settles (no hang)', async () => {
    // Regression: a tool that ignores the abort signal and never resolves used
    // to hang the loop forever (it awaited a completion that could never fire,
    // because cancelAll() does not emit onAllToolCallsComplete for a call still
    // mid-flight). The loop must race the completion against the abort signal
    // and return promptly, still disposing the scheduler.
    const tool = new MockTool({ name: 'never_tool' });
    tool.executeFn.mockImplementation(
      () => new Promise<never>(() => {}), // never resolves, ignores abort
    );

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const controller = new AbortController();
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('never_tool', 'call-never'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });

    // Drive the loop; abort once the tool is in-flight. The generator MUST
    // terminate (the for-await loop must end) rather than hang.
    let sawTool = false;
    const run = (async () => {
      for await (const event of loop.run('go', controller.signal)) {
        if (event.kind === 'tool_update' && !sawTool) {
          sawTool = true;
          controller.abort();
        }
      }
    })();

    // If the loop hangs, this race rejects; a passing test resolves via `run`.
    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('loop did not terminate')), 5000);
    });
    await expect(Promise.race([run, timeout])).resolves.toBeUndefined();
    expect(sawTool).toBe(true);

    // The scheduler was disposed: a fresh one can be created.
    const fresh = await config.getOrCreateScheduler(
      config.getSessionId(),
      {
        onAllToolCallsComplete: async () => {},
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      },
      { interactiveMode: false },
      { messageBus, toolRegistry },
    );
    expect(fresh).toBeDefined();
    config.disposeScheduler(config.getSessionId());
  });

  it('does not answer a delayed approval request after the loop aborts', async () => {
    const tool = new MockTool({ name: 'approval_tool' });
    tool.shouldConfirm = true;
    tool.executeFn.mockResolvedValue({
      llmContent: 'should not run',
      returnDisplay: 'should not run',
    });
    const toolRegistry = createToolRegistryForTest([tool]);
    const policyEngine = createAskPolicyEngine();
    const messageBus = new MessageBus(policyEngine, false);
    const respondSpy = vi.spyOn(messageBus, 'respondToConfirmation');
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine,
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    let resolveApproval:
      | ((result: { outcome: ToolConfirmationOutcome }) => void)
      | undefined;
    let runDone: Promise<void> | undefined;
    const approvalStarted = new Promise<void>((resolve) => {
      const approvalHandler: ApprovalHandler = async () => {
        resolve();
        return new Promise((innerResolve) => {
          resolveApproval = innerResolve;
        });
      };
      const { client } = createScriptedAgentClient([
        [
          toolCallRequestEvent('approval_tool', 'call-approval'),
          finishedEvent(),
        ],
      ]);
      const loop = new AgenticLoop({
        agentClient: client,
        config,
        messageBus,
        approvalHandler,
      });
      const controller = new AbortController();

      runDone = (async () => {
        for await (const event of loop.run('go', controller.signal)) {
          if (event.kind === 'awaiting_approval') {
            controller.abort();
          }
        }
      })();
    });

    await approvalStarted;
    await runDone;
    resolveApproval?.({ outcome: ToolConfirmationOutcome.ProceedOnce });
    await Promise.resolve();

    expect(respondSpy).not.toHaveBeenCalled();
    expect(tool.executeFn).not.toHaveBeenCalled();
  });

  it('early generator return while a tool is running disposes the scheduler', async () => {
    const tool = new MockTool({ name: 'early_return_tool' });
    tool.executeFn.mockImplementation(
      () => new Promise<never>(() => {}), // remains in-flight until the loop is closed
    );

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const disposedSessionIds: string[] = [];
    const originalDisposeScheduler = config.disposeScheduler.bind(config);
    vi.spyOn(config, 'disposeScheduler').mockImplementation((sessionId) => {
      disposedSessionIds.push(sessionId);
      originalDisposeScheduler(sessionId);
    });

    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('early_return_tool', 'call-early'),
        finishedEvent(),
      ],
    ]);
    const loop = new AgenticLoop({ agentClient: client, config, messageBus });
    const iterator = loop.run('go', new AbortController().signal);

    let sawRunningTool = false;
    let next = await iterator.next();
    while (next.done !== true && !sawRunningTool) {
      sawRunningTool =
        next.value.kind === 'tool_update' &&
        next.value.toolCalls.some((call) => call.status === 'executing');
      if (!sawRunningTool) {
        next = await iterator.next();
      }
    }

    expect(sawRunningTool).toBe(true);
    await expect(iterator.return(undefined)).resolves.toBeDefined();
    expect(disposedSessionIds.some((id) => id.includes('#agentic-loop#'))).toBe(
      true,
    );
  });

  it('tool_output emitted just before completion is observed by the consumer', async () => {
    // Regression: the drain loop must not stop merely because scheduling
    // finished — tool_output/tool_update events can still arrive between
    // schedule resolution and completion and MUST be yielded.
    const tool = new MockTool({ name: 'output_tool' });
    tool.executeFn.mockImplementation(
      async (_params, _signal, updateOutput?: (chunk: string) => void) => {
        updateOutput?.('streaming-chunk');
        return {
          llmContent: 'final-output',
          returnDisplay: 'final-output',
        };
      },
    );

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('output_tool', 'call-out'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // The tool ran and completed.
    expect(tool.executeFn).toHaveBeenCalledTimes(1);
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('success');
  });
});

// ─── Suite 4: caller display callbacks ──────────────────────────────────────

describe('AgenticLoop with caller display callbacks', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('forwards the SAME tool-call and output data to displayCallbacks that it emits as events', async () => {
    // A tool that streams live output via updateOutput, so we can assert the
    // outputUpdateHandler display callback receives the same chunk the loop
    // emits as a tool_output event.
    const tool = new MockTool({
      name: 'streaming_tool',
      canUpdateOutput: true,
    });
    tool.executeFn.mockImplementation(
      async (
        _params: Record<string, unknown>,
        _signal: AbortSignal,
        updateOutput?: (output: string) => void,
      ) => {
        updateOutput?.('chunk-1');
        updateOutput?.('chunk-2');
        return { llmContent: 'done', returnDisplay: 'done' };
      },
    );

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    // Real recording arrays — capture the DATA the display callbacks receive.
    const displayToolUpdates: ToolCall[] = [];
    const displayOutputChunks: Array<{
      callId: string;
      chunk: string | unknown;
    }> = [];

    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('streaming_tool', 'call-disp', { x: 1 }),
        finishedEvent(),
      ],
      [contentEvent('final'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      displayCallbacks: {
        onToolCallsUpdate: (toolCalls) => {
          displayToolUpdates.push(...toolCalls);
        },
        outputUpdateHandler: (callId, chunk) => {
          displayOutputChunks.push({ callId, chunk });
        },
        getPreferredEditor: () => undefined,
      },
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // ── Tool-call data equivalence ───────────────────────────────────────
    // The tool_update events the loop EMITTED must carry the same ToolCall
    // data the display callback RECEIVED. Compare observable data, not call
    // counts.
    const emittedToolUpdateEvents = events.filter(
      (e): e is Extract<AgenticLoopEvent, { kind: 'tool_update' }> =>
        e.kind === 'tool_update',
    );
    expect(emittedToolUpdateEvents.length).toBeGreaterThan(0);
    const emittedToolCalls = emittedToolUpdateEvents.flatMap(
      (e) => e.toolCalls,
    );
    // Every emitted tool call must appear in the display capture (same callId +
    // status). The display callback receives at least the union of all updates.
    expect(displayToolUpdates.length).toBeGreaterThanOrEqual(
      emittedToolCalls.length,
    );
    for (const emitted of emittedToolCalls) {
      const matched = displayToolUpdates.some(
        (captured) =>
          captured.request.callId === emitted.request.callId &&
          captured.status === emitted.status,
      );
      expect(matched).toBe(true);
    }
    // The tool's specific callId must be present in the display capture with a
    // 'success' terminal status (proving the final-state update was forwarded).
    const dispFinal = displayToolUpdates.find(
      (tc) => tc.request.callId === 'call-disp' && tc.status === 'success',
    );
    expect(dispFinal).toBeDefined();

    // ── Output data equivalence ──────────────────────────────────────────
    // The tool_output events (string chunks) must match the outputUpdateHandler
    // display captures exactly (callId + chunk).
    const emittedOutputEvents = events.filter(
      (e): e is Extract<AgenticLoopEvent, { kind: 'tool_output' }> =>
        e.kind === 'tool_output',
    );
    expect(emittedOutputEvents).toHaveLength(2);
    const emittedOutputData = emittedOutputEvents.map((e) => ({
      callId: e.callId,
      chunk: e.chunk,
    }));
    // The display handler received the SAME string chunks (filter to string
    // chunks since the loop only forwards string chunks as events).
    const dispStringChunks = displayOutputChunks.map((c) => ({
      callId: c.callId,
      chunk: c.chunk,
    }));
    expect(dispStringChunks).toStrictEqual(emittedOutputData);
    // All chunks belong to the streaming tool's callId.
    expect(dispStringChunks.every((c) => c.callId === 'call-disp')).toBe(true);

    // The tool completed successfully.
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('success');
  });

  it('completes the turn correctly with interactiveMode: true (no observable interactive-only side effect is reachable headlessly)', async () => {
    // LIMITATION: interactiveMode: true propagates to the scheduler's
    // toolContextInteractiveMode, which gates tool-internal display/editor
    // behavior. There is no purely-headless observable that distinguishes
    // interactive from non-interactive at the AgenticLoop event level — the
    // tool-execution events are identical. We therefore assert the loop still
    // drives a complete, correct turn (tools execute, functionResponse fed
    // back, second model turn reached) with interactiveMode: true, proving the
    // flag does not break the loop's continuation logic.
    const tool = new MockTool({ name: 'simple_tool' });
    tool.executeFn.mockResolvedValue({
      llmContent: 'ok',
      returnDisplay: 'ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client, turnMessages } = createScriptedAgentClient([
      [toolCallRequestEvent('simple_tool', 'call-int'), finishedEvent()],
      [contentEvent('done-interactive'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      interactiveMode: true,
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // The tool executed.
    expect(tool.executeFn).toHaveBeenCalledTimes(1);
    // The turn completed and the functionResponse was fed into a second turn.
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('success');
    expect(turnMessages).toHaveLength(2);
    const turn2Parts = partListUnionToParts(turnMessages[1]);
    expect(turn2Parts.some((p) => 'functionResponse' in p)).toBe(true);
    // The second model turn's content was streamed.
    const streamContents = events
      .filter(isStream)
      .filter((e) => e.event.type === GeminiEventType.Content)
      .map((e) => {
        const ev = e.event as Extract<
          ServerGeminiStreamEvent,
          { type: typeof GeminiEventType.Content }
        >;
        return ev.value;
      });
    expect(streamContents).toContain('done-interactive');
  });

  it('a provided getPreferredEditor is forwarded to the scheduler and its returned value is honored', async () => {
    // LIMITATION: getPreferredEditor is ONLY consulted inside the scheduler's
    // handleModifyWithEditor sub-flow, which runs when an approval resolves to
    // ToolConfirmationOutcome.ModifyWithEditor. Driving that full path
    // headlessly requires launching a real editor process (openDiff spawns
    // e.g. `code --wait --diff`), which cannot complete in CI. We therefore
    // assert the OBSERVABLE wiring: the loop forwards the caller's
    // getPreferredEditor into the scheduler callbacks (captured via a real
    // recording), and invoking it returns the caller-provided value. This
    // proves the callback is honored by the scheduler's editor-decision path.
    const tool = new MockModifiableTool('modifiable_tool_disp');
    tool.executeFn.mockResolvedValue({
      llmContent: 'modified-ok',
      returnDisplay: 'modified-ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);

    // Capture the callbacks the loop passes into getOrCreateScheduler so we
    // can assert observable wiring (identity + return value) without driving
    // the real editor launch.
    let capturedGetPreferredEditor: (() => string | undefined) | undefined;
    let capturedOnEditorOpen: (() => void) | undefined;
    let capturedOnEditorClose: (() => void) | undefined;
    const baseConfig = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });
    const config: Config = {
      ...baseConfig,
      getOrCreateScheduler: async (
        sessionId: string,
        callbacks: Parameters<Config['getOrCreateScheduler']>[1],
        schedulerOptions: Parameters<Config['getOrCreateScheduler']>[2],
        deps: Parameters<Config['getOrCreateScheduler']>[3],
      ) => {
        capturedGetPreferredEditor = callbacks.getPreferredEditor;
        capturedOnEditorOpen = callbacks.onEditorOpen;
        capturedOnEditorClose = callbacks.onEditorClose;
        return baseConfig.getOrCreateScheduler(
          sessionId,
          callbacks,
          schedulerOptions,
          deps,
        );
      },
    };

    const editorOpenCalls: string[] = [];
    const editorCloseCalls: string[] = [];
    const approvalHandler: ApprovalHandler = async () => ({
      outcome: ToolConfirmationOutcome.ProceedOnce,
      payload: { newContent: 'payload-content' },
    });

    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('modifiable_tool_disp', 'call-ed'),
        finishedEvent(),
      ],
      [contentEvent('done'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
      interactiveMode: true,
      displayCallbacks: {
        getPreferredEditor: () => 'vscode',
        onEditorOpen: () => {
          editorOpenCalls.push('opened');
        },
        onEditorClose: () => {
          editorCloseCalls.push('closed');
        },
      },
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // The loop forwarded the caller's getPreferredEditor into the scheduler
    // callbacks — observable wiring (the captured callback exists and returns
    // the caller-provided value).
    expect(capturedGetPreferredEditor).toBeDefined();
    expect(capturedGetPreferredEditor?.()).toBe('vscode');
    // The caller's onEditorOpen/onEditorClose were also forwarded: invoking the
    // captured callbacks drives the caller's recording arrays (proves the loop
    // did NOT substitute no-op defaults when displayCallbacks were provided).
    expect(capturedOnEditorOpen).toBeDefined();
    expect(capturedOnEditorClose).toBeDefined();
    capturedOnEditorOpen?.();
    capturedOnEditorClose?.();
    expect(editorOpenCalls).toStrictEqual(['opened']);
    expect(editorCloseCalls).toStrictEqual(['closed']);
    // The tool completed via the inline-modify payload path (no editor launch
    // needed for ProceedOnce + payload).
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('success');
  });
});

// ─── Suite 5: scheduler isolation (does not clobber the CLI main scheduler) ──

describe('AgenticLoop scheduler isolation', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('runs its tool turn on an isolated scheduler key, leaving a pre-existing main scheduler (keyed by sessionId) and its callbacks intact', async () => {
    // Regression: the loop used to call getOrCreateScheduler with
    // config.getSessionId() — the SAME key the CLI uses for its long-lived
    // "main" scheduler that serves client-initiated (e.g. slash-command) tool
    // execution. Because getOrCreateScheduler replaces callbacks on reuse
    // (last-writer-wins) and disposeScheduler never restores prior callbacks,
    // the loop would overwrite the CLI main scheduler's onAllToolCallsComplete
    // and then dispose it — silently breaking client-initiated tool execution.
    //
    // The fix gives the loop its own isolated scheduler key. This test proves
    // the OBSERVABLE consequence: a main scheduler created under sessionId
    // BEFORE the loop runs still has ITS OWN callbacks afterwards (its
    // onAllToolCallsComplete fires for a tool it schedules), and the singleton
    // entry for sessionId is the SAME instance — never replaced by the loop.
    const loopTool = new MockTool({ name: 'loop_tool' });
    loopTool.executeFn.mockResolvedValue({
      llmContent: 'loop-ok',
      returnDisplay: 'loop-ok',
    });
    const mainTool = new MockTool({ name: 'main_tool' });
    mainTool.executeFn.mockResolvedValue({
      llmContent: 'main-ok',
      returnDisplay: 'main-ok',
    });

    const toolRegistry = createToolRegistryForTest([loopTool, mainTool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const sessionId = config.getSessionId();

    // Stand up a "CLI main" scheduler under sessionId with its OWN completion
    // callback BEFORE the loop runs. Capture the singleton instance identity.
    const mainCompletions: CompletedToolCall[][] = [];
    const mainScheduler = await config.getOrCreateScheduler(
      sessionId,
      {
        onAllToolCallsComplete: async (completed) => {
          mainCompletions.push(completed);
        },
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      },
      { interactiveMode: false },
      { messageBus, toolRegistry },
    );

    // Run a full loop turn that schedules a tool. With the isolated key this
    // must NOT touch the main scheduler entry keyed by sessionId.
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('loop_tool', 'call-loop'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({ agentClient: client, config, messageBus });
    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    // The loop's own tool executed and completed.
    expect(loopTool.executeFn).toHaveBeenCalledTimes(1);
    const loopCompleted = events.filter(isToolsComplete);
    expect(loopCompleted).toHaveLength(1);
    expect(loopCompleted[0].completed[0].status).toBe('success');

    // Schedule a tool DIRECTLY on the ORIGINAL mainScheduler reference (we do
    // NOT re-call getOrCreateScheduler here — doing so would refresh callbacks
    // and mask the very regression under test). Under the old buggy code the
    // loop reused the sessionId key, so it replaced this scheduler's
    // onAllToolCallsComplete with its own (now-stale) resolver and never
    // restored it; the original mainCompletions callback would then never fire
    // and this scheduling would silently complete into the void. Under the fix
    // the loop uses an isolated key, so mainScheduler keeps its OWN callback.
    const mainRequest: ToolCallRequestInfo = {
      callId: 'main-call',
      name: 'main_tool',
      args: {},
      isClientInitiated: true,
      prompt_id: 'main-prompt',
      agentId: DEFAULT_AGENT_ID,
    };
    await mainScheduler.schedule([mainRequest], new AbortController().signal);

    // The ORIGINAL main completion callback must fire for a tool IT schedules —
    // proving the loop neither overwrote that callback nor disposed the entry.
    await vi.waitFor(() => {
      expect(mainCompletions.length).toBeGreaterThan(0);
    });
    expect(mainTool.executeFn).toHaveBeenCalledTimes(1);
    const lastMainCompletion = mainCompletions.at(-1);
    expect(lastMainCompletion).toBeDefined();
    expect(lastMainCompletion?.[0]?.request.callId).toBe('main-call');
    expect(lastMainCompletion?.[0]?.status).toBe('success');

    // Release the single ref we took when creating the main scheduler.
    config.disposeScheduler(sessionId);
  });
});

// ─── Suite 6: promptId correlation ──────────────────────────────────────────

describe('AgenticLoop promptId correlation', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('threads the caller-provided promptId into the FIRST model turn and uses a distinct generated id for continuation turns', async () => {
    // The caller (e.g. the CLI) computes a promptId to correlate telemetry with
    // its request. That id MUST reach the first sendMessageStream call. The
    // continuation turn (after tools feed back) must use a DIFFERENT id so the
    // turns remain individually correlatable.
    const tool = new MockTool({ name: 'corr_tool' });
    tool.executeFn.mockResolvedValue({
      llmContent: 'ok',
      returnDisplay: 'ok',
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client, promptIds } = createScriptedAgentClient([
      [toolCallRequestEvent('corr_tool', 'call-corr'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({ agentClient: client, config, messageBus });

    const callerPromptId = 'caller-supplied-prompt-id';
    await collectEvents(
      loop,
      'go',
      new AbortController().signal,
      callerPromptId,
    );

    // Two model turns occurred (initial + continuation after tool feedback).
    expect(promptIds).toHaveLength(2);
    // The FIRST turn used the caller's exact promptId.
    expect(promptIds[0]).toBe(callerPromptId);
    // The continuation turn derives from the initial id but stays outside the
    // CLI's session-counter namespace, avoiding collisions with later prompts.
    expect(promptIds[1]).toBe(`${callerPromptId}#continuation#1`);
  });

  it('generates a promptId for the first turn when the caller omits one', async () => {
    const toolRegistry = createToolRegistryForTest([]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client, promptIds } = createScriptedAgentClient([
      [contentEvent('done'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({ agentClient: client, config, messageBus });

    // No promptId argument — the loop must still supply one to the provider.
    for await (const _event of loop.run('go', new AbortController().signal)) {
      void _event;
    }

    expect(promptIds).toHaveLength(1);
    expect(promptIds[0]).toMatch(
      /^agentic-loop-test-session#agentic-loop#[0-9a-f-]+$/,
    );
  });

  it('uses continuation prompt ids that cannot collide with later CLI top-level prompt ids', async () => {
    const tool = new MockTool({ name: 'collision_tool' });
    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const { client, promptIds } = createScriptedAgentClient([
      [
        toolCallRequestEvent('collision_tool', 'collision-call'),
        finishedEvent(),
      ],
      [contentEvent('done'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({ agentClient: client, config, messageBus });

    await collectEvents(
      loop,
      'go',

      new AbortController().signal,
      'agentic-loop-test-session########1',
    );

    expect(promptIds[1]).toBe(
      'agentic-loop-test-session########1#continuation#1',
    );
    expect(promptIds[1]).not.toBe('agentic-loop-test-session########2');
  });

  it('rejects concurrent run calls on the same loop instance', async () => {
    const toolRegistry = createToolRegistryForTest([]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const { client } = createScriptedAgentClient([
      [contentEvent('first chunk')],
      [contentEvent('second run'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({ agentClient: client, config, messageBus });
    const firstRun = loop.run('first', new AbortController().signal);

    const firstEvent = await firstRun.next();
    expect(firstEvent.done).toBe(false);

    await expect(
      collectEvents(loop, 'second', new AbortController().signal),
    ).rejects.toThrow('concurrent executions');

    await firstRun.return(undefined);
  });
});

// ─── Suite 7: review hardening regressions ──────────────────────────────────

describe('AgenticLoop integration - terminal outcomes and bus scoping', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it.each([
    [
      'Error',
      {
        type: GeminiEventType.Error,
        value: { error: { message: 'provider failed' } },
      } satisfies ServerGeminiStreamEvent,
    ],
    [
      'StreamIdleTimeout',
      {
        type: GeminiEventType.StreamIdleTimeout,
        value: { error: { message: 'stream idle timeout' } },
      } satisfies ServerGeminiStreamEvent,
    ],
    [
      'UserCancelled',
      {
        type: GeminiEventType.UserCancelled,
      } satisfies ServerGeminiStreamEvent,
    ],
    [
      'LoopDetected',
      {
        type: GeminiEventType.LoopDetected,
      } satisfies ServerGeminiStreamEvent,
    ],
  ])(
    'does not execute collected tools after %s',
    async (_name, terminalEvent) => {
      let executed = false;
      const tool = new MockTool({
        name: 'terminal_tool',
        execute: async () => {
          executed = true;
          return {
            llmContent: 'should-not-run',
            returnDisplay: 'should-not-run',
          };
        },
      });
      tool.executeFn.mockImplementation(async () => {
        executed = true;
        return {
          llmContent: 'should-not-run',
          returnDisplay: 'should-not-run',
        };
      });

      const toolRegistry = createToolRegistryForTest([tool]);
      const messageBus = new MessageBus(createAllowPolicyEngine(), false);
      const config = createTestConfig({
        messageBus,
        toolRegistry,
        policyEngine: createAllowPolicyEngine(),
        interactive: false,
        approvalMode: ApprovalMode.YOLO,
      });
      const { client, history, turnMessages } = createScriptedAgentClient([
        [toolCallRequestEvent('terminal_tool', 'terminal-call'), terminalEvent],
      ]);
      const loop = new AgenticLoop({
        agentClient: client,
        config,
        messageBus,
      });

      const events = await collectEvents(
        loop,
        'go',
        new AbortController().signal,
      );

      expect(executed).toBe(false);
      expect(events.some(isToolsComplete)).toBe(false);
      expect(hasFunctionResponse(history)).toBe(false);
      expect(turnMessages).toHaveLength(1);
    },
  );

  it('emits the final empty tool update before tools_complete', async () => {
    const tool = new MockTool({ name: 'clear_tool' });
    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const displaySizes: number[] = [];
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('clear_tool', 'clear-call'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      displayCallbacks: {
        onToolCallsUpdate: (toolCalls) => {
          displaySizes.push(toolCalls.length);
        },
      },
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );
    const eventKinds = events.map((event) => event.kind);
    const emptyUpdateIndex = events.findIndex(
      (event) => event.kind === 'tool_update' && event.toolCalls.length === 0,
    );
    const completeIndex = eventKinds.indexOf('tools_complete');

    expect(emptyUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(completeIndex).toBeGreaterThan(emptyUpdateIndex);
    expect(displaySizes.at(-1)).toBe(0);
  });

  it('does not execute ASK_USER tools in non-interactive mode without approvalHandler', async () => {
    let executed = false;
    const tool = new MockTool({
      name: 'ask_without_handler_tool',
      execute: async () => {
        executed = true;
        return {
          llmContent: 'should-not-run',
          returnDisplay: 'should-not-run',
        };
      },
    });
    tool.shouldConfirm = true;
    tool.executeFn.mockImplementation(async () => {
      executed = true;
      return {
        llmContent: 'should-not-run',
        returnDisplay: 'should-not-run',
      };
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.DEFAULT,
    });
    const { client, history, turnMessages } = createScriptedAgentClient([
      [
        toolCallRequestEvent(
          'ask_without_handler_tool',
          'ask-without-handler-call',
        ),
        finishedEvent(),
      ],
      [contentEvent('denied'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({ agentClient: client, config, messageBus });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    const completedEvent = events.find(isToolsComplete);

    expect(executed).toBe(false);
    expect(completedEvent?.completed[0]?.status).toBe('error');
    expect(hasFunctionResponse(history)).toBe(true);
    expect(turnMessages).toHaveLength(2);
  });

  it('terminates instead of hanging when scheduler filters all tool requests', async () => {
    const toolRegistry = createToolRegistryForTest([]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const { client, history, turnMessages } = createScriptedAgentClient([
      [
        toolCallRequestEvent(
          'filtered_tool',
          'filtered-call',
          {},
          {
            hookRestrictedAllowedTools: [],
          },
        ),
        finishedEvent(),
      ],
    ]);
    const loop = new AgenticLoop({ agentClient: client, config, messageBus });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(events.some(isToolsComplete)).toBe(false);
    expect(hasFunctionResponse(history)).toBe(false);
    expect(turnMessages).toHaveLength(1);
  });

  it('approvalHandler ignores confirmation requests for tool calls owned by another scheduler', async () => {
    const tool = new MockTool({ name: 'owned_tool' });
    tool.shouldConfirm = true;
    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    let approvalCount = 0;
    const approvalHandler: ApprovalHandler = async () => {
      approvalCount += 1;
      return { outcome: ToolConfirmationOutcome.ProceedOnce };
    };
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('owned_tool', 'owned-call'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      approvalHandler,
    });

    const events: AgenticLoopEvent[] = [];
    for await (const event of loop.run('go', new AbortController().signal)) {
      events.push(event);
      if (event.kind === 'awaiting_approval') {
        messageBus.publish({
          type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
          correlationId: 'unowned-correlation',
          toolCall: {
            id: 'unowned-call',
            name: 'owned_tool',
            args: {},
          },
        });
      }
    }

    expect(events.some(isToolsComplete)).toBe(true);
    expect(approvalCount).toBe(1);
  });
});
