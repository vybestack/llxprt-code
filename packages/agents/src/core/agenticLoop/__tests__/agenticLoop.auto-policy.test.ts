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
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { Part } from '@google/genai';
import {
  type ApprovalHandler,
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  createAllowPolicyEngine,
  collectEvents,
  isToolsComplete,
  partListUnionToParts,
  toolCallRequestEvent,
  contentEvent,
  finishedEvent,
} from './agenticLoop-test-helpers.js';

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

    const eventKinds = events.map((e) => e.kind);
    const toolsCompleteIdx = eventKinds.indexOf('tools_complete');
    const firstStreamIdx = eventKinds.indexOf('stream');
    const secondStreamIdx = eventKinds.indexOf('stream', toolsCompleteIdx + 1);
    expect(firstStreamIdx).toBeLessThan(toolsCompleteIdx);
    expect(secondStreamIdx).toBeGreaterThan(toolsCompleteIdx);

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
