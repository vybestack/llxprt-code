/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgenticLoop } from '../AgenticLoop.js';
import type { AgenticLoopEvent } from '../types.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { clearAllSchedulers } from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type { ServerGeminiStreamEvent } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  type ApprovalHandler,
  GeminiEventType,
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  createAllowPolicyEngine,
  createAskPolicyEngine,
  collectEvents,
  isToolsComplete,
  hasFunctionResponse,
  toolCallRequestEvent,
  contentEvent,
  finishedEvent,
} from './agenticLoop-test-helpers.js';

describe('AgenticLoop integration - terminal outcomes and bus scoping', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it.each([
    [
      'Error',
      {
        type: GeminiEventType.Error,
        value: { error: { message: 'provider failed' } },
      } satisfies ServerGeminiStreamEvent,
    ],
    [
      'StreamIdleTimeout',
      {
        type: GeminiEventType.StreamIdleTimeout,
        value: { error: { message: 'stream idle timeout' } },
      } satisfies ServerGeminiStreamEvent,
    ],
    [
      'UserCancelled',
      {
        type: GeminiEventType.UserCancelled,
      } satisfies ServerGeminiStreamEvent,
    ],
    [
      'LoopDetected',
      {
        type: GeminiEventType.LoopDetected,
      } satisfies ServerGeminiStreamEvent,
    ],
  ])(
    'does not execute collected tools after %s',
    async (_name, terminalEvent) => {
      let executed = false;
      const tool = new MockTool({
        name: 'terminal_tool',
        execute: async () => {
          executed = true;
          return {
            llmContent: 'should-not-run',
            returnDisplay: 'should-not-run',
          };
        },
      });
      tool.executeFn.mockImplementation(async () => {
        executed = true;
        return {
          llmContent: 'should-not-run',
          returnDisplay: 'should-not-run',
        };
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
      const { client, history, turnMessages } = createScriptedAgentClient([
        [toolCallRequestEvent('terminal_tool', 'terminal-call'), terminalEvent],
      ]);
      const loop = new AgenticLoop({
        agentClient: client,
        config,
        messageBus,
      });

      const events = await collectEvents(
        loop,
        'go',
        new AbortController().signal,
      );

      expect(executed).toBe(false);
      expect(events.some(isToolsComplete)).toBe(false);
      expect(hasFunctionResponse(history)).toBe(false);
      expect(turnMessages).toHaveLength(1);
    },
  );

  it('emits the final empty tool update before tools_complete', async () => {
    const tool = new MockTool({ name: 'clear_tool' });
    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const displaySizes: number[] = [];
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('clear_tool', 'clear-call'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      displayCallbacks: {
        onToolCallsUpdate: (toolCalls) => {
          displaySizes.push(toolCalls.length);
        },
      },
    });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );
    const eventKinds = events.map((event) => event.kind);
    const emptyUpdateIndex = events.findIndex(
      (event) => event.kind === 'tool_update' && event.toolCalls.length === 0,
    );
    const completeIndex = eventKinds.indexOf('tools_complete');

    expect(emptyUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(completeIndex).toBeGreaterThan(emptyUpdateIndex);
    expect(displaySizes.at(-1)).toBe(0);
  });

  it('does not execute ASK_USER tools in non-interactive mode without approvalHandler', async () => {
    let executed = false;
    const tool = new MockTool({
      name: 'ask_without_handler_tool',
      execute: async () => {
        executed = true;
        return {
          llmContent: 'should-not-run',
          returnDisplay: 'should-not-run',
        };
      },
    });
    tool.shouldConfirm = true;
    tool.executeFn.mockImplementation(async () => {
      executed = true;
      return {
        llmContent: 'should-not-run',
        returnDisplay: 'should-not-run',
      };
    });

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.DEFAULT,
    });
    const { client, history, turnMessages } = createScriptedAgentClient([
      [
        toolCallRequestEvent(
          'ask_without_handler_tool',
          'ask-without-handler-call',
        ),
        finishedEvent(),
      ],
      [contentEvent('denied'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({ agentClient: client, config, messageBus });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    const completedEvent = events.find(isToolsComplete);

    expect(executed).toBe(false);
    expect(completedEvent?.completed[0]?.status).toBe('error');
    expect(hasFunctionResponse(history)).toBe(true);
    expect(turnMessages).toHaveLength(2);
  });

  it('terminates instead of hanging when scheduler filters all tool requests', async () => {
    const toolRegistry = createToolRegistryForTest([]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const { client, history, turnMessages } = createScriptedAgentClient([
      [
        toolCallRequestEvent(
          'filtered_tool',
          'filtered-call',
          {},
          {
            hookRestrictedAllowedTools: [],
          },
        ),
        finishedEvent(),
      ],
    ]);
    const loop = new AgenticLoop({ agentClient: client, config, messageBus });

    const events = await collectEvents(
      loop,
      'go',
      new AbortController().signal,
    );

    expect(events.some(isToolsComplete)).toBe(false);
    expect(hasFunctionResponse(history)).toBe(false);
    expect(turnMessages).toHaveLength(1);
  });

  it('approvalHandler ignores confirmation requests for tool calls owned by another scheduler', async () => {
    const tool = new MockTool({ name: 'owned_tool' });
    tool.shouldConfirm = true;
    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    let approvalCount = 0;
    const approvalHandler: ApprovalHandler = async () => {
      approvalCount += 1;
      return { outcome: ToolConfirmationOutcome.ProceedOnce };
    };
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('owned_tool', 'owned-call'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
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
      if (event.kind === 'awaiting_approval') {
        messageBus.publish({
          type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
          correlationId: 'unowned-correlation',
          toolCall: {
            id: 'unowned-call',
            name: 'owned_tool',
            args: {},
          },
        });
      }
    }

    expect(events.some(isToolsComplete)).toBe(true);
    expect(approvalCount).toBe(1);
  });
});
