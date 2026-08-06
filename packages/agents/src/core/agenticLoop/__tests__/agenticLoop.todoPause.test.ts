/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for AgenticLoop pause-loop-break (issue #2653).
 *
 * These tests verify that when the model calls the pause tool and the tool
 * completes successfully, the AgenticLoop stops — it does NOT feed the
 * pause response back into another model turn. This is critical for
 * ACP/Zed and other headless consumers that lack the CLI's React UI
 * continuation gate.
 *
 * The test approach follows dev-docs/RULES.md: real AgenticLoop, real
 * CoreToolScheduler, real MessageBus. The only mock boundary is the
 * provider stream (scripted ServerAgentStreamEvents).
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '../../../testApi.js';
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
  collectEvents,
  isToolsComplete,
  toolCallRequestEvent,
  finishedEvent,
} from './agenticLoop-test-helpers.js';

describe('AgenticLoop pause loop-break (issue #2653)', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('stops the loop after a successful pause tool call (no extra model turn)', async () => {
    const pauseTool = new MockTool({
      name: 'todo_pause',
      execute: async () => ({
        llmContent: 'paused',
        returnDisplay: 'paused',
      }),
    });

    const toolRegistry = createToolRegistryForTest([pauseTool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });

    // Turn 1: model requests the pause tool, then finishes the turn.
    // No Turn 2 script is provided — if the loop tries to continue, the
    // scripted client will return an empty stream.
    const { client, turnMessages } = createScriptedAgentClient([
      [
        toolCallRequestEvent('todo_pause', 'pause-1', {
          reason: 'testing pause',
        }),
        finishedEvent(),
      ],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      interactiveMode: true,
    });

    const events = await collectEvents(
      loop,
      [{ type: 'text', text: 'pause please' }],
      new AbortController().signal,
    );

    expect(events.some(isToolsComplete)).toBe(true);
    // CRITICAL: only ONE model turn should have happened. If the loop
    // continued after the pause, turnMessages would have 2 entries.
    expect(turnMessages).toHaveLength(1);

    const errorEvents = events.filter((e) => e.kind === 'error');
    expect(errorEvents).toHaveLength(0);
  });

  it('eagerly records pause tool history so the response is durable', async () => {
    const pauseTool = new MockTool({
      name: 'todo_pause',
      execute: async () => ({
        llmContent: 'paused with reason',
        returnDisplay: 'paused',
      }),
    });

    const toolRegistry = createToolRegistryForTest([pauseTool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client, history } = createScriptedAgentClient([
      [
        toolCallRequestEvent('todo_pause', 'pause-2', {
          reason: 'need to stop',
        }),
        finishedEvent(),
      ],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      interactiveMode: true,
    });

    await collectEvents(
      loop,
      [{ type: 'text', text: 'pause' }],
      new AbortController().signal,
    );

    // History must contain the tool response blocks, even though there was
    // no next model turn to carry them. This proves the eager history
    // recording in buildNextMessage works.
    const allBlocks = history.flatMap((h) => h.blocks);
    const hasToolResponse = allBlocks.some((b) => b.type === 'tool_response');
    expect(hasToolResponse).toBe(true);
  });

  it('does NOT stop the loop when the pause tool fails (error response)', async () => {
    const pauseTool = new MockTool({
      name: 'todo_pause',
      execute: async () => {
        throw new Error('pause failed');
      },
    });

    const echoTool = new MockTool({
      name: 'echo',
      execute: async () => ({
        llmContent: 'echoed',
        returnDisplay: 'echoed',
      }),
    });

    const toolRegistry = createToolRegistryForTest([pauseTool, echoTool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client, turnMessages } = createScriptedAgentClient([
      [
        toolCallRequestEvent('todo_pause', 'pause-err', {
          reason: 'will fail',
        }),
        finishedEvent(),
      ],
      [toolCallRequestEvent('echo', 'echo-1', {}), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      interactiveMode: true,
    });

    await collectEvents(
      loop,
      [{ type: 'text', text: 'try pause then echo' }],
      new AbortController().signal,
    );

    // The failed pause must NOT have terminated the loop — the model should
    // have received the error and continued with a second turn.
    expect(turnMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('continues the loop normally for non-pause tools after the fix', async () => {
    // Regression guard: a normal successful tool should still cause the
    // loop to continue (feed response, next model turn).
    const normalTool = new MockTool({
      name: 'get_info',
      execute: async () => ({
        llmContent: 'info result',
        returnDisplay: 'info result',
      }),
    });

    const toolRegistry = createToolRegistryForTest([normalTool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client, turnMessages } = createScriptedAgentClient([
      [toolCallRequestEvent('get_info', 'info-1', {}), finishedEvent()],
      [finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      interactiveMode: true,
    });

    await collectEvents(
      loop,
      [{ type: 'text', text: 'get info' }],
      new AbortController().signal,
    );

    expect(turnMessages).toHaveLength(2);
  });

  it('emits the terminal done BEFORE the todo_pause tool-result through mapLoopStream (issue #3071 ordering)', async () => {
    // CHARACTERIZATION GUARD. The CLI observation tap
    // (packages/cli/src/observation/observationTap.ts) opens the user_input
    // wait for issue #3071 from onStreamSettled(), NOT from endTurn, precisely
    // because the terminal `done` is emitted BEFORE the pause tool-result
    // (turn.ts emits Finished on the provider chunk's finishReason, the
    // deferred-events flush runs before the loop schedules the tool, and the
    // adapter maps Finished to an immediate `done`). endTurn therefore runs on
    // the early done while the pause has not yet been observed, so opening the
    // wait there would be dead code. If this ordering ever changes (done after
    // the result, or the result projected with an empty name / an error), the
    // tap's onStreamSettled design must be revisited.
    const pauseTool = new MockTool({
      name: 'todo_pause',
      execute: async () => ({
        llmContent: 'paused',
        returnDisplay: 'paused',
      }),
    });

    const toolRegistry = createToolRegistryForTest([pauseTool]);
    const messageBus = new MessageBus(createAskPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAskPolicyEngine(),
      interactive: true,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('todo_pause', 'pause-order', {
          reason: 'blocked',
        }),
        finishedEvent(),
      ],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      interactiveMode: true,
    });

    const agentEvents: AgentEvent[] = [];
    for await (const ev of mapLoopStream(
      loop.run([{ type: 'text', text: 'pause' }], new AbortController().signal),
    )) {
      agentEvents.push(ev);
    }

    const doneIndex = agentEvents.findIndex((e) => e.type === 'done');
    const pauseResult = agentEvents.find(
      (e): e is Extract<AgentEvent, { type: 'tool-result' }> =>
        e.type === 'tool-result' && e.result.name === 'todo_pause',
    );

    // The pause tool result is projected with its true name and no error.
    expect(pauseResult).not.toBeUndefined();
    expect(pauseResult?.result.isError).toBe(false);

    // CRITICAL ordering: the terminal `done` precedes the pause result.
    expect(doneIndex).toBeGreaterThanOrEqual(0);
    const pauseResultIndex = agentEvents.indexOf(pauseResult!);
    expect(doneIndex).toBeLessThan(pauseResultIndex);
  });
});
