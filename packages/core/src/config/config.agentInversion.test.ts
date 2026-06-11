/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { Content, GenerateContentResponse } from '@google/genai';
import { Config, type ConfigParameters } from './config.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import type { AgentClientContract } from '../core/clientContract.js';
import type { ToolSchedulerContract } from '../core/toolSchedulerContract.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type { ContentGeneratorConfig } from '../core/contentGenerator.js';
import {
  createToolRegistry,
  type TaskToolRegistration,
} from './toolRegistryFactory.js';
import { DeclarativeTool, type ToolInvocation } from '../tools/tools.js';
import { Kind } from '../tools/tools.js';
import type { MessageBus as MessageBusType } from '../confirmation-bus/message-bus.js';

function baseParams(
  overrides: Partial<ConfigParameters> = {},
): ConfigParameters {
  return {
    sessionId: 'p01-session',
    targetDir: process.cwd(),
    debugMode: false,
    cwd: process.cwd(),
    model: 'gemini-pro',
    ...overrides,
  };
}

function createFakeAgentClient(): AgentClientContract {
  let initialized = false;
  const history: Content[] = [];
  return {
    async initialize(_config: ContentGeneratorConfig): Promise<void> {
      initialized = true;
    },
    isInitialized(): boolean {
      return initialized;
    },
    hasChatInitialized: vi.fn(() => false),
    getChat: vi.fn(() => ({
      sendMessageStream: vi.fn(async () => (async function* () {})()),
      getHistory: () => history,
      setHistory: vi.fn(),
      clearHistory: vi.fn(),
      getHistoryService: () => null,
      wasRecentlyCompressed: () => false,
      performCompression: vi.fn(async () => 0 as never),
      recordCompletedToolCalls: vi.fn(),
    })),
    async getHistory(): Promise<Content[]> {
      return history;
    },
    getHistoryService: () => null,
    storeHistoryServiceForReuse: vi.fn(),
    storeHistoryForLaterUse(storedHistory: Content[]): void {
      history.push(...storedHistory);
    },
    dispose: vi.fn(),
    setTools: vi.fn(async () => {}),
    clearTools: vi.fn(),
    updateSystemInstruction: vi.fn(async () => {}),
    addHistory: vi.fn(async (content: Content) => {
      history.push(content);
    }),
    resetChat: vi.fn(async () => {}),
    resumeChat: vi.fn(async () => {}),
    setHistory: vi.fn(async () => {}),
    restoreHistory: vi.fn(async () => {}),
    addDirectoryContext: vi.fn(async () => {}),
    getContentGenerator: vi.fn(() => ({}) as never),
    startChat: vi.fn(async () => ({
      sendMessageStream: vi.fn(async () => (async function* () {})()),
      getHistory: () => history,
      setHistory: vi.fn(),
      clearHistory: vi.fn(),
      getHistoryService: () => null,
      wasRecentlyCompressed: () => false,
      performCompression: vi.fn(async () => 0 as never),
      recordCompletedToolCalls: vi.fn(),
    })),
    generateDirectMessage: vi.fn(async () => ({}) as GenerateContentResponse),
    generateJson: vi.fn(async () => ({})),
    generateContent: vi.fn(async () => ({}) as GenerateContentResponse),
    generateEmbedding: vi.fn(async () => []),
    async *sendMessageStream(): AsyncGenerator<never, never> {
      return undefined as never;
    },
    getUserTier: vi.fn(() => undefined),
    getCurrentSequenceModel: vi.fn(() => null),
  };
}

class RegisteredTaskTool extends DeclarativeTool<
  object,
  { llmContent: string; returnDisplay: string }
> {
  constructor(readonly createdWith: unknown[]) {
    super('task', 'task', 'fake task', Kind.Other, {}, true, false);
  }

  build(
    params: object,
  ): ToolInvocation<object, { llmContent: string; returnDisplay: string }> {
    return {
      params,
      getDescription: () => 'fake task',
      toolLocations: () => [],
      shouldConfirmExecute: async () => false,
      execute: async () => ({ llmContent: 'ok', returnDisplay: 'ok' }),
    };
  }
}

describe('P01 construction inversion contracts', () => {
  it('does not require agentClientFactory until Config.initialize uses the client seam', async () => {
    const config = new Config(baseParams());
    const messageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );

    await expect(config.initialize({ messageBus })).rejects.toThrow(
      'agentClientFactory is required before Config.initialize() can create an AgentClient',
    );
  });

  it('creates the AgentClient through the injected factory during initialize', async () => {
    const fakeClient = createFakeAgentClient();
    const factory = vi.fn(
      (_config: Config, _state: AgentRuntimeState) => fakeClient,
    );
    const config = new Config(baseParams({ agentClientFactory: factory }));
    const messageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );

    await config.initialize({ messageBus });

    expect(factory).toHaveBeenCalledWith(
      config,
      expect.objectContaining({ runtimeId: 'p01-session' }),
    );
    expect(config.getAgentClient()).toBe(fakeClient);
    expect(fakeClient.isInitialized()).toBe(false);
  });

  it('creates schedulers through the injected factory and preserves per-session singleton reuse', async () => {
    const fakeClient = createFakeAgentClient();
    const scheduler: ToolSchedulerContract = {
      schedule: vi.fn(async () => {}),
      cancelAll: vi.fn(),
      dispose: vi.fn(),
      setCallbacks: vi.fn(),
      handleConfirmationResponse: vi.fn(async () => {}),
    };
    const schedulerFactory = vi.fn(() => scheduler);
    const config = new Config(
      baseParams({
        agentClientFactory: () => fakeClient,
        toolSchedulerFactory: schedulerFactory,
      }),
    );
    const messageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    await config.initialize({ messageBus });
    const callbacks = {
      outputUpdateHandler: vi.fn(),
      onAllToolCallsComplete: vi.fn(async () => {}),
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: vi.fn(),
    };

    const first = await config.getOrCreateScheduler(
      'p01-session',
      callbacks,
      undefined,
      {
        messageBus,
      },
    );
    const second = await config.getOrCreateScheduler(
      'p01-session',
      callbacks,
      undefined,
      {
        messageBus,
      },
    );

    expect(first).toBe(scheduler);
    expect(second).toBe(scheduler);
    expect(schedulerFactory).toHaveBeenCalledTimes(1);
  });

  it('uses injected TaskToolRegistration metadata instead of the concrete class name', async () => {
    const registeredTools: unknown[] = [];
    const registration: TaskToolRegistration = {
      toolClass: RegisteredTaskTool,
      className: 'TaskTool',
      staticName: 'task',
      buildArgs: (_config, taskToolArgs) => ['config-arg', taskToolArgs],
      create: (config, taskToolArgs) =>
        new RegisteredTaskTool([config, taskToolArgs]) as never,
    };
    const host = {
      getCoreTools: () => ['TaskTool'],
      getExcludeTools: () => undefined,
      getUseRipgrep: () => false,
      getProfileManager: () => ({}) as never,
      setProfileManager: vi.fn(),
      getSubagentManager: () => ({}) as never,
      setSubagentManager: vi.fn(),
      getInteractiveSubagentSchedulerFactory: () => undefined,
      getAsyncTaskManager: () => undefined,
      getTaskToolRegistration: () => registration,
    };
    const config = new Config(baseParams());
    vi.spyOn(config, 'getPromptRegistry').mockReturnValue({
      clear: vi.fn(),
      registerPrompt: vi.fn(),
      getPrompt: vi.fn(),
      listPrompts: vi.fn(() => []),
    } as never);
    const messageBus = new MessageBus(config.getPolicyEngine(), false);

    const { registry, allPotentialTools } = await createToolRegistry(
      host,
      config,
      messageBus,
    );
    registeredTools.push(...registry.getAllTools());

    const taskRecord = allPotentialTools.find(
      (tool) => tool.toolName === 'TaskTool',
    );
    expect(taskRecord).toEqual(
      expect.objectContaining({
        toolClass: RegisteredTaskTool,
        toolName: 'TaskTool',
        displayName: 'task',
        isRegistered: true,
      }),
    );
    expect(registeredTools).toContainEqual(expect.any(RegisteredTaskTool));
  });
});
