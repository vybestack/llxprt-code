/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgenticLoop } from '../AgenticLoop.js';
import type { AgenticLoopEvent } from '../types.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import { clearAllSchedulers } from '@vybestack/llxprt-code-core/config/schedulerSingleton.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  type ApprovalHandler,
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  createAllowPolicyEngine,
  createAskPolicyEngine,
  collectEvents,
  isToolsComplete,
  isToolOutput,
  toolCallRequestEvent,
  contentEvent,
  finishedEvent,
} from './agenticLoop-test-helpers.js';

describe('AgenticLoop integration - Cancellation via AbortSignal', () => {
  beforeEach(() => {
    clearAllSchedulers();
  });
  afterEach(() => {
    clearAllSchedulers();
  });

  it('abort during the model stream stops the loop cleanly with no tools scheduled', async () => {
    const tool = new MockTool({ name: 'tool_x' });
    tool.executeFn.mockResolvedValue({
      llmContent: 'x',
      returnDisplay: 'x',
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

    const controller = new AbortController();
    const { client } = createScriptedAgentClient([
      [
        contentEvent('partial...'),
        toolCallRequestEvent('tool_x', 'call-x'),
        finishedEvent(),
      ],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });

    const collected: AgenticLoopEvent[] = [];
    const iterator = loop.run('go', controller.signal);
    const first = await iterator.next();
    collected.push(first.value);
    controller.abort();
    for await (const event of iterator) {
      collected.push(event);
    }

    expect(tool.executeFn).not.toHaveBeenCalled();
    expect(collected.some((e) => e.kind === 'tools_complete')).toBe(false);
  });

  it('abort during tool execution cancels in-flight tools and disposes the scheduler', async () => {
    const tool = new MockTool({ name: 'slow_tool' });
    tool.executeFn.mockImplementation(
      (_params, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const controller = new AbortController();
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('slow_tool', 'call-slow'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });

    async function driveAndAbortOnFirstTool(
      loop: AgenticLoop,
      controller: AbortController,
    ): Promise<AgenticLoopEvent[]> {
      const events: AgenticLoopEvent[] = [];
      let sawTool = false;
      for await (const event of loop.run('go', controller.signal)) {
        events.push(event);
        const isFirstToolUpdate = event.kind === 'tool_update' && !sawTool;
        if (isFirstToolUpdate) {
          sawTool = true;
          controller.abort();
        }
      }
      return events;
    }

    const events = await driveAndAbortOnFirstTool(loop, controller);
    const toolUpdates = events.flatMap((event) =>
      event.kind === 'tool_update' ? [event] : [],
    );

    expect(toolUpdates.length).toBeGreaterThan(1);
    expect(
      toolUpdates.some((event) =>
        event.toolCalls.some((call) => call.status === 'cancelled'),
      ),
    ).toBe(true);
    const fresh = await config.getOrCreateScheduler(
      config.getSessionId(),
      {
        onAllToolCallsComplete: async () => {},
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      },
      { interactiveMode: false },
      { messageBus, toolRegistry },
    );
    expect(fresh).toBeDefined();
    config.disposeScheduler(config.getSessionId());
  });

  it('abort returns promptly even when a scheduled tool never settles (no hang)', async () => {
    const tool = new MockTool({ name: 'never_tool' });
    tool.executeFn.mockImplementation(() => new Promise<never>(() => {}));

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const controller = new AbortController();
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('never_tool', 'call-never'), finishedEvent()],
    ]);

    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
    });

    let sawTool = false;
    const run = (async () => {
      for await (const event of loop.run('go', controller.signal)) {
        if (event.kind === 'tool_update' && !sawTool) {
          sawTool = true;
          controller.abort();
        }
      }
    })();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('loop did not terminate')),
        5000,
      );
    });
    try {
      await expect(Promise.race([run, timeout])).resolves.toBeUndefined();
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
    expect(sawTool).toBe(true);

    const fresh = await config.getOrCreateScheduler(
      config.getSessionId(),
      {
        onAllToolCallsComplete: async () => {},
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      },
      { interactiveMode: false },
      { messageBus, toolRegistry },
    );
    expect(fresh).toBeDefined();
    config.disposeScheduler(config.getSessionId());
  });

  it('does not answer a delayed approval request after the loop aborts', async () => {
    const tool = new MockTool({ name: 'approval_tool' });
    tool.shouldConfirm = true;
    tool.executeFn.mockResolvedValue({
      llmContent: 'should not run',
      returnDisplay: 'should not run',
    });
    const toolRegistry = createToolRegistryForTest([tool]);
    const policyEngine = createAskPolicyEngine();
    const messageBus = new MessageBus(policyEngine, false);
    const respondSpy = vi.spyOn(messageBus, 'respondToConfirmation');
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine,
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });

    let resolveApproval:
      | ((result: { outcome: ToolConfirmationOutcome }) => void)
      | undefined;
    let runDone: Promise<void> | undefined;
    const approvalStarted = new Promise<void>((resolve) => {
      const approvalHandler: ApprovalHandler = async () => {
        resolve();
        return new Promise((innerResolve) => {
          resolveApproval = innerResolve;
        });
      };
      const { client } = createScriptedAgentClient([
        [
          toolCallRequestEvent('approval_tool', 'call-approval'),
          finishedEvent(),
        ],
      ]);
      const loop = new AgenticLoop({
        agentClient: client,
        config,
        messageBus,
        approvalHandler,
      });
      const controller = new AbortController();

      runDone = (async () => {
        for await (const event of loop.run('go', controller.signal)) {
          if (event.kind === 'awaiting_approval') {
            controller.abort();
          }
        }
      })();
    });

    await approvalStarted;
    await runDone;
    resolveApproval?.({ outcome: ToolConfirmationOutcome.ProceedOnce });
    await Promise.resolve();

    expect(respondSpy).not.toHaveBeenCalled();
    expect(tool.executeFn).not.toHaveBeenCalled();
  });

  it('early generator return while a tool is running disposes the scheduler', async () => {
    const tool = new MockTool({ name: 'early_return_tool' });
    tool.executeFn.mockImplementation(() => new Promise<never>(() => {}));

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });
    const disposedSessionIds: string[] = [];
    const originalDisposeScheduler = config.disposeScheduler.bind(config);
    vi.spyOn(config, 'disposeScheduler').mockImplementation((sessionId) => {
      disposedSessionIds.push(sessionId);
      originalDisposeScheduler(sessionId);
    });

    const { client } = createScriptedAgentClient([
      [
        toolCallRequestEvent('early_return_tool', 'call-early'),
        finishedEvent(),
      ],
    ]);
    const loop = new AgenticLoop({ agentClient: client, config, messageBus });
    const iterator = loop.run('go', new AbortController().signal);

    let sawRunningTool = false;
    let next = await iterator.next();
    while (next.done !== true && !sawRunningTool) {
      sawRunningTool =
        next.value.kind === 'tool_update' &&
        next.value.toolCalls.some((call) => call.status === 'executing');
      if (!sawRunningTool) {
        next = await iterator.next();
      }
    }

    expect(sawRunningTool).toBe(true);
    await expect(iterator.return(undefined)).resolves.toBeDefined();
    expect(disposedSessionIds.some((id) => id.includes('#agentic-loop#'))).toBe(
      true,
    );
  });

  it('tool_output emitted just before completion is observed by the consumer', async () => {
    const tool = new MockTool({
      name: 'output_tool',
      canUpdateOutput: true,
    });
    tool.executeFn.mockImplementation(
      async (_params, _signal, updateOutput?: (chunk: string) => void) => {
        updateOutput?.('streaming-chunk');
        return {
          llmContent: 'final-output',
          returnDisplay: 'final-output',
        };
      },
    );

    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const config = createTestConfig({
      messageBus,
      toolRegistry,
      policyEngine: createAllowPolicyEngine(),
      interactive: false,
      approvalMode: ApprovalMode.YOLO,
    });

    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('output_tool', 'call-out'), finishedEvent()],
      [contentEvent('done'), finishedEvent()],
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

    expect(tool.executeFn).toHaveBeenCalledTimes(1);
    const outputEvents = events.filter(isToolOutput);
    expect(outputEvents).toStrictEqual([
      { kind: 'tool_output', callId: 'call-out', chunk: 'streaming-chunk' },
    ]);
    const completedEvents = events.filter(isToolsComplete);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0].completed[0].status).toBe('success');
  });
});
