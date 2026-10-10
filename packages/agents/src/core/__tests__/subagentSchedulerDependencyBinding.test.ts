import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { describe, it, expect } from 'bun:test';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import {
  ToolRegistry,
  ToolConfirmationOutcome,
} from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { assembleSchedulerOwner } from '../../session/assembleSchedulerOwner.js';
import {
  createAskPolicyEngine,
  createTestConfig,
} from '../agenticLoop/__tests__/agenticLoop-test-helpers.js';

function registry(
  bus: MessageBus,
  name: string,
  effects: string[],
): ToolRegistry {
  const tools = new ToolRegistry(
    {},
    bus,
    assembleTaskSchemaPolicy({
      get: () => undefined,
      getAllGlobalSettings: () => ({}),
    }),
  );
  tools.registerTool(
    new MockTool({
      name,
      shouldConfirmExecute: async () => ({
        type: 'exec',
        title: `Confirm ${name}`,
        command: name,
        rootCommand: name,
        rootCommands: [name],
        onConfirm: async () => {},
      }),
      execute: async () => {
        effects.push(name);
        return { llmContent: 'executed', returnDisplay: 'executed' };
      },
    }),
  );
  return tools;
}

describe('subagent scheduler dependency binding', () => {
  it('routes each owner approval and execution through its captured bus and registry', async () => {
    const policy = createAskPolicyEngine();
    const busA = new MessageBus(policy, false);
    const busB = new MessageBus(policy, false);
    const effectsA: string[] = [];
    const effectsB: string[] = [];
    const toolsA = registry(busA, 'effect_a', effectsA);
    const toolsB = registry(busB, 'effect_b', effectsB);
    const { config: foreground, settingsOwner } = createTestConfig({
      toolRegistry: toolsA,
      policyEngine: policy,
      messageBus: busA,
      interactive: true,
      approvalMode: ApprovalMode.DEFAULT,
    });
    const requestsB: ToolConfirmationRequest[] = [];
    let received!: (request: ToolConfirmationRequest) => void;
    const requestA = new Promise<ToolConfirmationRequest>((resolve) => {
      received = resolve;
    });
    let finishA!: (calls: CompletedToolCall[]) => void;
    const completionA = new Promise<CompletedToolCall[]>((resolve) => {
      finishA = resolve;
    });
    let finishB!: (calls: CompletedToolCall[]) => void;
    const completionB = new Promise<CompletedToolCall[]>((resolve) => {
      finishB = resolve;
    });
    const ownerB = assembleSchedulerOwner('same-label', {
      telemetry: RootTelemetry.prepare({
        enabled: false,
        sessionId: 'isolated-caller-fixture',
        maxBytes: 1024,
        maxFiles: 1,
      }),
      config: foreground,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(foreground.getExcludeTools() ?? []),
      messageBus: busB,
      toolRegistry: toolsB,
      toolContextInteractiveMode: true,
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
      onAllToolCallsComplete: async (calls) => {
        finishB(calls);
      },
    });
    const ownerA = assembleSchedulerOwner('same-label', {
      telemetry: RootTelemetry.prepare({
        enabled: false,
        sessionId: 'isolated-caller-fixture',
        maxBytes: 1024,
        maxFiles: 1,
      }),
      config: foreground,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(foreground.getExcludeTools() ?? []),
      messageBus: busA,
      toolRegistry: toolsA,
      toolContextInteractiveMode: true,
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
      onAllToolCallsComplete: async (calls) => {
        finishA(calls);
      },
    });
    const unsubscribeA = busA.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      received,
    );
    const unsubscribeB = busB.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (request) => {
        requestsB.push(request);
      },
    );
    const leaseB = ownerB.acquire();
    const leaseA = ownerA.acquire();
    let unsubscribeApprovalB = (): void => {};
    try {
      await Promise.all([leaseB.ready, leaseA.ready]);
      const executionA = leaseA.schedule({
        callId: 'call-a',
        name: 'effect_a',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-a',
        agentId: 'a',
      });
      const approvalA = await requestA;
      expect(requestsB).toHaveLength(0);
      busB.publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: approvalA.correlationId,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(effectsA).toHaveLength(0);
      expect(effectsB).toHaveLength(0);
      busA.publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: approvalA.correlationId,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      });
      await executionA;
      expect((await completionA)[0]?.status).toBe('success');
      expect(effectsA).toStrictEqual(['effect_a']);
      await leaseA.release();
      expect(
        busA.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(0);
      expect(
        busB.listenerCount(MessageBusType.TOOL_CONFIRMATION_RESPONSE),
      ).toBe(1);
      unsubscribeApprovalB = busB.subscribe<ToolConfirmationRequest>(
        MessageBusType.TOOL_CONFIRMATION_REQUEST,
        (request) => {
          queueMicrotask(() =>
            busB.publish({
              type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
              correlationId: request.correlationId,
              outcome: ToolConfirmationOutcome.ProceedOnce,
            }),
          );
        },
      );
      await leaseB.schedule({
        callId: 'call-b',
        name: 'effect_b',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-b',
        agentId: 'b',
      });
      expect((await completionB)[0]?.status).toBe('success');
      expect(effectsB).toStrictEqual(['effect_b']);
      expect(effectsA).toHaveLength(1);
    } finally {
      await Promise.all([leaseA.release(), leaseB.release()]);
      unsubscribeA();
      unsubscribeB();
      unsubscribeApprovalB();
    }
  });
});
