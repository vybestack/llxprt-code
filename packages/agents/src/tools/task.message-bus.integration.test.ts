/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type ToolPolicyRejection,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';

import { MockTool } from '@vybestack/llxprt-code-test-utils/core/tools.js';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import { ChatSession } from '../core/chatSession.js';
import { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import {
  createMockConfig,
  createMockStream,
  createStatelessRuntimeBundle,
  disposeMockConfig,
} from '../core/__tests__/subagent-test-helpers.js';
import { TaskTool } from './task.js';

const actualTools = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () => ({
  ...actualTools,
  LocalTodoStore: vi.fn().mockImplementation(() => ({
    readTodos: vi.fn().mockResolvedValue([]),
  })),
}));

const actualChatSession = { ...(await import('../core/chatSession.js')) };
void vi.mock('../core/chatSession.js', () => ({
  ...actualChatSession,
  ChatSession: vi.fn(),
}));

const actualEnvironmentContext = {
  ...(await import('@vybestack/llxprt-code-core/utils/environmentContext.js')),
};
void vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js', () => ({
  ...actualEnvironmentContext,
  getEnvironmentContext: vi.fn().mockResolvedValue([{ text: 'Environment' }]),
}));

const actualPrompts = {
  ...(await import('@vybestack/llxprt-code-core/core/prompts.js')),
};
void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  ...actualPrompts,
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('Core prompt'),
}));

const SUBAGENT_NAME = 'message-bus-probe';
const TOOL_NAME = 'message_bus_probe_tool';

const subagentConfig: SubagentConfig = {
  name: SUBAGENT_NAME,
  profile: 'message-bus-profile',
  systemPrompt: 'Run the requested tool.',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const profile: Profile = {
  version: 1,
  provider: 'gemini',
  model: 'gemini-2.0-pro',
  modelParams: {},
  ephemeralSettings: {},
};

function createManagers(): {
  subagentManager: SubagentManager;
  profileManager: ProfileManager;
} {
  return {
    subagentManager: {
      loadSubagent: vi.fn().mockResolvedValue(subagentConfig),
    } as unknown as SubagentManager,
    profileManager: {
      loadProfile: vi.fn().mockResolvedValue(profile),
    } as unknown as ProfileManager,
  };
}

describe('TaskTool runtime MessageBus integration', () => {
  let config: Config | undefined;
  let sendMessageStream: ReturnType<typeof createMockStream>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMessageStream = createMockStream([]);
    (
      ChatSession as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementation(() => ({
      sendMessageStream,
      getHistory: vi.fn().mockReturnValue([]),
      getHistoryService: vi.fn().mockReturnValue({
        clear: vi.fn(),
        findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
        getCurated: vi.fn().mockReturnValue([]),
        getTotalTokens: vi.fn().mockReturnValue(0),
      }),
      getConfig: vi.fn().mockReturnValue(undefined),
      getResolvedBaseUrl: () => undefined,
      getStreamTimeoutPolicy: () => ({}),
      shouldShowCitations: () => false,
    }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (config !== undefined) {
      await disposeMockConfig(config);
    }
  });

  it('uses the exact session MessageBus for a non-interactive subagent tool scheduler', async () => {
    const probeTool = new MockTool(TOOL_NAME);
    const {
      config: runtimeConfig,
      mcpRuntime,
      settingsOwner,
    } = await createMockConfig({
      getTool: (name) => (name === TOOL_NAME ? probeTool : undefined),
    });
    config = runtimeConfig;

    const sessionMessageBus = mcpRuntime.messageBus;
    const decoyMessageBus = new MessageBus(sessionMessageBus, false);
    const sessionRejections: ToolPolicyRejection[] = [];
    const decoyRejections: ToolPolicyRejection[] = [];
    sessionMessageBus.subscribe<ToolPolicyRejection>(
      MessageBusType.TOOL_POLICY_REJECTION,
      (message) => {
        sessionRejections.push(message);
      },
    );
    decoyMessageBus.subscribe<ToolPolicyRejection>(
      MessageBusType.TOOL_POLICY_REJECTION,
      (message) => {
        decoyRejections.push(message);
      },
    );
    vi.spyOn(sessionMessageBus, 'evaluate').mockReturnValue(
      PolicyDecision.DENY,
    );

    sendMessageStream.mockImplementation(
      createMockStream([
        [{ name: TOOL_NAME, id: 'message-bus-probe-call' }],
        'stop',
      ]),
    );

    const { subagentManager, profileManager } = createManagers();
    const runtimeBundle = createStatelessRuntimeBundle({
      toolRegistry: mcpRuntime.toolSelection,
    });
    const tool = new TaskTool(runtimeConfig, {
      createChildSettings: () => settingsOwner.createChildStore(),
      readRunPolicy: () => settingsOwner.readSubagentRunPolicy(),
      readTaskPolicy: () => settingsOwner.readTaskPolicy(),
      readGovernance: () =>
        settingsOwner.readToolGovernance(runtimeConfig.getExcludeTools() ?? []),
      instructions: emptyInstructionReads,
      workspacePaths: mcpRuntime.workspaceFilesystem.paths,
      readMcpInstructions: () => undefined,
      messageBus: sessionMessageBus,
      isInteractiveEnvironment: () => false,
      orchestratorFactory: (coreSchedulerMessageBus) => {
        expect(coreSchedulerMessageBus).toBe(sessionMessageBus);
        return new SubagentOrchestrator({
          workspaceTrust: mcpRuntime.trust,
          createChildSettings: () => settingsOwner.createChildStore(),
          readRunPolicy: () => settingsOwner.readSubagentRunPolicy(),
          instructions: emptyInstructionReads,
          workspacePaths: mcpRuntime.workspaceFilesystem.paths,
          readMcpInstructions: () => undefined,
          subagentManager,
          profileManager,
          foregroundConfig: runtimeConfig,
          toolRegistry: mcpRuntime.toolSelection,
          runtimeLoader: vi.fn().mockResolvedValue(runtimeBundle),
          messageBus: coreSchedulerMessageBus,
        });
      },
    });

    await tool
      .build({
        subagent_name: SUBAGENT_NAME,
        goal_prompt: 'Exercise the normal tool scheduler.',
      })
      .execute(new AbortController().signal);

    expect(sessionRejections).toHaveLength(1);
    expect(sessionRejections[0].toolCall.name).toBe(TOOL_NAME);
    expect(decoyRejections).toHaveLength(0);
  }, 30_000);
});
