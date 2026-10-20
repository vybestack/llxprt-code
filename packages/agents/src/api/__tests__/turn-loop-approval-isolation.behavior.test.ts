/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createAgenticLoop } from '../runtimeFactories.js';
import { bindTurnModel } from '../../session/bind-turn-model.js';
import { TurnToolExecutionOwner } from '../../session/turn-tool-execution-owner.js';
import { bindSchedulerOwner } from '../../session/assembleSchedulerOwner.js';
import { TaskLaunchOwner } from '../../session/task-launch-owner.js';
import { CoreToolScheduler } from '../../core/coreToolScheduler.js';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { gate } from './helpers/recording-finalizer-join-fixture.js';
import {
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  toolCallRequestEvent,
  finishedEvent,
} from '../../core/agenticLoop/__tests__/agenticLoop-test-helpers.js';
import type { AgenticLoopEvent } from '../../core/agenticLoop/types.js';

async function consume(
  stream: AsyncGenerator<AgenticLoopEvent>,
): Promise<AgenticLoopEvent[]> {
  const events: AgenticLoopEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('public standalone turn approval ownership', () => {
  it('retires one same-label execution without accepting its late approval or completing its waiting sibling', async () => {
    const policy = new PolicyEngine({
      rules: [],
      defaultDecision: PolicyDecision.ASK_USER,
      nonInteractive: false,
    });
    const bus = new MessageBus(policy, false);
    const enteredA = gate();
    const enteredB = gate();
    const approveA = gate();
    const approveB = gate();
    let total = 0;
    const tool = new MockTool({
      name: 'owned_sum',
      messageBus: bus,
      execute: async (args) => {
        if (typeof args.param !== 'string') throw new Error('Missing operand');
        total += Number(args.param);
        return { llmContent: String(total), returnDisplay: String(total) };
      },
    });
    tool.shouldConfirm = true;
    const registry = createToolRegistryForTest([tool]);
    const { config, settingsOwner } = createTestConfig({
      messageBus: bus,
      toolRegistry: registry,
      policyEngine: policy,
      interactive: true,
    });
    const taskLaunchOwner = new TaskLaunchOwner(new AsyncTaskManager());
    function create(
      callId: string,
      operand: number,
      entered: ReturnType<typeof gate>,
      approved: ReturnType<typeof gate>,
    ): ReturnType<typeof createAgenticLoop> {
      const scripted = createScriptedAgentClient([
        [
          toolCallRequestEvent('owned_sum', callId, { param: String(operand) }),
          finishedEvent(),
        ],
        [finishedEvent()],
      ]);
      return createAgenticLoop({
        ...bindTurnModel(scripted.client),
        config,
        interactiveMode: true,
        readShellJobSettings: () => ({
          maxBackgroundJobs: 5,
          logMaxBytes: 1024,
        }),
        taskLaunchOwner,
        acquireTools: (decorateScheduler) =>
          new TurnToolExecutionOwner(
            bus,
            async () => {
              entered.release();
              await approved.promise;
              return { outcome: ToolConfirmationOutcome.ProceedOnce };
            },
            bindSchedulerOwner(
              config,
              bus,
              true,
              registry,
              decorateScheduler((options) => new CoreToolScheduler(options)),
              () => settingsOwner.readToolExecutionPolicy(),
              () => settingsOwner.readToolGovernance([]),
              undefined,
              settingsOwner.telemetry,
            ),
          ),
      });
    }
    const a = create('owner-a', 5, enteredA, approveA);
    const b = create('owner-b', 13, enteredB, approveB);
    const signalA = new AbortController();
    const signalB = new AbortController();
    const workA = consume(a.run('first', signalA.signal));
    const workB = consume(b.run('second', signalB.signal));
    try {
      await Promise.all([enteredA.promise, enteredB.promise]);
      expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(
        2,
      );
      signalA.abort();
      await a.dispose();
      await workA;
      approveA.release();
      await Promise.resolve();
      expect(total).toBe(0);
      expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(
        1,
      );
      approveB.release();
      const events = await workB;
      expect(total).toBe(13);
      expect(
        events
          .filter((event) => event.kind === 'tools_complete')
          .flatMap((event) =>
            event.completed.map((call) => call.request.callId),
          ),
      ).toStrictEqual(['owner-b']);
      expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(
        0,
      );
    } finally {
      signalA.abort();
      signalB.abort();
      approveA.release();
      approveB.release();
      await Promise.allSettled([workA, workB, a.dispose(), b.dispose()]);
      taskLaunchOwner.closeAdmissionAndAbort();
      await taskLaunchOwner.join();
    }
  });
});
