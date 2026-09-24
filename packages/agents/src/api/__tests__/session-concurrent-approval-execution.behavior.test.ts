/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import {
  MessageBusType,
  type ToolConfirmationRequest,
  type ToolConfirmationResponse,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { CoreToolScheduler } from '../../core/coreToolScheduler.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { buildAgent, internalConfig } from './helpers/agentHarness.js';

type Scheduler = Awaited<ReturnType<Agent['scheduler']['acquire']>>;

interface ScheduledApproval {
  readonly request: Promise<ToolConfirmationRequest>;
  readonly settled: Promise<void>;
  readonly statuses: string[];
  readonly completed: string[];
}

function appendCommand(path: string, marker: string): string {
  if (process.platform === 'win32') {
    return `Add-Content -LiteralPath '${path}' -Value '${marker}'`;
  }
  return `printf '${marker}\\n' >> '${path}'`;
}

function scheduleShellApproval(
  agent: Agent,
  scheduler: Scheduler,
  callId: string,
  command: string,
  signal: AbortSignal,
): ScheduledApproval {
  const statuses: string[] = [];
  const completed: string[] = [];
  const bus = agent.getMessageBus();
  const request = new Promise<ToolConfirmationRequest>((resolve) => {
    const unsubscribe = bus.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (message) => {
        unsubscribe();
        resolve(message);
      },
    );
  });
  scheduler.setCallbacks({
    config: internalConfig(agent),
    onToolCallsUpdate: (calls) => {
      statuses.push(...calls.map((call) => call.status));
    },
    onAllToolCallsComplete: async (calls) => {
      completed.push(...calls.map((call) => call.request.callId));
    },
    getPreferredEditor: () => undefined,
    onEditorClose: () => {},
  });
  const settled = scheduler.schedule(
    [
      {
        callId,
        name: 'run_shell_command',
        args: { command, description: `append ${callId}` },
        isClientInitiated: false,
        prompt_id: 'identical-prompt',
      },
    ],
    signal,
  );
  return { request, settled, statuses, completed };
}

function approve(agent: Agent, correlationId: string): void {
  agent.getMessageBus().publish({
    type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
    correlationId,
    outcome: ToolConfirmationOutcome.ProceedOnce,
  } satisfies ToolConfirmationResponse);
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}

function lines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);
}

describe('same-label concurrent approval execution', () => {
  it('routes approvals to real schedulers exactly once and supports cancellation with retry @requirement:REQ-2615', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'llxprt-s8-approvals-'));
    const outputA = join(outputDir, 'owner-a.log');
    const outputB = join(outputDir, 'owner-b.log');
    const created = await buildAgent('plain-text.jsonl', {
      sessionId: 'identical-session-label',
    });
    const adoptedConfig = await buildCliStyleConfig('plain-text.jsonl');
    let adopted: Agent | undefined;
    let schedulerA: Scheduler | undefined;
    let schedulerB: Scheduler | undefined;

    try {
      adopted = await fromConfig({
        config: adoptedConfig.config,
        messageBus: adoptedConfig.messageBus,
        sessionId: 'identical-session-label',
      });
      const callbacks = {
        getPreferredEditor: () => undefined,
        onEditorClose: () => {},
      };
      schedulerA = await created.agent.scheduler.acquire(
        created.agent,
        'session',
        callbacks,
        { interactiveMode: true },
        {
          messageBus: created.agent.getMessageBus(),
          toolRegistry: internalConfig(created.agent).getToolRegistry(),
        },
      );
      schedulerB = await adopted.scheduler.acquire(
        adopted,
        'session',
        callbacks,
        { interactiveMode: true },
        {
          messageBus: adopted.getMessageBus(),
          toolRegistry: adoptedConfig.config.getToolRegistry(),
        },
      );

      expect(schedulerA).toBeInstanceOf(CoreToolScheduler);
      expect(schedulerB).toBeInstanceOf(CoreToolScheduler);
      expect(schedulerA).not.toBe(schedulerB);
      expect(created.agent.getMessageBus()).not.toBe(adopted.getMessageBus());

      const initialA = scheduleShellApproval(
        created.agent,
        schedulerA,
        'same-invocation',
        appendCommand(outputA, 'owner-a-once'),
        new AbortController().signal,
      );
      const initialB = scheduleShellApproval(
        adopted,
        schedulerB,
        'same-invocation',
        appendCommand(outputB, 'owner-b-once'),
        new AbortController().signal,
      );
      const [requestA, requestB] = await Promise.all([
        initialA.request,
        initialB.request,
      ]);

      approve(adopted, requestA.correlationId);
      approve(created.agent, requestB.correlationId);
      expect(initialA.statuses[initialA.statuses.length - 1]).toBe(
        'awaiting_approval',
      );
      expect(initialB.statuses[initialB.statuses.length - 1]).toBe(
        'awaiting_approval',
      );
      expect(lines(outputA)).toStrictEqual([]);
      expect(lines(outputB)).toStrictEqual([]);

      approve(created.agent, requestA.correlationId);
      approve(adopted, requestB.correlationId);
      await waitUntil(
        () =>
          initialA.completed.includes('same-invocation') &&
          initialB.completed.includes('same-invocation'),
      );
      expect(lines(outputA)).toStrictEqual(['owner-a-once']);
      expect(lines(outputB)).toStrictEqual(['owner-b-once']);

      approve(created.agent, requestA.correlationId);
      approve(adopted, requestB.correlationId);
      await Promise.all([initialA.settled, initialB.settled]);
      expect(initialA.completed).toStrictEqual(['same-invocation']);
      expect(initialB.completed).toStrictEqual(['same-invocation']);
      expect(lines(outputA)).toStrictEqual(['owner-a-once']);
      expect(lines(outputB)).toStrictEqual(['owner-b-once']);

      const cancelledController = new AbortController();
      const cancelled = scheduleShellApproval(
        created.agent,
        schedulerA,
        'cancelled-invocation',
        appendCommand(outputA, 'must-not-run'),
        cancelledController.signal,
      );
      const cancelledRequest = await cancelled.request;
      schedulerA.cancelAll();
      cancelledController.abort();
      await waitUntil(
        () => cancelled.statuses[cancelled.statuses.length - 1] === 'cancelled',
      );
      approve(created.agent, cancelledRequest.correlationId);
      await cancelled.settled;
      expect(cancelled.completed).toStrictEqual(['cancelled-invocation']);
      expect(lines(outputA)).toStrictEqual(['owner-a-once']);
      expect(lines(outputB)).toStrictEqual(['owner-b-once']);

      const retry = scheduleShellApproval(
        created.agent,
        schedulerA,
        'retry-invocation',
        appendCommand(outputA, 'owner-a-retry'),
        new AbortController().signal,
      );
      const retryRequest = await retry.request;
      approve(created.agent, retryRequest.correlationId);
      await waitUntil(() => retry.completed.includes('retry-invocation'));
      await retry.settled;
      expect(retry.completed).toStrictEqual(['retry-invocation']);
      expect(lines(outputA)).toStrictEqual(['owner-a-once', 'owner-a-retry']);
      expect(lines(outputB)).toStrictEqual(['owner-b-once']);
    } finally {
      if (schedulerA !== undefined) {
        created.agent.scheduler.release(created.agent, 'session', schedulerA);
      }
      if (schedulerB !== undefined && adopted !== undefined) {
        adopted.scheduler.release(adopted, 'session', schedulerB);
      }
      await Promise.all([created.cleanup(), adopted?.dispose()]);
      await adoptedConfig.cleanup();
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 30000);
});
