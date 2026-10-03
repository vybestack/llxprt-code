/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import * as crypto from 'node:crypto';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import {
  MessageBusType,
  type ToolConfirmationRequest,
  type ToolConfirmationResponse,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools/types/tool-confirmation-types.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

function registryFor(name: string, executed: string[]): ToolRegistry {
  const tool = new MockTool({
    name,
    shouldConfirmExecute: async () => ({
      type: 'exec',
      title: name,
      command: name,
      rootCommand: name,
      rootCommands: [name],
      onConfirm: async () => {},
    }),
    execute: async () => {
      executed.push(name);
      return { llmContent: name, returnDisplay: name };
    },
  });
  return {
    getTool: (requested: string) => (requested === name ? tool : undefined),
    getFunctionDeclarations: () => [],
    tools: new Map(),
    discovery: {},
    registerTool: () => {},
    getToolByName: () => tool,
    getToolByDisplayName: () => tool,
    getTools: () => [tool],
    discoverTools: async () => {},
    getAllTools: () => [tool],
    getToolsByServer: () => [],
  } as unknown as ToolRegistry;
}

async function pendingApproval(agent: Agent, name: string, executed: string[]) {
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
  const statuses: string[] = [];
  const scheduler = await agent.scheduler.acquire(
    { label: 'same-label' },
    'session',
    {
      onToolCallsUpdate: (calls) => {
        statuses.push(...calls.map((call) => call.status));
      },
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    },
    { interactiveMode: true },
    { messageBus: bus, toolRegistry: registryFor(name, executed) },
  );
  await scheduler.schedule(
    [
      {
        callId: 'same-invocation',
        name,
        args: {},
        isClientInitiated: false,
        prompt_id: 'same-prompt',
      },
    ],
    new AbortController().signal,
  );
  return { request: await request, statuses };
}

describe('session approval bus', () => {
  it('builds an independent bus when fromConfig does not receive a caller bus', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent = await fromConfig({ config: built.config });
      try {
        expect(agent.getMessageBus()).not.toBe(built.messageBus);
        const bus = agent.getMessageBus();
        const unsubscribe = bus.subscribe(
          MessageBusType.TOOL_CONFIRMATION_REQUEST,
          () => {},
        );
        expect(
          bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
        ).toBe(1);
        await agent.dispose();
        expect(
          bus.listenerCount(MessageBusType.TOOL_CONFIRMATION_REQUEST),
        ).toBe(0);
        unsubscribe();
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it('isolates colliding correlation IDs across same-label agents and cancels a pending approval on dispose without closing the borrowed bus', async () => {
    const first = await buildCliStyleConfig('plain-text.jsonl');
    const second = await buildCliStyleConfig('plain-text.jsonl');
    let a: Agent | undefined;
    let b: Agent | undefined;
    try {
      a = await fromConfig({
        config: first.config,
        messageBus: first.messageBus,
        sessionId: 'same-label',
      });
      b = await fromConfig({
        config: second.config,
        messageBus: second.messageBus,
        sessionId: 'same-label',
      });
      const ranA: string[] = [];
      const ranB: string[] = [];
      const fixedId = crypto.randomUUID();
      const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(fixedId);
      let pendingA: Awaited<ReturnType<typeof pendingApproval>>;
      let pendingB: Awaited<ReturnType<typeof pendingApproval>>;
      try {
        pendingA = await pendingApproval(a, 'approval_a', ranA);
        pendingB = await pendingApproval(b, 'approval_b', ranB);
      } finally {
        uuid.mockRestore();
      }
      const collision = pendingA.request.correlationId;
      expect(pendingB.request.correlationId).toBe(collision);
      b.getMessageBus().publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: collision,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(ranB).toStrictEqual(['approval_b']);
      expect(ranA).toStrictEqual([]);
      expect(pendingA.statuses[pendingA.statuses.length - 1]).toBe(
        'awaiting_approval',
      );
      a.getMessageBus().publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: collision,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);
      for (let attempt = 0; attempt < 30 && ranA.length === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(ranA).toStrictEqual(['approval_a']);
      const stillWaiting = await pendingApproval(a, 'approval_pending', []);
      await a.dispose();
      expect(stillWaiting.statuses[stillWaiting.statuses.length - 1]).toBe(
        'cancelled',
      );
      expect(
        first.messageBus.listenerCount(
          MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        ),
      ).toBe(0);
      first.messageBus.publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: stillWaiting.request.correlationId,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);
      b.getMessageBus().publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: pendingB.request.correlationId,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);
      expect(ranB).toStrictEqual(['approval_b']);
      const survived: string[] = [];
      const pendingSurvivor = await pendingApproval(
        b,
        'approval_survivor',
        survived,
      );
      b.getMessageBus().publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: pendingSurvivor.request.correlationId,
        outcome: ToolConfirmationOutcome.ProceedOnce,
      } satisfies ToolConfirmationResponse);
      for (let attempt = 0; attempt < 30 && survived.length === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(survived).toStrictEqual(['approval_survivor']);
    } finally {
      await Promise.all([a?.dispose(), b?.dispose()]);
      await Promise.all([first.cleanup(), second.cleanup()]);
    }
  });
});
