import { CoreToolScheduler } from '../../coreToolScheduler.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect } from 'bun:test';
import { bindSchedulerOwner } from '../../../session/assembleSchedulerOwner.js';
import { AgenticLoop } from '../AgenticLoop.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
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
  it('runs its tool turn on an isolated owner, leaving a pre-existing main scheduler and its callbacks intact', async () => {
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
    const { config: config, settingsOwner: configSettingsOwner } =
      createTestConfig({
        messageBus,
        toolRegistry,
        policyEngine: createAllowPolicyEngine(),
        interactive: false,
        approvalMode: ApprovalMode.YOLO,
      });

    const mainCompletions: CompletedToolCall[][] = [];
    const mainOwner = bindSchedulerOwner(
      config,
      messageBus,
      false,
      toolRegistry,
      (options) => new CoreToolScheduler(options),
      () => configSettingsOwner.readToolExecutionPolicy(),
      () =>
        configSettingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      undefined,
      configSettingsOwner.telemetry,
    )({
      onAllToolCallsComplete: async (completed) => {
        mainCompletions.push(completed);
      },
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const mainScheduler = mainOwner.acquire();
    await mainScheduler.ready;

    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('loop_tool', 'call-loop'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({
      createSchedulerOwner: bindSchedulerOwner(
        config,
        messageBus,
        config.isInteractive(),
        toolRegistry,
        (options) => new CoreToolScheduler(options),
        () => configSettingsOwner.readToolExecutionPolicy(),
        () =>
          configSettingsOwner.readToolGovernance(
            config.getExcludeTools() ?? [],
          ),
        undefined,
        configSettingsOwner.telemetry,
      ),
      agentClient: client,
      config,
      messageBus,
    });
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

    await waitFor(() => {
      expect(mainCompletions.length).toBeGreaterThan(0);
    });
    expect(mainTool.executeFn).toHaveBeenCalledTimes(1);
    const lastMainCompletion = mainCompletions.at(-1);
    expect(lastMainCompletion).toBeDefined();
    expect(lastMainCompletion?.[0]?.request.callId).toBe('main-call');
    expect(lastMainCompletion?.[0]?.status).toBe('success');

    await mainScheduler.release();
  });
});
