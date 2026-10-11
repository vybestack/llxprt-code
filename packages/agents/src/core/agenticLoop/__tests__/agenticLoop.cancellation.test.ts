import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { CoreToolScheduler } from '../../coreToolScheduler.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import { bindSchedulerOwner } from '../../../session/assembleSchedulerOwner.js';
import { AgenticLoop } from '../AgenticLoop.js';
import type { AgenticLoopEvent } from '../types.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools/types/tool-confirmation-types.js';
import type { LiveOutputUpdate } from '@vybestack/llxprt-code-core';
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
    const { config: config, settingsOwner: configSettingsOwner } =
      createTestConfig({
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
        RootTelemetry.prepare({
          enabled: false,
          sessionId: 'isolated-caller-fixture',
          maxBytes: 1024,
          maxFiles: 1,
        }),
      ),
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
    const { toolUpdates, fresh } =
      await observeAbortDuringToolExecutionCancelsInFlightToolsAndDisposesTheScheduler();
    expect(toolUpdates.length).toBeGreaterThan(1);
    expect(
      toolUpdates.some((event) =>
        event.toolCalls.some((call) => call.status === 'cancelled'),
      ),
    ).toBe(true);
    expect(fresh).toBeDefined();
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
      const { config: config, settingsOwner: configSettingsOwner } =
        createTestConfig({
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
          RootTelemetry.prepare({
            enabled: false,
            sessionId: 'isolated-caller-fixture',
            maxBytes: 1024,
            maxFiles: 1,
          }),
        ),
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

      const fresh = bindSchedulerOwner(
        config,
        messageBus,
        false,
        toolRegistry,
        (options) => new CoreToolScheduler(options),
        () => configSettingsOwner.readToolExecutionPolicy(),
        () =>
          configSettingsOwner.readToolGovernance(
            config.getExcludeTools() ?? [],
          ),
        undefined,
        RootTelemetry.prepare({
          enabled: false,
          sessionId: 'isolated-caller-fixture',
          maxBytes: 1024,
          maxFiles: 1,
        }),
      )({
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      }).acquire();
      await fresh.ready;
      await fresh.release();

      return { toolUpdates, fresh };
    };

  it('abort waits for detached tool work before releasing its scheduler', async () => {
    let finishTool = (): void => {};
    let entered = (): void => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const external = new Promise<void>((resolve) => {
      finishTool = resolve;
    });
    const tool = new MockTool({ name: 'delayed_tool' });
    tool.executeFn.mockImplementation(async () => {
      entered();
      await external;
      return { llmContent: 'finished', returnDisplay: 'finished' };
    });
    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const { config: config, settingsOwner: configSettingsOwner } =
      createTestConfig({
        messageBus,
        toolRegistry,
        policyEngine: createAllowPolicyEngine(),
        interactive: false,
      });
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('delayed_tool', 'delayed'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      createSchedulerOwner: bindSchedulerOwner(
        config,
        messageBus,
        false,
        toolRegistry,
        (options) => new CoreToolScheduler(options),
        () => configSettingsOwner.readToolExecutionPolicy(),
        () =>
          configSettingsOwner.readToolGovernance(
            config.getExcludeTools() ?? [],
          ),
        undefined,
        RootTelemetry.prepare({
          enabled: false,
          sessionId: 'isolated-caller-fixture',
          maxBytes: 1024,
          maxFiles: 1,
        }),
      ),
    });
    const controller = new AbortController();
    let returned = false;
    const run = (async () => {
      for await (const _event of loop.run('go', controller.signal)) {
        /* drain */
      }
      returned = true;
    })();
    try {
      await started;
      controller.abort();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(returned).toBe(false);
      finishTool();
      await run;
      expect(returned).toBe(true);
      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(0);
    } finally {
      finishTool();
      await run;
    }
  });

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
      const { config: config, settingsOwner: configSettingsOwner } =
        createTestConfig({
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
            RootTelemetry.prepare({
              enabled: false,
              sessionId: 'isolated-caller-fixture',
              maxBytes: 1024,
              maxFiles: 1,
            }),
          ),
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

      return { respondSpy, tool };
    };

  it('early generator return waits for external work and removes approval listeners', async () => {
    let finishTool = (): void => {};
    const external = new Promise<void>((resolve) => {
      finishTool = resolve;
    });
    const tool = new MockTool({ name: 'early_return_tool' });
    tool.executeFn.mockImplementation(async () => {
      await external;
      return { llmContent: 'finished', returnDisplay: 'finished' };
    });
    const toolRegistry = createToolRegistryForTest([tool]);
    const messageBus = new MessageBus(createAllowPolicyEngine(), false);
    const { config: config, settingsOwner: configSettingsOwner } =
      createTestConfig({
        messageBus,
        toolRegistry,
        policyEngine: createAllowPolicyEngine(),
        interactive: false,
      });
    const { client } = createScriptedAgentClient([
      [toolCallRequestEvent('early_return_tool', 'early'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({
      agentClient: client,
      config,
      messageBus,
      createSchedulerOwner: bindSchedulerOwner(
        config,
        messageBus,
        false,
        toolRegistry,
        (options) => new CoreToolScheduler(options),
        () => configSettingsOwner.readToolExecutionPolicy(),
        () =>
          configSettingsOwner.readToolGovernance(
            config.getExcludeTools() ?? [],
          ),
        undefined,
        RootTelemetry.prepare({
          enabled: false,
          sessionId: 'isolated-caller-fixture',
          maxBytes: 1024,
          maxFiles: 1,
        }),
      ),
    });
    const iterator = loop.run('go', new AbortController().signal);
    let next = await iterator.next();
    while (
      next.done !== true &&
      !(
        next.value.kind === 'tool_update' &&
        next.value.toolCalls.some((call) => call.status === 'executing')
      )
    )
      next = await iterator.next();
    expect(next.done).toBe(false);
    let returned = false;
    const closing = iterator.return(undefined).then(() => {
      returned = true;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(returned).toBe(false);
      finishTool();
      await closing;
      expect(
        messageBus.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(0);
    } finally {
      finishTool();
      await closing;
    }
  });

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
    const { config: config, settingsOwner: configSettingsOwner } =
      createTestConfig({
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
        RootTelemetry.prepare({
          enabled: false,
          sessionId: 'isolated-caller-fixture',
          maxBytes: 1024,
          maxFiles: 1,
        }),
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
