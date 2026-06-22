/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgenticLoop } from '../AgenticLoop.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { clearAllSchedulers } from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import {
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  createAllowPolicyEngine,
  collectEvents,
  toolCallRequestEvent,
  contentEvent,
  finishedEvent,
} from './agenticLoop-test-helpers.js';

describe('AgenticLoop promptId correlation', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('threads the caller-provided promptId into the FIRST model turn and uses a distinct generated id for continuation turns', async () => {
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

    expect(promptIds).toHaveLength(2);
    expect(promptIds[0]).toBe(callerPromptId);
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
