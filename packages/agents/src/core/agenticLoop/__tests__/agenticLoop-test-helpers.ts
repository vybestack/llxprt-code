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
 * sendMessageStream yields scripted ServerAgentStreamEvents) — this mirrors
 * mocking the LLM provider, which is infrastructure. Tool implementations use
 * the real MockTool infra (the actual tool the scheduler invokes).
 */

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
  AgentEventType,
  DEFAULT_AGENT_ID,
  PerformCompressionResult,
  type ToolCallRequestInfo,
  type ServerAgentStreamEvent,
} from '@vybestack/llxprt-code-core/core/turn.js';
import type {
  AgentChatContract,
  AgentClientContract,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AgentRequestInput } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import { emptyModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { convertPartListUnionToIContent } from '../../MessageConverter.js';
/**
 * A single model turn script: a list of ServerAgentStreamEvents the fake
 * provider emits for that turn.
 */
export type TurnScript = ServerAgentStreamEvent[];

/** Converts an AgentRequestInput into a ContentBlock[] (string → [{text}]). */
export function partListUnionToParts(req: AgentRequestInput): ContentBlock[] {
  if (typeof req === 'string') {
    return [{ type: 'text', text: req }];
  }
  if (Array.isArray(req)) {
    if (req.length > 0 && typeof req[0] === 'object' && 'blocks' in req[0]) {
      return (req as IContent[]).flatMap((c) => c.blocks);
    }
    return req as ContentBlock[];
  }
  // Single IContent — flatten to its blocks.
  if (typeof req === 'object' && 'blocks' in req) {
    return req.blocks;
  }
  return [];
}

/** Shared mutable state for a scripted agent client. */
interface ScriptedClientState {
  scriptQueue: TurnScript[];
  history: IContent[];
  turnMessages: AgentRequestInput[];
  promptIds: string[];
  recordedToolCalls: CompletedToolCall[][];
}

/** Builds the AgentChatContract backed by the given mutable state. */
function buildScriptedChat(state: ScriptedClientState): AgentChatContract {
  const { history, recordedToolCalls } = state;
  return {
    sendMessage: async () => emptyModelOutput(),
    sendMessageStream: async () => {
      async function* emptyStream() {}
      return emptyStream();
    },
    generateDirectMessage: async () => emptyModelOutput(),
    getHistory: () => history,
    setHistory: (nextHistory: IContent[]) => {
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
    storeHistoryForLaterUse: (h: IContent[]) => history.push(...h),
    dispose: () => {},
    setTools: async () => {},
    clearTools: () => {},
    updateSystemInstruction: async () => {},
    addHistory: async (content: IContent) => {
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
      req: AgentRequestInput,
      signal: AbortSignal,
      promptId: string,
    ): AsyncGenerator<ServerAgentStreamEvent> {
      turnMessages.push(req);
      promptIds.push(promptId);
      history.push(convertPartListUnionToIContent(req));
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
  history: IContent[];
  turnMessages: AgentRequestInput[];
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
): ServerAgentStreamEvent {
  const value: ToolCallRequestInfo = {
    callId,
    name,
    args,
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
    ...overrides,
  };
  return { type: AgentEventType.ToolCallRequest, value };
}

/** Builds a Content stream event. */
export function contentEvent(text: string): ServerAgentStreamEvent {
  return { type: AgentEventType.Content, value: text };
}

/** Builds a Finished stream event. */
export function finishedEvent(): ServerAgentStreamEvent {
  return {
    type: AgentEventType.Finished,
    value: { reason: 'stop' },
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
    ) => {
      const schedulerMessageBus = deps?.messageBus;
      if (!schedulerMessageBus) {
        throw new Error(
          'Test config requires an explicit scheduler MessageBus dependency.',
        );
      }
      return getOrCreateScheduler(
        testBoundaryConfig(fixture),
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
  message: AgentMessageInput,
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

export function isToolOutput(
  e: AgenticLoopEvent,
): e is Extract<AgenticLoopEvent, { kind: 'tool_output' }> {
  return e.kind === 'tool_output';
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

/** Extracts the tool-response blocks from an IContent[] history. */
export function functionResponseParts(history: IContent[]): ContentBlock[] {
  return history
    .filter((h) => h.speaker === 'tool')
    .flatMap((h) => h.blocks)
    .filter((b) => b.type === 'tool_response');
}

/** True when any block in history is a tool response. */
export function hasFunctionResponse(history: IContent[]): boolean {
  return history.some(
    (h) =>
      h.speaker === 'tool' && h.blocks.some((b) => b.type === 'tool_response'),
  );
}

// Re-export types used by test files for convenience.
export type {
  ApprovalHandler,
  AgenticLoopEvent,
  AgentRequestInput,
  Config,
  ToolRegistry,
  CompletedToolCall,
  ToolCallRequestInfo,
  ServerAgentStreamEvent,
};

export { AgentEventType, DEFAULT_AGENT_ID, vi };
