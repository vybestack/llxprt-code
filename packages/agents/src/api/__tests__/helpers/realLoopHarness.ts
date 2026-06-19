/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P10
 * @requirement:REQ-003
 *
 * Real-loop drivers for the event-characterization harness. Drives a REAL
 * AgenticLoop with a REAL CoreToolScheduler / MessageBus / MockTool and
 * collects the emitted AgenticLoopEvents, plus a FakeProvider content→loop
 * projection. Extracted from eventHarness.ts to keep that file under the
 * max-lines budget. No mock theater — every driver exercises real production
 * code paths.
 *
 * Deep imports of core/providers/tools types are expected here — this file
 * lives under __tests__/helpers/ which is excluded from the P09 boundary scan.
 */

import { type Content, type Part, type PartListUnion } from '@google/genai';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import {
  PerformCompressionResult,
  type ServerGeminiStreamEvent,
} from '@vybestack/llxprt-code-core/core/turn.js';
import type { AgenticLoopEvent } from '../../../core/agenticLoop/types.js';
import { AgenticLoop } from '../../../core/agenticLoop/AgenticLoop.js';
import { CoreToolScheduler } from '../../../core/coreToolScheduler.js';
import {
  getOrCreateScheduler,
  disposeScheduler,
  clearAllSchedulers,
} from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import type {
  AgentClientContract,
  AgentChatContract,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { ApprovalHandler } from '../../../core/agenticLoop/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  wrapStream,
  streamContent,
  streamFinished,
  streamToolCallRequest,
} from './eventHarness.js';

// ─── Real FakeProvider content → loop events ────────────────────────────────

/**
 * Uses a REAL FakeProvider to read the JSONL fixture, consumes its IContent
 * stream, and maps text blocks to Content ServerGeminiStreamEvents wrapped as
 * stream-kind AgenticLoopEvents. This proves the Content→text projection
 * originates from real provider fixture data, not a hand-crafted event.
 */
export async function fakeProviderContentLoopEvents(
  fixturePath: string,
  cwd?: string,
): Promise<AgenticLoopEvent[]> {
  const provider = new FakeProvider(fixturePath, cwd);
  const events: AgenticLoopEvent[] = [];
  for await (const iContent of provider.generateChatCompletion([])) {
    for (const block of iContent.blocks) {
      if (block.type === 'text') {
        events.push(wrapStream(streamContent(block.text)));
      }
    }
  }
  return events;
}

// ─── Real-loop driver (mirrors agenticLoop.integration.test.ts) ─────────────
// Drives a REAL AgenticLoop with a REAL CoreToolScheduler/MessageBus/MockTool
// and COLLECTS emitted AgenticLoopEvents. Used for the scheduler/abort rows
// that must exercise the real tool-execution continuation path.

function partListUnionToParts(req: PartListUnion): Part[] {
  if (Array.isArray(req)) {
    return req as Part[];
  }
  if (typeof req === 'string') {
    return [{ text: req }];
  }
  return [req];
}

type TurnScript = ServerGeminiStreamEvent[];

interface ScriptedClient {
  readonly client: AgentClientContract;
}

function createScriptedAgentClient(scripts: TurnScript[]): ScriptedClient {
  const scriptQueue = [...scripts];
  const history: Content[] = [];
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
    recordCompletedToolCalls: () => {},
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
    ): AsyncGenerator<ServerGeminiStreamEvent> {
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
  return { client };
}

function narrowConfig(fixture: Record<string, unknown>): Config {
  return fixture as unknown as Config;
}

function narrowToolRegistry(fixture: Record<string, unknown>): ToolRegistry {
  return fixture as unknown as ToolRegistry;
}

function createTestConfig(opts: {
  messageBus: MessageBus;
  toolRegistry: ToolRegistry;
  policyEngine: PolicyEngine;
}): Config {
  const { messageBus, toolRegistry, policyEngine } = opts;
  const fixture = {
    getSessionId: () => 'p10-harness-session',
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    getApprovalMode: () => ApprovalMode.DEFAULT,
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
    isInteractive: () => true,
    getNonInteractive: () => false,
    getToolSchedulerFactory:
      () =>
      (
        o: ConstructorParameters<typeof CoreToolScheduler>[0],
      ): CoreToolScheduler =>
        new CoreToolScheduler(o),
    getOrCreateScheduler: (
      sessionId: string,
      callbacks: Parameters<Config['getOrCreateScheduler']>[1],
      schedulerOptions: Parameters<Config['getOrCreateScheduler']>[2],
      deps: Parameters<Config['getOrCreateScheduler']>[3],
    ) =>
      getOrCreateScheduler(
        narrowConfig(fixture),
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
  return narrowConfig(fixture);
}

function createToolRegistry(tools: MockTool[]): ToolRegistry {
  const toolMap = new Map<string, MockTool>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }
  return narrowToolRegistry({
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
  });
}

function createAskPolicyEngine(): PolicyEngine {
  return new PolicyEngine({
    rules: [],
    defaultDecision: PolicyDecision.ASK_USER,
    nonInteractive: false,
  });
}

function createAllowPolicyEngine(): PolicyEngine {
  return new PolicyEngine({
    rules: [],
    defaultDecision: PolicyDecision.ALLOW,
    nonInteractive: false,
  });
}

/**
 * Drives a real AgenticLoop that executes a tool to completion (ASK_USER policy
 * + ProceedOnce approval), collecting the emitted AgenticLoopEvents. This
 * exercises the real scheduler continuation: stream(ToolCallRequest) →
 * awaiting_approval → tool_update → tools_complete → stream(continuation).
 */
export async function runRealLoopExecuteTool(): Promise<
  readonly AgenticLoopEvent[]
> {
  clearAllSchedulers();
  try {
    const tool = new MockTool({
      name: 'harness_tool',
      execute: async () => ({
        llmContent: 'tool-output',
        returnDisplay: 'tool-output',
      }),
    });
    tool.shouldConfirm = true;
    tool.executeFn.mockResolvedValue({
      llmContent: 'tool-output',
      returnDisplay: 'tool-output',
    });
    const toolRegistry = createToolRegistry([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
    });
    const approvalHandler: ApprovalHandler = async () => ({
      outcome: ToolConfirmationOutcome.ProceedOnce,
    });
    const { client } = createScriptedAgentClient([
      [
        streamToolCallRequest('call-real', 'harness_tool', { x: 1 }),
        streamFinished(),
      ],
      [streamContent('done'), streamFinished()],
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
    }
    return events;
  } finally {
    clearAllSchedulers();
  }
}

/**
 * Drives a real AgenticLoop and aborts mid-stream via a real AbortSignal after
 * the first event. This exercises the real abort path; the loop terminates
 * without scheduling tools. Returns the collected AgenticLoopEvents.
 */
export async function runRealLoopAbort(): Promise<readonly AgenticLoopEvent[]> {
  clearAllSchedulers();
  try {
    const tool = new MockTool({ name: 'abort_tool' });
    const toolRegistry = createToolRegistry([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
    });
    const controller = new AbortController();
    const { client } = createScriptedAgentClient([
      [streamContent('partial...'), streamFinished()],
    ]);
    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });
    const events: AgenticLoopEvent[] = [];
    const iterator = loop.run('go', controller.signal);
    const first = await iterator.next();
    if (first.done !== true) {
      events.push(first.value);
    }
    controller.abort();
    for await (const event of iterator) {
      events.push(event);
    }
    return events;
  } finally {
    clearAllSchedulers();
  }
}
