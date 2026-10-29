/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import { JournalSession } from '../services/history/journalSession.js';
import {
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';
import { JournalCheckpointService } from './journalCheckpointService.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { resumeSessionNotFoundMessage } from './resumeNotFoundMessages.js';
import { sessionFactEdit } from './sessionEdits.js';
import { SESSION_KEYS } from './sessionMetaKeys.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { matchUnreadableRecordings } from './unreadableRecordings.js';

const PROJECT_HASH = 'unreadable-discovery-project';

function sessionIdsOf(
  targets: Awaited<ReturnType<typeof SessionDiscovery.listContinueTargets>>,
): string[] {
  return targets.flatMap((target) =>
    target.kind === 'session' ? [target.session.sessionId] : [],
  );
}

describe('SessionDiscovery isolates unreadable recordings', () => {
  const directory = useTempDir('discovery-3732-');

  async function healthy(
    sessionId: string,
    provider = 'anthropic',
  ): Promise<string> {
    return (
      await recordJournal(directory(), sessionId, {
        projectHash: PROJECT_HASH,
        provider,
        rows: [userRow(`hello from ${sessionId}`)],
      })
    ).filePath;
  }

  async function retired(sessionId: string): Promise<string> {
    const file = join(directory(), `session-${sessionId}.jsonl`);
    await writeFile(file, '{"type":"session_start","payload":{}}\n');
    return file;
  }

  it('returns the healthy target when another recording is unreadable', async () => {
    await healthy('healthy-session-0001');
    await retired('corrupt-session-0001');
    expect(
      sessionIdsOf(
        await SessionDiscovery.listContinueTargets(directory(), PROJECT_HASH),
      ),
    ).toStrictEqual(['healthy-session-0001']);
  });

  it('reports the unreadable recording file and reason in the detailed result', async () => {
    await healthy('healthy-session-0002');
    const file = await retired('corrupt-session-0002');
    const detailed = await SessionDiscovery.listContinueTargetsDetailed(
      directory(),
      PROJECT_HASH,
    );
    expect({
      targets: sessionIdsOf(detailed.targets),
      skippedCount: detailed.skippedCount,
      recordingErrors: detailed.recordingErrors,
    }).toStrictEqual({
      targets: ['healthy-session-0002'],
      skippedCount: 1,
      recordingErrors: [`${file}: ${retiredJournalMessage(file)}`],
    });
  });

  it('lists a journal with an unknown provider as a readable target', async () => {
    await healthy('unknown-provider-0001', 'unknown');
    const detailed = await SessionDiscovery.listContinueTargetsDetailed(
      directory(),
      PROJECT_HASH,
    );
    expect({
      targets: sessionIdsOf(detailed.targets),
      recordingErrors: detailed.recordingErrors,
    }).toStrictEqual({
      targets: ['unknown-provider-0001'],
      recordingErrors: [],
    });
  });

  it('propagates an I/O failure on the chats directory itself', async () => {
    const file = join(directory(), 'not-a-directory');
    await writeFile(file, 'not a directory');
    await expect(
      SessionDiscovery.listContinueTargets(file, PROJECT_HASH),
    ).rejects.toThrow(/ENOTDIR/);
  });

  it('validates session names and detects healthy conflicts beside an unreadable recording', async () => {
    await healthy('healthy-session-0003');
    await retired('corrupt-session-0003');
    expect(
      await SessionDiscovery.validateAvailableName(
        'fresh-name',
        directory(),
        PROJECT_HASH,
      ),
    ).toBe('fresh-name');
    await expect(
      SessionDiscovery.validateAvailableName(
        'healthy-session-0003',
        directory(),
        PROJECT_HASH,
      ),
    ).rejects.toThrow(/already exists/);
  });

  it('names the live session while an unreadable recording sits beside it', async () => {
    await retired('corrupt-session-0004');
    const recording = await JournalRecordingService.createLocked({
      sessionId: 'live-session-0004',
      projectHash: PROJECT_HASH,
      chatsDir: directory(),
      workspaceDirs: ['/test/workspace'],
      provider: 'anthropic',
      model: 'claude-4',
    });
    try {
      await (await recording.session()).append([userRow('name me')]);
      await new JournalCheckpointService().setSessionName(
        recording,
        PROJECT_HASH,
        'my-live-session',
      );
      const targets = await SessionDiscovery.listContinueTargets(
        directory(),
        PROJECT_HASH,
      );
      expect(
        targets.flatMap((target) =>
          target.kind === 'session' ? [target.session.name] : [],
        ),
      ).toStrictEqual(['my-live-session']);
    } finally {
      await recording.dispose();
    }
  });

  it.each([
    ['a numeric session ID', 42],
    ['an empty session ID', ''],
  ])(
    'reports %s instead of crashing when modification times are equal',
    async (_label, id) => {
      const healthyPath = await healthy('healthy-session-0101');
      const brokenPath = await healthy('broken-session');
      const session = await JournalSession.open(brokenPath);
      try {
        await session.store.commit([sessionFactEdit(SESSION_KEYS.id, id)]);
      } finally {
        await session.close();
      }
      const sameTime = new Date('2026-10-05T00:00:00.000Z');
      await utimes(healthyPath, sameTime, sameTime);
      await utimes(brokenPath, sameTime, sameTime);
      const detailed = await SessionDiscovery.listContinueTargetsDetailed(
        directory(),
        PROJECT_HASH,
      );
      expect({
        targets: sessionIdsOf(detailed.targets),
        unreadable: detailed.unreadableRecordings,
        skippedCount: detailed.skippedCount,
      }).toStrictEqual({
        targets: ['healthy-session-0101'],
        unreadable: [
          {
            filePath: brokenPath,
            reason: 'Session fact session:id is not in the expected form',
          },
        ],
        skippedCount: 1,
      });
    },
  );

  it('matches explicit file references to an unreadable recording with no valid ID', async () => {
    await healthy('healthy-session-0102');
    const brokenPath = await retired('brokenid0002');
    const detailed = await SessionDiscovery.listContinueTargetsDetailed(
      directory(),
      PROJECT_HASH,
    );
    function matches(ref: string): string[] {
      const resolution = SessionDiscovery.resolveContinueRef(
        ref,
        detailed.targets,
      );
      if ('target' in resolution) throw new Error(`${ref} resolved`);
      return matchUnreadableRecordings(
        ref,
        resolution.error,
        detailed.unreadableRecordings,
      ).map((recording) => recording.filePath);
    }
    expect({
      byFileName: matches('session-brokenid0002.jsonl'),
      byPath: matches(brokenPath),
      byUnrelatedPrefix: matches('no-such-session'),
      byIdPrefixOfHealthy: matchUnreadableRecordings(
        'healthy-session',
        resumeSessionNotFoundMessage('healthy-session'),
        detailed.unreadableRecordings,
      ),
    }).toStrictEqual({
      byFileName: [brokenPath],
      byPath: [brokenPath],
      byUnrelatedPrefix: [],
      byIdPrefixOfHealthy: [],
    });
  });

  it('reports retired text, empty and non-session recordings with the refusal reason', async () => {
    await healthy('healthy-session-0103');
    const files = ['badjson00001', 'emptyfile001', 'notstart0001'].map((id) =>
      join(directory(), `session-${id}.jsonl`),
    );
    await writeFile(files[0], '{"type":"session_start", oops\n');
    await writeFile(files[1], '');
    await writeFile(files[2], '{"type":"content","payload":{}}\n');
    const detailed = await SessionDiscovery.listContinueTargetsDetailed(
      directory(),
      PROJECT_HASH,
    );
    expect({
      targets: sessionIdsOf(detailed.targets),
      skippedCount: detailed.skippedCount,
      unreadable: detailed.unreadableRecordings,
    }).toStrictEqual({
      targets: ['healthy-session-0103'],
      skippedCount: 3,
      unreadable: files.map((filePath) => ({
        filePath,
        reason: retiredJournalMessage(filePath),
      })),
    });
  });
});
