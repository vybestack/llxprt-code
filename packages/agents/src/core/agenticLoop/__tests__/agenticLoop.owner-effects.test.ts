/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { AgenticLoop } from '../AgenticLoop.js';
import { TurnToolExecutionOwner } from '../../../session/turn-tool-execution-owner.js';
import { bindSchedulerOwner } from '../../../session/assembleSchedulerOwner.js';
import { CoreToolScheduler } from '../../coreToolScheduler.js';
import { recordCompletedToolHistory } from '../loopHelpers.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import {
  createScriptedAgentClient,
  createTestConfig,
  createToolRegistryForTest,
  toolCallRequestEvent,
  finishedEvent,
  collectEvents,
} from './agenticLoop-test-helpers.js';

describe('turn execution ownership effects', () => {
  it('executes only approved tools on the selected bus and keeps one admitted parameter object through continuation', async () => {
    const policy = new PolicyEngine({
      rules: [],
      defaultDecision: PolicyDecision.ASK_USER,
      nonInteractive: false,
    });
    const bus = new MessageBus(policy, false);
    let total = 0;
    const tool = new MockTool({
      name: 'accumulate',
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
    const scripted = createScriptedAgentClient([
      [
        toolCallRequestEvent('accumulate', 'owned-a', { param: '7' }),
        finishedEvent(),
      ],
      [finishedEvent()],
      [
        toolCallRequestEvent('accumulate', 'owned-b', { param: '11' }),
        finishedEvent(),
      ],
      [finishedEvent()],
    ]);
    const seen: Array<AdmittedModelParameters | undefined> = [];
    const first = Object.freeze({
      providerName: 'test',
      modelParams: Object.freeze({ temperature: 0.2 }),
    });
    const second = Object.freeze({
      providerName: 'test',
      modelParams: Object.freeze({ temperature: 0.8 }),
    });
    const tools = new TurnToolExecutionOwner(
      bus,
      async () => ({ outcome: ToolConfirmationOutcome.ProceedOnce }),
      bindSchedulerOwner(
        config,
        bus,
        true,
        registry,
        (options) => new CoreToolScheduler(options),
        () => settingsOwner.readToolExecutionPolicy(),
        () => settingsOwner.readToolGovernance([]),
        undefined,
        settingsOwner.telemetry,
      ),
    );
    const loop = new AgenticLoop({
      config,
      tools,
      streamModel: (message, signal, promptId, recording, parameters) => {
        seen.push(parameters);
        return scripted.client.sendMessageStream(
          message,
          signal,
          promptId,
          undefined,
          false,
          false,
          recording,
          parameters,
        );
      },
      recordToolHistory: (calls) =>
        recordCompletedToolHistory(calls, (content) =>
          scripted.client.addHistory(content),
        ),
    });
    try {
      const firstEvents = [];
      for await (const event of loop.run(
        'first',
        new AbortController().signal,
        undefined,
        undefined,
        first,
      ))
        firstEvents.push(event);
      const secondEvents = [];
      for await (const event of loop.run(
        'later',
        new AbortController().signal,
        undefined,
        undefined,
        second,
      ))
        secondEvents.push(event);
      expect(total).toBe(18);
      expect(
        firstEvents.filter((event) => event.kind === 'tools_complete'),
      ).toHaveLength(1);
      expect(
        secondEvents.filter((event) => event.kind === 'tools_complete'),
      ).toHaveLength(1);
      expect(seen).toHaveLength(4);
      expect(seen[0]).toBe(first);
      expect(seen[1]).toBe(first);
      expect(seen[2]).toBe(second);
      expect(seen[3]).toBe(second);
      expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(
        0,
      );
    } finally {
      loop.retire();
    }
  });

  it('persists denied tool history before returning without a model continuation', async () => {
    const policy = new PolicyEngine({
      rules: [],
      defaultDecision: PolicyDecision.ASK_USER,
      nonInteractive: false,
    });
    const bus = new MessageBus(policy, false);
    let executed = false;
    const tool = new MockTool({
      name: 'denied',
      messageBus: bus,
      execute: async () => {
        executed = true;
        return { llmContent: 'unexpected execution', returnDisplay: '' };
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
    const scripted = createScriptedAgentClient([
      [toolCallRequestEvent('denied', 'denied-call'), finishedEvent()],
    ]);
    const loop = new AgenticLoop({
      config,
      tools: new TurnToolExecutionOwner(
        bus,
        async () => {
          throw new Error('approval rejected');
        },
        bindSchedulerOwner(
          config,
          bus,
          true,
          registry,
          (options) => new CoreToolScheduler(options),
          () => settingsOwner.readToolExecutionPolicy(),
          () => settingsOwner.readToolGovernance([]),
          undefined,
          settingsOwner.telemetry,
        ),
      ),
      streamModel: (message, signal, promptId, recording, parameters) =>
        scripted.client.sendMessageStream(
          message,
          signal,
          promptId,
          undefined,
          false,
          false,
          recording,
          parameters,
        ),
      recordToolHistory: (calls) =>
        recordCompletedToolHistory(calls, (content) =>
          scripted.client.addHistory(content),
        ),
    });
    try {
      const events = await collectEvents(
        loop,
        'deny',
        new AbortController().signal,
      );
      expect(executed).toBe(false);
      expect(scripted.turnMessages).toHaveLength(1);
      expect(
        scripted.history
          .flatMap((content) => content.blocks)
          .some((block) => block.type === 'tool_response'),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.kind === 'tools_complete' &&
            event.completed.every((call) => call.status === 'cancelled'),
        ),
      ).toBe(true);
      expect(bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST)).toBe(
        0,
      );
    } finally {
      loop.retire();
    }
  });
});
