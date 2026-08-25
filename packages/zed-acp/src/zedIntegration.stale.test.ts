/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';

import { Session } from './zedIntegration.js';
import {
  buildFakeAgent,
  buildScriptedAgent,
  RecordingConnection,
  createSession,
  runPrompt,
  editConfirmation,
} from './zed-test-helpers.js';

const createdSessions: Session[] = [];

async function disposeCreatedSessions(): Promise<void> {
  await Promise.allSettled(
    createdSessions.splice(0).map((session) => session.dispose()),
  );
}

describe('Zed Session.prompt (Agent API) - stale prompt terminal events', () => {
  afterEach(disposeCreatedSessions);

  it('preserves a completed turn when cancellation arrives after done', async () => {
    const sessionRef: { current: Session | null } = { current: null };
    const { agent } = buildFakeAgent([]);
    agent.stream = async function* () {
      yield { type: 'done', reason: 'stop' } as const;
      const currentSession = sessionRef.current;
      if (currentSession === null) throw new Error('Session not initialized');
      await currentSession.cancelPendingPrompt();
    };
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    sessionRef.current = session;
    createdSessions.push(session);

    const response = await runPrompt(session);

    expect(response.stopReason).toBe('end_turn');
  });

  it('returns cancelled (not an error) when a superseded prompt ends with done:error', async () => {
    const toolCallId = 'stale-error-tool';
    let promptCount = 0;
    const { agent } = buildScriptedAgent(() => {
      promptCount += 1;
      return promptCount === 1
        ? [
            {
              type: 'tool-call',
              call: { id: toolCallId, name: 'edit', args: {} },
            },
            editConfirmation('conf-stale-error', toolCallId),
            { type: 'done', reason: 'error' },
          ]
        : [
            { type: 'text', text: 'second' },
            { type: 'done', reason: 'stop' },
          ];
    });
    const connection = new RecordingConnection();
    const gate = connection.armPermissionGate();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    const firstPrompt = runPrompt(session);
    await gate.arrived;
    const secondPrompt = runPrompt(session);
    const firstResponse = await firstPrompt;
    const secondResponse = await secondPrompt;

    expect(firstResponse.stopReason).toBe('cancelled');
    expect(secondResponse.stopReason).toBe('end_turn');
  });

  it('stops consuming a stream at the first event after a prompt becomes stale', async () => {
    let promptCount = 0;
    let staleEventsProduced = 0;
    const { agent } = buildScriptedAgent(() => []);
    agent.stream = async function* () {
      promptCount += 1;
      if (promptCount === 1) {
        yield {
          type: 'tool-call',
          call: { id: 'stale-stop-tool', name: 'edit', args: {} },
        } as const;
        yield editConfirmation('stale-stop-confirmation', 'stale-stop-tool');
        staleEventsProduced += 1;
        yield { type: 'text', text: 'first stale event' } as const;
        staleEventsProduced += 1;
        yield { type: 'text', text: 'second stale event' } as const;
        return;
      }
      yield { type: 'done', reason: 'stop' } as const;
    };
    const connection = new RecordingConnection();
    const gate = connection.armPermissionGate();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    const firstPrompt = runPrompt(session);
    await gate.arrived;
    const secondPrompt = runPrompt(session);
    await firstPrompt;
    await secondPrompt;

    expect(staleEventsProduced).toBe(1);
  });

  it('returns cancelled (not an error) when a cancelled prompt ends with done:hook-stopped', async () => {
    const toolCallId = 'stale-hook-tool';
    const { agent } = buildScriptedAgent(() => [
      { type: 'tool-call', call: { id: toolCallId, name: 'edit', args: {} } },
      editConfirmation('conf-stale-hook', toolCallId),
      { type: 'done', reason: 'hook-stopped' },
    ]);
    const connection = new RecordingConnection();
    const gate = connection.armPermissionGate();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    const firstPrompt = runPrompt(session);
    await gate.arrived;
    await session.cancelPendingPrompt();
    const response = await firstPrompt;
    gate.settle({
      outcome: 'selected',
      optionId: ToolConfirmationOutcome.ProceedOnce,
    });
    await Promise.resolve();

    expect(response.stopReason).toBe('cancelled');
  });
});

describe('Zed Session.prompt (Agent API) - terminal tool-status without tool-result', () => {
  afterEach(disposeCreatedSessions);

  it.each([
    ['success', 'completed'],
    ['error', 'failed'],
    ['cancelled', 'failed'],
  ] as const)(
    'maps tool-status %s to %s even without a tool-result',
    async (status, expected) => {
      const toolCallId = `status-only-${status}`;
      const { agent } = buildFakeAgent([
        {
          type: 'tool-call',
          call: { id: toolCallId, name: 'run_shell_command', args: {} },
        },
        {
          type: 'tool-status',
          update: {
            id: toolCallId,
            name: 'run_shell_command',
            status,
            output: status === 'success' ? 'done' : undefined,
          },
        },
        { type: 'done', reason: 'stop' },
      ]);
      const connection = new RecordingConnection();
      const session = createSession(agent, connection);
      createdSessions.push(session);

      await runPrompt(session);

      const updates = connection.onlySessionUpdates();
      expect((updates[1] as { status: string }).status).toBe(expected);
    },
  );
});
