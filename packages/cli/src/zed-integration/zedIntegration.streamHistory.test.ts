/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for Session.streamHistory restored-session title hydration
 * (issue #1611 finding 2). Exercises the real streamHistory orchestration that
 * load/resume uses (not a faked restoration) to verify the title is hydrated
 * from restored history so a later prompt never retitles the session.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core';

import { Session } from './zedIntegration.js';
import {
  buildFakeAgent,
  RecordingConnection,
  createSession,
} from './zed-test-helpers.js';

const createdSessions: Session[] = [];

async function disposeCreatedSessions(): Promise<void> {
  const sessions = createdSessions.splice(0);
  await Promise.allSettled(sessions.map((session) => session.dispose()));
}

describe('Zed Session.streamHistory - restored-session title hydration (issue #1611 finding 2)', () => {
  afterEach(disposeCreatedSessions);

  it('hydrates the title from restored history so a later prompt does not retitle', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    const history: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Restored session title' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'prior response' }],
      },
    ];
    await session.streamHistory(history);

    expect(session.getLifecycleInfo().title).toBe('Restored session title');

    connection.clearSessionInfoUpdates();
    await session.prompt({
      sessionId: 'test-session-id',
      prompt: [{ type: 'text', text: 'New prompt after restore' }],
    });

    expect(session.getLifecycleInfo().title).toBe('Restored session title');
    const infoUpdates = connection.sessionInfoUpdates();
    expect(infoUpdates).toHaveLength(1);
    expect(infoUpdates[0].title).toBeUndefined();
  });

  it('does not set a title when restored history has no human text', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    const history: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'agent-only content' }],
      },
    ];
    await session.streamHistory(history);

    expect(session.getLifecycleInfo().title).toBeUndefined();
  });

  it('uses the first human text when restored history has multiple human entries', async () => {
    const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
    const connection = new RecordingConnection();
    const session = createSession(agent, connection);
    createdSessions.push(session);

    const history: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'First restored message' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'response one' }],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Second restored message' }],
      },
    ];
    await session.streamHistory(history);

    expect(session.getLifecycleInfo().title).toBe('First restored message');
  });
});
