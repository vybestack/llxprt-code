/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for agenticLoop integration test files. Extracted from the
 * original monolithic agenticLoop.integration.test.ts so no file-level
 * max-lines disable is needed.
 *
 * The loop, CoreToolScheduler, and ConfirmationCoordinator are REAL. The only
 * mock boundary is the provider stream (an AgentClientContract whose
 * sendMessageStream yields scripted ServerGeminiStreamEvents) — this mirrors
 * mocking the LLM provider, which is infrastructure. Tool implementations use
 * the real MockTool infra (the actual tool the scheduler invokes).
 */

import { FinishReason } from '@google/genai';
import { vi } from 'vitest';
import { CoreToolScheduler } from '../../coreToolScheduler.js';
import type { AgenticLoop } from '../AgenticLoop.js';
import type { ApprovalHandler, AgenticLoopEvent } from '../types.js';
import type { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import {
  getOrCreateScheduler,
  disposeScheduler,
} from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
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
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
/**
 * A single model turn script: a list of ServerGeminiStreamEvents the fake
 * provider emits for that turn.
 */
export type TurnScript = ServerGeminiStreamEvent[];

/** Converts a PartListUnion into a Part[] (string → [{text}]). */
export function partListUnionToParts(req: PartListUnion): Part[] {
  if (Array.isArray(req)) {
    return req as Part[];
  }
  if (typeof req === 'string') {
    return [{ text: req }];
  }
  return [req];
}

/** Shared mutable state for a scripted agent client. */
interface ScriptedClientState {
  scriptQueue: TurnScript[];
  history: Content[];
  turnMessages: PartListUnion[];
  promptIds: string[];
  recordedToolCalls: CompletedToolCall[][];
}

/** Builds the AgentChatContract backed by the given mutable state. */
function buildScriptedChat(state: ScriptedClientState): AgentChatContract {
  const { history, recordedToolCalls } = state;
  return {
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
}

/** Builds the AgentClientContract that streams scripted events. */
function buildScriptedClient(state: ScriptedClientState): AgentClientContract {
  const { scriptQueue, history, turnMessages, promptIds } = state;
  const chat = buildScriptedChat(state);
  return {
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
}

/**
 * Creates an AgentClientContract whose sendMessageStream pops one TurnScript
 * per call from a queue. History is recorded in a real array. The
 * `turnMessages` array captures the PartListUnion received on each turn so
 * tests can assert that functionResponse parts from a prior turn were fed
 * into a later turn.
 */
export function createScriptedAgentClient(scripts: TurnScript[]): {
  client: AgentClientContract;
  history: Content[];
  turnMessages: PartListUnion[];
  promptIds: string[];
  recordedToolCalls: CompletedToolCall[][];
} {
  const state: ScriptedClientState = {
    scriptQueue: [...scripts],
    history: [],
    turnMessages: [],
    promptIds: [],
    recordedToolCalls: [],
  };
  return {
    client: buildScriptedClient(state),
    history: state.history,
    turnMessages: state.turnMessages,
    promptIds: state.promptIds,
    recordedToolCalls: state.recordedToolCalls,
  };
}

/** Builds a ToolCallRequest stream event. */
export function toolCallRequestEvent(
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
export function contentEvent(text: string): ServerGeminiStreamEvent {
  return { type: GeminiEventType.Content, value: text };
}

/** Builds a Finished stream event. */
export function finishedEvent(): ServerGeminiStreamEvent {
  return {
    type: GeminiEventType.Finished,
    value: { reason: FinishReason.STOP },
  };
}

/**
 * Narrows the test fixture to Config. Config is a large class with many
 * methods unrelated to the scheduler lifecycle exercised here; fully
 * instantiating it would require dozens of irrelevant dependencies. This is a
 * test-only boundary — the fixture provides real, correctly-typed lambdas for
 * every method the loop actually calls.
 */
function testBoundaryConfig(fixture: Record<string, unknown>): Config {
  return fixture as unknown as Config;
}

/**
 * Builds a real-ish Config wired to the scheduler singleton with a REAL
 * CoreToolScheduler factory.
 */
export function createTestConfig(options: {
  messageBus: MessageBus;
  toolRegistry: ToolRegistry;
  policyEngine: PolicyEngine;
  interactive: boolean;
  approvalMode?: ApprovalMode;
}): Config {
  const { messageBus, toolRegistry, policyEngine, interactive } = options;
  const approvalMode = options.approvalMode ?? ApprovalMode.YOLO;

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
 * Narrows the test fixture to ToolRegistry.
 */
function testBoundaryToolRegistry(
  fixture: Record<string, unknown>,
): ToolRegistry {
  return fixture as unknown as ToolRegistry;
}

/** Builds a ToolRegistry fixture backed by a name→tool map. */
export function createToolRegistryForTest(tools: MockTool[]): ToolRegistry {
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

export function createAllowPolicyEngine(): PolicyEngine {
  return new PolicyEngine({
    rules: [],
    defaultDecision: PolicyDecision.ALLOW,
    nonInteractive: false,
  });
}

export function createAskPolicyEngine(): PolicyEngine {
  return new PolicyEngine({
    rules: [],
    defaultDecision: PolicyDecision.ASK_USER,
    nonInteractive: false,
  });
}

/** Collects all events from running the loop to completion. */
export async function collectEvents(
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

export function isToolsComplete(
  e: AgenticLoopEvent,
): e is Extract<AgenticLoopEvent, { kind: 'tools_complete' }> {
  return e.kind === 'tools_complete';
}

export function isStream(
  e: AgenticLoopEvent,
): e is Extract<AgenticLoopEvent, { kind: 'stream' }> {
  return e.kind === 'stream';
}

export function isAwaitingApproval(
  e: AgenticLoopEvent,
): e is Extract<AgenticLoopEvent, { kind: 'awaiting_approval' }> {
  return e.kind === 'awaiting_approval';
}

/** Extracts the functionResponse parts from a Content[] history. */
export function functionResponseParts(history: Content[]): Part[] {
  return history
    .filter((h) => h.role === 'user')
    .flatMap((h) => h.parts)
    .filter(
      (p): p is Part & { functionResponse: unknown } =>
        !!p && 'functionResponse' in p,
    );
}

/** True when any part in history is a functionResponse. */
export function hasFunctionResponse(history: Content[]): boolean {
  return functionResponseParts(history).length > 0;
}

// Re-export types used by test files for convenience.
export type {
  ApprovalHandler,
  AgenticLoopEvent,
  Content,
  PartListUnion,
  Config,
  ToolRegistry,
  CompletedToolCall,
  ToolCallRequestInfo,
  ServerGeminiStreamEvent,
};

export { GeminiEventType, DEFAULT_AGENT_ID, vi };
