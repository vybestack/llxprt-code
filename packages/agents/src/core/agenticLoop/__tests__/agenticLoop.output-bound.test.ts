/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { clearAllSchedulers } from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { LiveOutputUpdate } from '@vybestack/llxprt-code-core';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { AgenticLoop } from '../AgenticLoop.js';
import {
  collectEvents,
  contentEvent,
  createAllowPolicyEngine,
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  finishedEvent,
  toolCallRequestEvent,
} from './agenticLoop-test-helpers.js';

const LIVE_CHUNK_COUNT = 2_000;

describe('AgenticLoop live-output acquisition bound', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });

  afterEach(() => {
    clearAllSchedulers();
  });

  it('emits one omission notice before completion when a producer outruns the consumer', async () => {
    const tool = new MockTool({
      name: 'verbose_tool',
      canUpdateOutput: true,
    });
    tool.executeFn.mockImplementation(
      async (
        _params: Record<string, unknown>,
        _signal: AbortSignal,
        updateOutput?: (update: LiveOutputUpdate) => void,
      ) => {
        for (let index = 0; index < LIVE_CHUNK_COUNT; index += 1) {
          updateOutput?.({ mode: 'append', data: 'x' });
        }
        return { llmContent: 'done', returnDisplay: 'done' };
      },
    );

    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry: createToolRegistryForTest([tool]),
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('verbose_tool', 'call-verbose', {}),
        finishedEvent(),
      ],
      [contentEvent('final'), finishedEvent()],
    ]);

    const events = await collectEvents(
      new AgenticLoop({ agentClient: client, config, messageBus }),
      'go',
      new AbortController().signal,
    );
    const outputEvents = events.filter((event) => event.kind === 'tool_output');
    const notices = outputEvents.filter((event) =>
      event.chunk.includes('LLXPRT live tool output omitted'),
    );
    const completionIndex = events.findIndex(
      (event) => event.kind === 'tools_complete',
    );
    const noticeIndex = events.findIndex(
      (event) =>
        event.kind === 'tool_output' &&
        event.chunk.includes('LLXPRT live tool output omitted'),
    );

    expect(outputEvents.length).toBeLessThan(LIVE_CHUNK_COUNT);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.callId).toBe('call-verbose');
    expect(noticeIndex).toBeGreaterThanOrEqual(0);
    expect(completionIndex).toBeGreaterThan(noticeIndex);
  });
});
