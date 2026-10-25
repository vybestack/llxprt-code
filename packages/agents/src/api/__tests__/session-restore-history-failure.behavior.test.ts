/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { replaySession } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-settings';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { openClientOwner } from './helpers/client-owner-session.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

const human = (text: string) => ({
  speaker: 'human' as const,
  blocks: [{ type: 'text' as const, text }],
});
const ai = (text: string) => ({
  speaker: 'ai' as const,
  blocks: [{ type: 'text' as const, text }],
});

/**
 * The `/chat restore` command asks the session to drop the last human-led
 * turn. When the client publishes the shortened history and then fails, the
 * session must put the live history and the durable recording back. The
 * client's restoration has no Agent form and no public input makes it fail
 * after publication, so the subject is the SessionControl a
 * SessionClientOwner builds over its real client, with a one-shot fault
 * wrapped around that client's `restoreHistory` (the same form as the
 * restoreTurns fault in session-owner-restore-checkpoint.behavior.test.ts).
 */
describe('SessionControl restoreTurns when client restoration fails after publishing history', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();

  it('keeps the live and durable history of a trailing unanswered turn', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'restore-history-failure-')),
    );
    const projectTempDir = new Storage(directory).getProjectTempDir();
    const opened = await openClientOwner(
      credentials().authority,
      {
        provider: 'fake',
        model: 'fake-model',
        workingDir: directory,
        interactive: true,
        harness: { includeProcessCwd: false },
      },
      { provider: 'fake', model: 'fake-model' },
    );
    const session = opened.owner.createSessionControl(
      'facade',
      () => 'restore-history-failure-runtime',
      (operation) => operation(),
      () => {},
      () => {},
      () => 'fake',
      () => 'fake-model',
    );
    try {
      const client = opened.client;
      await client.restoreHistory([human('first'), ai('one'), human('second')]);
      await session.setRecording({ enabled: true });
      const path = session.getRecording().path;
      if (!path) throw new Error('Recording path missing');

      const original = client.restoreHistory.bind(client);
      const fault = spyOn(client, 'restoreHistory').mockImplementationOnce(
        async (...args) => {
          await original(...args);
          throw new Error('restore interrupted');
        },
      );
      try {
        await expect(session.restoreTurns(1)).rejects.toThrow(
          'restore interrupted',
        );
      } finally {
        fault.mockRestore();
      }

      await session.flushRecording();
      const replay = await replaySession(path, basename(projectTempDir));
      if (!replay.ok) throw new Error(replay.error);
      expect(JSON.stringify(replay.history)).toContain('second');
      expect(JSON.stringify(await session.getHistory())).toContain('second');
    } finally {
      await runCleanupSteps([
        () => session.dispose(),
        () => opened.close(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  }, 30000);
});
