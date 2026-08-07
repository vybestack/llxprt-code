/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the public AgentEvent `done` ordering contract
 * (issue #3087).
 *
 * `mapLoopStream` must emit AT MOST ONE `done`, and when emitted it must be
 * the FINAL public event of the stream. Before this fix, the inner
 * `AgentEventType.Finished` (which means "this model iteration ended", not
 * "the agentic turn ended") was mapped straight to a public `done`, so a
 * tool-bearing turn emitted a premature `done` before the tool results and a
 * duplicate `done` at loop end.
 *
 * These tests drive a real `AgenticLoop` with a real `CoreToolScheduler` and
 * a real `MessageBus`; only the provider stream is scripted. They script the
 * exact scenario from the issue: turn 1 requests a normal tool (`get_info`)
 * then finishes; turn 2 just finishes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { AgenticLoop } from '../AgenticLoop.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { clearAllSchedulers } from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { mapLoopStream } from '../../../api/eventAdapter.js';
import type { AgentEvent } from '../../../api/event-types.js';
import {
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  createAskPolicyEngine,
  toolCallRequestEvent,
  finishedEvent,
} from './agenticLoop-test-helpers.js';

describe('AgenticLoop done ordering through mapLoopStream (issue #3087)', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('emits exactly one done AFTER every tool event for a normal tool call then a clean finish', async () => {
    const getInfoTool = new MockTool({
      name: 'get_info',
      execute: async () => ({
        llmContent: 'info result',
        returnDisplay: 'info result',
      }),
    });

    const toolRegistry = createToolRegistryForTest([getInfoTool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });

    // Turn 1: model requests get_info, then finishes the iteration.
    // Turn 2: model just finishes (clean completion).
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('get_info', 'info-1', {}), finishedEvent()],
      [finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      interactiveMode: true,
    });

    const agentEvents: AgentEvent[] = [];
    for await (const ev of mapLoopStream(
      loop.run(
        [{ type: 'text', text: 'get info' }],
        new AbortController().signal,
      ),
    )) {
      agentEvents.push(ev);
    }

    // Exactly one done event.
    const doneEvents = agentEvents.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);

    // The single done is the LAST event in the stream.
    const doneIndex = agentEvents.indexOf(doneEvents[0]);
    expect(doneIndex).toBe(agentEvents.length - 1);

    // Every tool-call, tool-status, and tool-result index is strictly less
    // than the done index.
    const toolEventIndices = agentEvents
      .map((e, i) =>
        e.type === 'tool-call' ||
        e.type === 'tool-status' ||
        e.type === 'tool-result'
          ? i
          : -1,
      )
      .filter((i) => i >= 0);

    expect(toolEventIndices.length).toBeGreaterThan(0);
    for (const idx of toolEventIndices) {
      expect(idx).toBeLessThan(doneIndex);
    }
  });
});
