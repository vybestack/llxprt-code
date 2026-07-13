/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for session_info_update remediation findings (issue #1611):
 * - Finding 1: title eligibility consumed synchronously at acceptance, race-safe.
 * - Finding 3: slash command success/failure shares exact-once metadata finally.
 * - Finding 4: pre-turn listing timestamp stable (initialized once).
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { Session } from './zedIntegration.js';
import {
  buildFakeAgent,
  buildScriptedAgent,
  RecordingConnection,
  createSession,
  editConfirmation,
} from './zed-test-helpers.js';

const createdSessions: Session[] = [];

async function disposeCreatedSessions(): Promise<void> {
  for (const session of createdSessions.splice(0)) {
    await session.dispose();
  }
}

describe('Zed Session - session_info_update findings (issue #1611 remediation)', () => {
  afterEach(disposeCreatedSessions);

  it('finding 1: the first ACCEPTED prompt wins the title even if a later overlapping prompt finishes first', async () => {
    let promptCount = 0;
    const { agent } = buildScriptedAgent(() => {
      promptCount += 1;
      return promptCount === 1
        ? [
            {
              type: 'tool-call',
              call: { id: 'race-tool', name: 'edit', args: {} },
            },
            editConfirmation('race-conf', 'race-tool'),
            { type: 'done', reason: 'stop' },
          ]
        : [
            { type: 'text', text: 'second response' },
            { type: 'done', reason: 'stop' },
          ];
    });
    const connection = new RecordingConnection();
    const gate = connection.armPermissionGate();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    const firstPrompt = session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'Prompt A title' }],
    });
    await gate.arrived;
    const secondPrompt = session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'Prompt B title' }],
    });
    const firstResponse = await firstPrompt;
    const secondResponse = await secondPrompt;

    expect(firstResponse.stopReason).toBe('cancelled');
    expect(secondResponse.stopReason).toBe('end_turn');

    const info = session.getLifecycleInfo();
    expect(info.title).toBe('Prompt A title');
  });

  it('finding 1: a no-text first prompt consumes eligibility so a later text prompt does not retitle', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'resource_link', uri: 'file:///p', name: 'p.ts' }],
    });
    connection.clearSessionInfoUpdates();

    await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'Should not become the title' }],
    });

    expect(session.getLifecycleInfo().title).toBeUndefined();
  });

  it('finding 3: a slash command emits exact-once session_info_update metadata (updatedAt)', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: '/tools' }],
    });

    const infoUpdates = connection.sessionInfoUpdates();
    expect(infoUpdates).toHaveLength(1);
    expect(infoUpdates[0].updatedAt).toStrictEqual(expect.any(String));
  });

  it('finding 3: a slash command as the first text prompt still wins the title (shared finally)', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: '/help me with something' }],
    });

    const infoUpdates = connection.sessionInfoUpdates();
    expect(infoUpdates).toHaveLength(1);
    expect(infoUpdates[0].title).toBe('/help me with something');
  });

  it('retries a title notification after a transient transport failure without failing either prompt', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    connection.failSessionUpdateAfter(0, new Error('transport down'));
    const session = createSession(agent, connection);
    createdSessions.push(session);

    const first = await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'Persistent title' }],
    });
    expect(first.stopReason).toBe('end_turn');
    expect(connection.sessionInfoUpdates()).toHaveLength(0);

    connection.clearSessionUpdateFailure();
    const second = await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'Second prompt' }],
    });
    expect(second.stopReason).toBe('end_turn');
    expect(connection.sessionInfoUpdates()).toContainEqual(
      expect.objectContaining({ title: 'Persistent title' }),
    );
  });

  it('finding 4: getLifecycleInfo returns a stable updatedAt before the first turn', () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    const first = session.getLifecycleInfo();
    const second = session.getLifecycleInfo();
    expect(first.updatedAt).toBe(second.updatedAt);
  });
});
