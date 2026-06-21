/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgenticLoop } from '../AgenticLoop.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { clearAllSchedulers } from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type {
  CompletedToolCall,
  ToolCallRequestInfo,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import {
  DEFAULT_AGENT_ID,
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  createAllowPolicyEngine,
  collectEvents,
  isToolsComplete,
  toolCallRequestEvent,
  contentEvent,
  finishedEvent,
} from './agenticLoop-test-helpers.js';

describe('AgenticLoop scheduler isolation', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('runs its tool turn on an isolated scheduler key, leaving a pre-existing main scheduler (keyed by sessionId) and its callbacks intact', async () => {
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

    expect(loopTool.executeFn).toHaveBeenCalledTimes(1);
    const loopCompleted = events.filter(isToolsComplete);
    expect(loopCompleted).toHaveLength(1);
    expect(loopCompleted[0].completed[0].status).toBe('success');

    const mainRequest: ToolCallRequestInfo = {
      callId: 'main-call',
      name: 'main_tool',
      args: {},
      isClientInitiated: true,
      prompt_id: 'main-prompt',
      agentId: DEFAULT_AGENT_ID,
    };
    await mainScheduler.schedule([mainRequest], new AbortController().signal);

    await vi.waitFor(() => {
      expect(mainCompletions.length).toBeGreaterThan(0);
    });
    expect(mainTool.executeFn).toHaveBeenCalledTimes(1);
    const lastMainCompletion = mainCompletions.at(-1);
    expect(lastMainCompletion).toBeDefined();
    expect(lastMainCompletion?.[0]?.request.callId).toBe('main-call');
    expect(lastMainCompletion?.[0]?.status).toBe('success');

    config.disposeScheduler(sessionId);
  });
});
