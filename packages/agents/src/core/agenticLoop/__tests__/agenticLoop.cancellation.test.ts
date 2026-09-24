/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import { AgenticLoop } from '../AgenticLoop.js';
import type { AgenticLoopEvent } from '../types.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools/types/tool-confirmation-types.js';
import type { LiveOutputUpdate } from '@vybestack/llxprt-code-core';
import type { SchedulerPurpose } from '@vybestack/llxprt-code-core/session/sessionSchedulerRegistry.js';
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
      schedulerOwner: config.schedulerOwner,
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
    const { toolUpdates, fresh, loop, disposedEntries } =
      await observeAbortDuringToolExecutionCancelsInFlightToolsAndDisposesTheScheduler();
    expect(toolUpdates.length).toBeGreaterThan(1);
    expect(
      toolUpdates.some((event) =>
        event.toolCalls.some((call) => call.status === 'cancelled'),
      ),
    ).toBe(true);
    expect(fresh).toBeDefined();
    // Abort cleanup must dispose the loop-owned registry entry: the loop
    // instance keyed under the 'agentic-loop' purpose.
    expect(
      disposedEntries.some(
        (entry) => entry.owner === loop && entry.purpose === 'agentic-loop',
      ),
    ).toBe(true);
  });

  const observeAbortDuringToolExecutionCancelsInFlightToolsAndDisposesTheScheduler =
    async () => {
      const tool = new MockTool({ name: 'slow_tool' });
      tool.executeFn.mockImplementation(
        (_params, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            if (signal.aborted) {
              reject(new Error('aborted'));
              return;
            }
            signal.addEventListener(
              'abort',
              () => reject(new Error('aborted')),
              {
                once: true,
              },
            );
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
        schedulerOwner: config.schedulerOwner,
        messageBus,
      });

      // Capture disposeScheduler traffic so the test can prove abort
      // cleanup released the loop-owned registry entry, not merely that a
      // fresh acquisition works afterwards.
      const disposedEntries: Array<{
        owner: object;
        purpose: SchedulerPurpose;
      }> = [];
      const originalRelease = config.schedulerOwner.release.bind(
        config.schedulerOwner,
      );
      vi.spyOn(config.schedulerOwner, 'release').mockImplementation(
        (owner, purpose, handle) => {
          disposedEntries.push({ owner, purpose });
          originalRelease(owner, purpose, handle);
        },
      );

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

      // Fresh owner object: the loop released its own entry, so this proves
      // the registry hands out a working scheduler for a new acquisition.
      const freshOwner = { label: 'post-abort-scheduler' };
      const fresh = await config.schedulerOwner.acquire(
        freshOwner,
        'session',
        {
          onAllToolCallsComplete: async () => {},
          getPreferredEditor: () => undefined,
          onEditorClose: () => {},
        },
        { interactiveMode: false },
        { messageBus, toolRegistry },
      );

      config.schedulerOwner.release(freshOwner, 'session', fresh);

      return { toolUpdates, fresh, loop, disposedEntries };
    };

  it('abort returns promptly even when a scheduled tool never settles (no hang)', async () => {
    const { sawTool, fresh, termination, loop, disposedEntries } =
      await observeAbortReturnsPromptlyEvenWhenAScheduledToolNeverSettlesNoHang();
    expect(termination).toBeUndefined();
    expect(sawTool).toBe(true);
    expect(fresh).toBeDefined();
    // Abort cleanup must dispose the loop-owned registry entry: the loop
    // instance keyed under the 'agentic-loop' purpose.
    expect(
      disposedEntries.some(
        (entry) => entry.owner === loop && entry.purpose === 'agentic-loop',
      ),
    ).toBe(true);
  });

  const observeAbortReturnsPromptlyEvenWhenAScheduledToolNeverSettlesNoHang =
    async () => {
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
        schedulerOwner: config.schedulerOwner,
        messageBus,
      });

      // Capture disposeScheduler traffic so the test can prove abort
      // cleanup released the loop-owned registry entry, not merely that a
      // fresh acquisition works afterwards.
      const disposedEntries: Array<{
        owner: object;
        purpose: SchedulerPurpose;
      }> = [];
      const originalRelease = config.schedulerOwner.release.bind(
        config.schedulerOwner,
      );
      vi.spyOn(config.schedulerOwner, 'release').mockImplementation(
        (owner, purpose, handle) => {
          disposedEntries.push({ owner, purpose });
          originalRelease(owner, purpose, handle);
        },
      );

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
      let termination: void;
      try {
        termination = await Promise.race([run, timeout]);
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }

      // Fresh owner object: the loop released its own entry, so this proves
      // the registry hands out a working scheduler for a new acquisition.
      const freshOwner = { label: 'post-abort-scheduler' };
      const fresh = await config.schedulerOwner.acquire(
        freshOwner,
        'session',
        {
          onAllToolCallsComplete: async () => {},
          getPreferredEditor: () => undefined,
          onEditorClose: () => {},
        },
        { interactiveMode: false },
        { messageBus, toolRegistry },
      );

      config.schedulerOwner.release(freshOwner, 'session', fresh);

      return { sawTool, fresh, termination, loop, disposedEntries };
    };

  it('does not answer a delayed approval request after the loop aborts', async () => {
    const { respondSpy, tool } =
      await observeDoesNotAnswerADelayedApprovalRequestAfterTheLoopAborts();
    expect(respondSpy).not.toHaveBeenCalled();
    expect(tool.executeFn).not.toHaveBeenCalled();
  });

  const observeDoesNotAnswerADelayedApprovalRequestAfterTheLoopAborts =
    async () => {
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
          schedulerOwner: config.schedulerOwner,
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

      return { respondSpy, tool };
    };

  it('early generator return while a tool is running disposes the scheduler', async () => {
    const { sawRunningTool, iterator, disposedOwners } =
      await observeEarlyGeneratorReturnWhileAToolIsRunningDisposesTheScheduler();
    expect(sawRunningTool).toBe(true);
    await expect(iterator.return(undefined)).resolves.toBeDefined();
    expect(disposedOwners.some((owner) => owner instanceof AgenticLoop)).toBe(
      true,
    );
  });

  const observeEarlyGeneratorReturnWhileAToolIsRunningDisposesTheScheduler =
    async () => {
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
      const disposedOwners: object[] = [];
      const originalRelease = config.schedulerOwner.release.bind(
        config.schedulerOwner,
      );
      vi.spyOn(config.schedulerOwner, 'release').mockImplementation(
        (owner, purpose, handle) => {
          disposedOwners.push(owner);
          originalRelease(owner, purpose, handle);
        },
      );

      const { client } = createScriptedAgentClient([
        [
          toolCallRequestEvent('early_return_tool', 'call-early'),
          finishedEvent(),
        ],
      ]);
      const loop = new AgenticLoop({
        agentClient: client,
        config,
        schedulerOwner: config.schedulerOwner,
        messageBus,
      });
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

      return { sawRunningTool, iterator, disposedOwners };
    };

  it('tool_output emitted just before completion is observed by the consumer', async () => {
    const tool = new MockTool({
      name: 'output_tool',
      canUpdateOutput: true,
    });
    tool.executeFn.mockImplementation(
      async (
        _params,
        _signal,
        updateOutput?: (update: LiveOutputUpdate) => void,
      ) => {
        updateOutput?.({ mode: 'append', data: 'streaming-chunk' });
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
      schedulerOwner: config.schedulerOwner,
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
