/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { recordedRows } from './support/recorded-rows.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
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

type RestoreSession = ReturnType<
  Awaited<ReturnType<typeof openClientOwner>>['owner']['createSessionControl']
>;

/**
 * The `/chat restore` command asks the session to drop the last human-led
 * turn. The client's restoration has no Agent form and no public input makes
 * it fail after publication or exposes its history writes, so the subject is
 * the SessionControl a SessionClientOwner builds over its real client, with
 * instance wrappers on that client (the same form as the restoreTurns fault in
 * session-owner-restore-checkpoint.behavior.test.ts).
 */
describe('SessionControl restoreTurns over its real client', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();

  async function withRestoreSession(
    scenario: (route: {
      readonly session: RestoreSession;
      readonly client: AgentClientContract;
      readonly projectTempDir: string;
    }) => Promise<void>,
  ): Promise<void> {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'restore-history-')),
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
      () => 'restore-history-runtime',
      (operation) => operation(),
      () => {},
      () => {},
      () => 'fake',
      () => 'fake-model',
    );
    try {
      await scenario({ session, client: opened.client, projectTempDir });
    } finally {
      await runCleanupSteps([
        () => session.dispose(),
        () => opened.close(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  }

  it('restores through the client restoration and never writes the client history', async () => {
    await withRestoreSession(async ({ session, client }) => {
      await client.restoreHistory([
        human('first'),
        ai('one'),
        human('second'),
        ai('two'),
      ]);
      await session.setRecording({ enabled: true });
      const setHistory = spyOn(client, 'setHistory');
      try {
        await session.restoreTurns(1);
        expect(setHistory).not.toHaveBeenCalled();
      } finally {
        setHistory.mockRestore();
      }
      const restored = JSON.stringify(await session.getHistory());
      expect(restored).toContain('first');
      expect(restored).not.toContain('second');
    });
  }, 30000);

  it('keeps the live and durable history of a trailing unanswered turn when client restoration fails after publishing history', async () => {
    await withRestoreSession(async ({ session, client, projectTempDir }) => {
      await client.restoreHistory([human('first'), ai('one'), human('second')]);
      await session.setRecording({ enabled: true });
      const path = session.getRecording().path;
      if (!path) throw new Error('Recording path missing');

      const original = client.resetChat.bind(client);
      const fault = spyOn(client, 'resetChat').mockImplementationOnce(
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
      const replay = await recordedRows(path, basename(projectTempDir));
      expect(JSON.stringify(replay)).toContain('second');
      expect(JSON.stringify(await session.getHistory())).toContain('second');
    });
  }, 30000);
});
