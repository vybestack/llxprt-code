/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Session } from './zedIntegration.js';
import {
  buildFakeAgent,
  RecordingConnection,
  createSession,
  runPrompt,
} from './zed-test-helpers.js';

const createdSessions: Session[] = [];

async function disposeCreatedSessions(): Promise<void> {
  await Promise.allSettled(
    createdSessions.splice(0).map((session) => session.dispose()),
  );
}

describe('Zed Session.prompt (Agent API) - stream flush ordering', () => {
  afterEach(disposeCreatedSessions);

  it('flushes pending text before returning for loop detection', async () => {
    const { agent } = buildFakeAgent([
      { type: 'text', text: 'before loop' },
      { type: 'loop-detected' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    const response = await runPrompt(session);

    expect(response.stopReason).toBe('end_turn');
    expect(connection.sessionUpdateKinds()).toStrictEqual([
      'agent_message_chunk',
    ]);
  });

  it('flushes pending text before processing usage', async () => {
    const { agent } = buildFakeAgent([
      { type: 'text', text: 'before usage' },
      {
        type: 'usage',
        usage: { promptTokenCount: 10, candidatesTokenCount: 5 },
      },
      { type: 'done', reason: 'stop' },
    ]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    await runPrompt(session);

    expect(connection.sessionUpdateKinds()).toStrictEqual([
      'agent_message_chunk',
      'usage_update',
    ]);
  });
});
