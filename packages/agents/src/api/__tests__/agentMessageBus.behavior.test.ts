/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent, ToolConfirmation } from '@vybestack/llxprt-code-agents';
import {
  buildAgent,
  drain,
  ToolConfirmationOutcome,
} from './helpers/agentHarness.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

/**
 * @plan:PLAN-20270110-ISSUE2378.P01
 * @requirement:REQ-2378-001
 *
 * BEHAVIORAL suite for the Agent-owned session MessageBus. The agent owns the
 * single session bus; the observable proof that the bus is live is that a tool
 * confirmation raised during a turn reaches `agent.tools.onConfirmationRequest`
 * and is answered through `agent.tools.respondToConfirmation`.
 */

const declinedOutput = join(
  process.cwd(),
  'message-bus-confirmation-output.txt',
);

async function answerConfirmationsDuring(
  agent: Agent,
  turn: () => Promise<unknown>,
): Promise<readonly ToolConfirmation[]> {
  const confirmations: ToolConfirmation[] = [];
  const unsubscribe = agent.tools.onConfirmationRequest((request) => {
    confirmations.push(request);
    agent.tools.respondToConfirmation(
      request.confirmationId,
      ToolConfirmationOutcome.Cancel,
    );
  });
  try {
    await turn();
  } finally {
    unsubscribe();
  }
  return confirmations;
}

describe('Agent.getMessageBus @plan:PLAN-20270110-ISSUE2378.P01 @requirement:REQ-2378-001', () => {
  useFakeResponsesReplay('write-file-then-answer.jsonl');

  it('a fromConfig agent answers a tool confirmation raised during a turn through its own bus', async () => {
    const route = await openRouteAAgent({
      config: { workingDir: process.cwd(), interactive: true },
    });
    try {
      const confirmations = await answerConfirmationsDuring(route.agent, () =>
        drain(route.agent.stream('confirm the tool')),
      );
      expect(confirmations.length).toBeGreaterThanOrEqual(1);
      expect(confirmations[0].confirmationId).toBeTruthy();
      expect(confirmations[0].name).toBe('write_file');
      expect(existsSync(declinedOutput)).toBe(false);
    } finally {
      await route.close();
    }
  });

  it('a createAgent-built agent answers a tool confirmation raised during a turn through its own bus', async () => {
    const { agent, cleanup } = await buildAgent('write-file-then-answer.jsonl');
    try {
      const confirmations = await answerConfirmationsDuring(agent, () =>
        drain(agent.stream('confirm the tool')),
      );
      expect(confirmations.length).toBeGreaterThanOrEqual(1);
      expect(confirmations[0].confirmationId).toBeTruthy();
      expect(confirmations[0].name).toBe('write_file');
      expect(existsSync(declinedOutput)).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
