/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { openClientOwner } from './helpers/client-owner-session.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';
import type { SessionControl } from '../control/sessionControl.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

const human = (text: string) => ({
  speaker: 'human' as const,
  blocks: [{ type: 'text' as const, text }],
});

async function seedSession(route: RouteAAgent, text: string): Promise<string> {
  const { agent } = route;
  await agent.setHistory([human(text)]);
  await agent.session.setRecording({ enabled: true });
  const path = agent.session.getRecording().path;
  if (!path) throw new Error('Seed recording path missing');
  await agent.session.setRecording({ enabled: false });
  await agent.dispose();
  return path;
}

async function chatsFiles(
  chatsDir: string,
  suffix: string,
): Promise<readonly string[]> {
  return (await readdir(chatsDir)).filter((file) => file.endsWith(suffix));
}

/**
 * The CLI's `--continue` startup (`cliSessionBootstrap`) calls
 * `session.resume('latest', { startup: true, onStartupRestoreFailure })`; when
 * restoring the resumed history into the client fails it reports the failure
 * and starts a fresh recording. The restoration has no Agent form, so the
 * subject is the SessionControl a SessionClientOwner builds over its real
 * client, with the one-shot fault on that client's `restoreHistory`
 * (the same form as the restoreTurns fault in
 * session-owner-restore-checkpoint.behavior.test.ts).
 */
describe('SessionControl startup resume when client history restoration fails', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();

  it('reports the failure, keeps the latest recording intact, releases its lock and records a fresh session', async () => {
    const older = await openRouteAAgent({
      authority: credentials().authority,
      config: { interactive: true },
    });
    const latest = await openRouteAAgent({
      authority: credentials().authority,
      config: { interactive: true, workingDir: older.directory },
    });
    const chatsDir = older.config.projectChatsDir;
    let session: SessionControl | undefined;
    let opened: Awaited<ReturnType<typeof openClientOwner>> | undefined;
    try {
      const olderSeed = await seedSession(older, 'older provider-init turn');
      const latestSeed = await seedSession(latest, 'latest provider-init turn');
      opened = await openClientOwner(
        credentials().authority,
        {
          provider: 'fake',
          model: 'fake-model',
          workingDir: older.directory,
          interactive: true,
          harness: { includeProcessCwd: false },
        },
        { provider: 'fake', model: 'fake-model' },
      );
      const control = opened.owner.createSessionControl(
        'facade',
        () => 'startup-restore-runtime',
        (operation) => operation(),
        () => {},
        () => {},
        () => 'fake',
        () => 'fake-model',
      );
      session = control;
      const reports: Array<{ sessionId: string; reason: string }> = [];
      const fault = spyOn(
        opened.client,
        'restoreHistory',
      ).mockRejectedValueOnce(new Error('restore failed on purpose'));
      try {
        await expect(
          control.resume('latest', {
            startup: true,
            onStartupRestoreFailure: (sessionId, reason) =>
              reports.push({ sessionId, reason }),
          }),
        ).rejects.toThrow('restore failed on purpose');
      } finally {
        fault.mockRestore();
      }

      expect(reports).toHaveLength(1);
      expect(reports[0].reason).toBe('restore failed on purpose');
      expect(basename(latestSeed)).toContain(reports[0].sessionId.slice(0, 8));
      expect(basename(olderSeed)).not.toContain(
        reports[0].sessionId.slice(0, 8),
      );
      expect(JSON.stringify(await control.getHistory())).not.toContain(
        'latest provider-init turn',
      );
      expect(await chatsFiles(chatsDir, '.lock')).toHaveLength(0);

      await opened.client.restoreHistory([human('fresh provider-init turn')]);
      await control.setRecording({ enabled: true });
      const fresh = control.getRecording().path;
      if (!fresh) throw new Error('Fresh recording path missing');
      expect(fresh).not.toBe(latestSeed);
      expect(fresh).not.toBe(olderSeed);
      expect(await chatsFiles(chatsDir, '.jsonl')).toHaveLength(3);
      expect(await chatsFiles(chatsDir, '.lock')).toHaveLength(1);
      expect(await readFile(latestSeed, 'utf8')).toContain(
        'latest provider-init turn',
      );

      await control.dispose();
      expect(await chatsFiles(chatsDir, '.lock')).toHaveLength(0);
    } finally {
      await runCleanupSteps([
        () => session?.dispose(),
        () => opened?.close(),
        () => latest.close(),
        () => older.close(),
      ]);
    }
  }, 30000);
});
