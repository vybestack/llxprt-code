/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the #3221 Agent-facade Task boundary.
 *
 * The Task is a thin facade over a public Agent. Under the LLXPRT_FAKE_RESPONSES
 * production seam only FakeProvider is registered and set active, so every
 * observable assertion goes through the PUBLIC Agent facade (stream events
 * from acceptUserMessage, metadata accessors, confirmation flow) — never through
 * Config or mock call counts.
 *
 * The confirmation flow resolves through agent.tools.respondToConfirmation;
 * the scheduler handoff / _sendTextContent / cancelPendingTools /
 * acceptAgentMessage / buildLlmPartsFromToolCalls internals no longer exist and
 * their old pinning tests are re-expressed here as public-surface behavior.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { createTaskAgent } from '../config/config.js';
import { Task } from './task.js';
import type { ToolConfirmation } from '@vybestack/llxprt-code-agents';

const WORKSPACE = mkdtempSync(join(tmpdir(), 'a2a-taskfacade-'));
const FIXTURE = join(WORKSPACE, 'fake-responses.jsonl');
writeFileSync(
  FIXTURE,
  JSON.stringify({
    chunks: [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'a plain text reply' }] },
    ],
  }) + '\n',
);

async function buildAgent(): Promise<Agent> {
  return createTaskAgent({}, [], 'task-facade');
}

async function disposeAgent(agent: Agent): Promise<void> {
  await agent.dispose();
}

async function drainTypes(agent: Agent, text: string): Promise<string[]> {
  const task = await Task.create('task-id', 'context-id', agent);
  const types: string[] = [];
  for await (const event of task.acceptUserMessage(
    { userMessage: { parts: [{ kind: 'text', text }] } } as never,
    new AbortController().signal,
  )) {
    types.push(event.type);
  }
  return types;
}

const SAVED_ENV: Record<string, string | undefined> = {
  ...process.env,
};
describe('Task over the Agent facade (#3221)', () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (SAVED_ENV[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = SAVED_ENV[key];
      }
    }
  });

  it('streams a plain-text turn and yields text + done events', async () => {
    process.env.LLXPRT_FAKE_RESPONSES = FIXTURE;
    const agent = await buildAgent();
    try {
      const types = await drainTypes(agent, 'hello');
      expect(types).toContain('text');
      expect(types[types.length - 1]).toBe('done');
      const done = types.filter((t) => t === 'done');
      expect(done).toHaveLength(1);
    } finally {
      await disposeAgent(agent);
    }
  }, 30_000);

  it('getMetadata is sync and reports id, contextId, model, availableTools', async () => {
    process.env.LLXPRT_FAKE_RESPONSES = FIXTURE;
    const agent = await buildAgent();
    try {
      const task = await Task.create('task-id', 'context-id', agent);
      const metadata = task.getMetadata();
      expect(metadata.id).toBe('task-id');
      expect(metadata.contextId).toBe('context-id');
      expect(metadata.taskState).toBe('submitted');
      expect(typeof metadata.model).toBe('string');
      expect(Array.isArray(metadata.mcpServers)).toBe(true);
      expect(Array.isArray(metadata.availableTools)).toBe(true);
    } finally {
      await disposeAgent(agent);
    }
  }, 30_000);

  it('agentFacade exposes the Agent and delegating calls reach it', async () => {
    process.env.LLXPRT_FAKE_RESPONSES = FIXTURE;
    const agent = await buildAgent();
    try {
      const task = await Task.create('task-id', 'context-id', agent);
      expect(task.agentFacade).toBe(agent);
      // Steer text delegates to the Agent facade (no-op without an active turn).
      expect(() => task.injectSteerText('steer')).not.toThrow();
    } finally {
      await disposeAgent(agent);
    }
  }, 30_000);

  it('cancelTurn while idle does not throw', async () => {
    process.env.LLXPRT_FAKE_RESPONSES = FIXTURE;
    const agent = await buildAgent();
    try {
      const task = await Task.create('task-id', 'context-id', agent);
      expect(() => task.cancelTurn()).not.toThrow();
    } finally {
      await disposeAgent(agent);
    }
  }, 30_000);

  it('pending-confirmation bookkeeping maps a2a callIds; unknown ids fail fast on the real Agent', async () => {
    process.env.LLXPRT_FAKE_RESPONSES = FIXTURE;
    const agent = await buildAgent();
    try {
      const task = await Task.create('task-id', 'context-id', agent);
      const confirmation: ToolConfirmation = {
        confirmationId: 'confirm-1',
        toolCallId: 'call-1',
        name: 'noop',
        details: {},
      };
      expect(task.hasPendingConfirmation('call-1')).toBe(false);
      task.recordPendingConfirmation(confirmation);
      expect(task.hasPendingConfirmation('call-1')).toBe(true);
      expect(task.shouldAutoApproveToolCalls()).toBe(false);
      // The real Agent rejects responses for confirmations it never issued —
      // the facade must not swallow that fail-fast contract.
      expect(() =>
        agent.tools.respondToConfirmation(
          'confirm-1',
          ToolConfirmationOutcome.ProceedOnce,
        ),
      ).toThrow(/unknown confirmationId/);
      // The entry stays pending until the executor resolves it.
      expect(task.hasPendingConfirmation('call-1')).toBe(true);
    } finally {
      await disposeAgent(agent);
    }
  }, 30_000);

  it('a tool-call fixture surfaces tool-call/done events and completes under an onApproval responder', async () => {
    const filesResponses = join(WORKSPACE, 'responses.jsonl');
    writeFileSync(
      filesResponses,
      '{"chunks":[{"speaker":"ai","blocks":[{"type":"tool_call","id":"call-t","name":"list_files","parameters":{"dir":"{{CWD}}"}}]}]}\n' +
        '{"chunks":[{"speaker":"ai","blocks":[{"type":"text","text":"after tool"}]}]}\n',
    );
    process.env.LLXPRT_FAKE_RESPONSES = filesResponses;
    const { createTaskAgent: build } = await import('../config/config.js');
    const agent = await build({}, [], 'facade-tool');
    try {
      // Subscribe to the real Agent confirmation surface: auto-answering with
      // ProceedOnce lets the FakeProvider's list_files tool run headlessly.
      const unsubscribe = agent.tools.onConfirmationRequest(
        (req: ToolConfirmation) => {
          agent.tools.respondToConfirmation(
            req.confirmationId,
            ToolConfirmationOutcome.ProceedOnce,
          );
        },
      );
      try {
        const task = await Task.create('facade-tool', 'ctx', agent);
        const events: string[] = [];
        for await (const event of task.acceptUserMessage(
          {
            userMessage: { parts: [{ kind: 'text', text: 'run tool' }] },
          } as never,
          new AbortController().signal,
        )) {
          events.push(event.type);
        }
        expect(events).toContain('tool-call');
        expect(events[events.length - 1]).toBe('done');
      } finally {
        unsubscribe();
      }
    } finally {
      await disposeAgent(agent);
    }
  }, 30_000);
});
