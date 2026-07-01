/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FinishReason } from '@google/genai';
import { act } from 'react';
import { renderHook } from '../../../../test-utils/render.js';
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
} from '@vybestack/llxprt-code-core';
import type { PartListUnion, Content, Part } from '@google/genai';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';

function toParts(req: PartListUnion): Part[] {
  if (typeof req === 'string') return [{ text: req }];
  if (Array.isArray(req)) {
    return req.map((p) => (typeof p === 'string' ? { text: p } : p));
  }
  return [req];
}

function createScriptedAgentClient(
  scripts: ServerGeminiStreamEvent[][],
): AgentClientContract {
  const scriptQueue = [...scripts];
  const history: Content[] = [];
  return {
    async initialize() {},
    isInitialized: () => true,
    hasChatInitialized: () => true,
    async getHistory() {
      return history;
    },
    getChat: () =>
      ({
        recordCompletedToolCalls: vi.fn(),
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
}

function toolCallRequestEvent(
  name: string,
  callId: string,
  agentId = DEFAULT_AGENT_ID,
  reason = 'blocked',
): ServerGeminiStreamEvent {
  const value: ToolCallRequestInfo = {
    callId,
    name,
    args: { reason },
    isClientInitiated: false,
    prompt_id: callId,
    agentId,
  };
  return { type: GeminiEventType.ToolCallRequest, value };
}

function finishedEvent(): ServerGeminiStreamEvent {
  return {
    type: GeminiEventType.Finished,
    value: { reason: FinishReason.STOP },
  };
}

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
}): Config {
  const { messageBus, toolRegistry, policyEngine } = options;
  const fixture = {
    getSessionId: () => 'agentic-loop-pause-test-session',
    getUsageStatisticsEnabled: () => false,
    getDebugMode: () => false,
    getApprovalMode: () => ApprovalMode.YOLO,
    getEphemeralSettings: () => ({}),
    getEphemeralSetting: () => undefined,
    getAllowedTools: (): string[] => [],
    getExcludeTools: (): string[] => [],
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    getToolRegistry: () => toolRegistry,
    getMessageBus: () => messageBus,
    getPolicyEngine: () => policyEngine,
    getTelemetryLogPromptsEnabled: () => false,
    isInteractive: () => true,
    getNonInteractive: () => false,
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

describe('useAgenticLoop pause completion routing', () => {
  let messageBus: MessageBus;
  let toolRegistry: ToolRegistry;
  let config: Config;

  beforeEach(() => {
    clearAllSchedulers();
    const pauseTool = new MockTool({ name: 'todo_pause' });
    pauseTool.executeFn.mockResolvedValue({
      llmContent: 'AI execution paused due to: blocked',
      returnDisplay: 'AI paused: blocked',
    });
    const otherTool = new MockTool({ name: 'record_tool' });
    otherTool.executeFn.mockResolvedValue({
      llmContent: 'recorded-ok',
      returnDisplay: 'recorded-ok',
    });
    toolRegistry = createToolRegistryForTest([pauseTool, otherTool]);
    messageBus = new MessageBus(createAllowPolicyEngine(), false);
    config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
    });
  });

  afterEach(() => {
    clearAllSchedulers();
  });

  function renderWithPauseCounter(client: AgentClientContract): {
    runLoop: (input: string, promptId: string) => Promise<void>;
    getPauseCallCount: () => number;
  } {
    let pauseCallCount = 0;
    const { result } = renderHook(() =>
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
        onTodoPause: () => {
          pauseCallCount += 1;
        },
        processStreamEventRef: { current: () => {} },
        flushPendingHistoryItem: () => {},
        clearPendingHistoryItem: () => {},
        performMemoryRefresh: async () => {},
      }),
    );
    return {
      runLoop: async (input: string, promptId: string) => {
        const controller = new AbortController();
        try {
          await result.current.runLoop(input, controller.signal, promptId);
        } finally {
          controller.abort();
        }
      },
      getPauseCallCount: () => pauseCallCount,
    };
  }

  it('fires onTodoPause exactly once when a pause tool call succeeds', async () => {
    const client = createScriptedAgentClient([
      [toolCallRequestEvent('todo_pause', 'pause-ok'), finishedEvent()],
      [finishedEvent()],
    ]);
    const { runLoop, getPauseCallCount } = renderWithPauseCounter(client);

    await act(async () => {
      await runLoop('go', 'p1');
    });

    const pauseTool = toolRegistry.getTool('todo_pause') as MockTool;
    expect(pauseTool.executeFn).toHaveBeenCalledTimes(1);
    expect(getPauseCallCount()).toBe(1);
  });

  it('fires onTodoPause once when multiple pause tool calls succeed in one batch', async () => {
    const client = createScriptedAgentClient([
      [
        toolCallRequestEvent('todo_pause', 'pause-ok-1'),
        toolCallRequestEvent('todo_pause', 'pause-ok-2'),
        finishedEvent(),
      ],
      [finishedEvent()],
    ]);
    const { runLoop, getPauseCallCount } = renderWithPauseCounter(client);

    await act(async () => {
      await runLoop('go', 'p1');
    });

    const pauseTool = toolRegistry.getTool('todo_pause') as MockTool;
    expect(pauseTool.executeFn).toHaveBeenCalledTimes(2);
    expect(getPauseCallCount()).toBe(1);
  });

  it('fires onTodoPause once when one pause succeeds and another fails in one batch', async () => {
    const pauseTool = toolRegistry.getTool('todo_pause') as MockTool;
    pauseTool.executeFn.mockImplementation(async (params) => {
      if (params.reason === 'blocked') {
        return {
          llmContent: 'AI execution paused due to: blocked',
          returnDisplay: 'AI paused: blocked',
        };
      }
      return {
        llmContent: 'reason exceeds maximum length of 500 characters',
        returnDisplay: 'reason exceeds maximum length of 500 characters',
        error: {
          message: 'reason exceeds maximum length of 500 characters',
        },
      };
    });
    const client = createScriptedAgentClient([
      [
        toolCallRequestEvent(
          'todo_pause',
          'pause-ok',
          DEFAULT_AGENT_ID,
          'blocked',
        ),
        toolCallRequestEvent(
          'todo_pause',
          'pause-err',
          DEFAULT_AGENT_ID,
          'too-long',
        ),
        finishedEvent(),
      ],
      [finishedEvent()],
    ]);
    const { runLoop, getPauseCallCount } = renderWithPauseCounter(client);

    await act(async () => {
      await runLoop('go', 'p1');
    });

    expect(pauseTool.executeFn).toHaveBeenCalledTimes(2);
    expect(getPauseCallCount()).toBe(1);
  });

  it('does not fire onTodoPause when a pause tool call fails', async () => {
    const pauseTool = toolRegistry.getTool('todo_pause') as MockTool;
    pauseTool.executeFn.mockResolvedValue({
      llmContent: 'reason exceeds maximum length of 500 characters',
      returnDisplay: 'reason exceeds maximum length of 500 characters',
      error: {
        message: 'reason exceeds maximum length of 500 characters',
      },
    });
    const client = createScriptedAgentClient([
      [toolCallRequestEvent('todo_pause', 'pause-err'), finishedEvent()],
      [finishedEvent()],
    ]);
    const { runLoop, getPauseCallCount } = renderWithPauseCounter(client);

    await act(async () => {
      await runLoop('go', 'p1');
    });

    expect(pauseTool.executeFn).toHaveBeenCalledTimes(1);
    expect(getPauseCallCount()).toBe(0);
  });

  it('does not fire onTodoPause for a different successful tool call', async () => {
    const client = createScriptedAgentClient([
      [toolCallRequestEvent('record_tool', 'call-1'), finishedEvent()],
      [finishedEvent()],
    ]);
    const { runLoop, getPauseCallCount } = renderWithPauseCounter(client);

    await act(async () => {
      await runLoop('go', 'p1');
    });

    const otherTool = toolRegistry.getTool('record_tool') as MockTool;
    expect(otherTool.executeFn).toHaveBeenCalledTimes(1);
    expect(getPauseCallCount()).toBe(0);
  });

  it('does not fire onTodoPause for an external agent pause tool call', async () => {
    const client = createScriptedAgentClient([
      [
        toolCallRequestEvent('todo_pause', 'pause-subagent', 'subagent-1'),
        finishedEvent(),
      ],
      [finishedEvent()],
    ]);
    const { runLoop, getPauseCallCount } = renderWithPauseCounter(client);

    await act(async () => {
      await runLoop('go', 'p1');
    });

    const pauseTool = toolRegistry.getTool('todo_pause') as MockTool;
    expect(pauseTool.executeFn).toHaveBeenCalledTimes(1);
    expect(getPauseCallCount()).toBe(0);
  });
});
