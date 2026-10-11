/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: one unreadable recording must not make continue-target
 * discovery (and everything built on it) fail for the whole project.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { CheckpointService } from './CheckpointService.js';
import { matchUnreadableRecordings } from './unreadableRecordings.js';
import { resumeSessionNotFoundMessage } from './resumeNotFoundMessages.js';
import {
  writeCorruptHeaderSession,
  writeLegacyUnknownProviderSession,
  writeRawRecordingFile,
  writeSessionWithHeaderPayload,
} from './__tests__/recording-file-fixtures.js';

const PROJECT_HASH = 'unreadable-discovery-project';

async function createHealthySession(
  chatsDir: string,
  sessionId: string,
): Promise<string> {
  const recording = new SessionRecordingService({
    sessionId,
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/test/workspace'],
    provider: 'anthropic',
    model: 'claude-4',
  });
  recording.recordContent({
    speaker: 'human',
    blocks: [{ type: 'text', text: `hello from ${sessionId}` }],
  });
  await recording.flush();
  const filePath = recording.getFilePath()!;
  await recording.dispose();
  return filePath;
}

function sessionIdsOf(
  targets: Awaited<ReturnType<typeof SessionDiscovery.listContinueTargets>>,
): string[] {
  return targets.flatMap((target) =>
    target.kind === 'session' ? [target.session.sessionId] : [],
  );
}

describe('SessionDiscovery with an unreadable recording (issue #3732)', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-3732-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns the healthy target and does not throw when another recording is unreadable', async () => {
    await createHealthySession(chatsDir, 'healthy-session-0001');
    await writeCorruptHeaderSession(chatsDir, {
      sessionId: 'corrupt-session-0001',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });

    const targets = await SessionDiscovery.listContinueTargets(
      chatsDir,
      PROJECT_HASH,
    );

    expect(sessionIdsOf(targets)).toStrictEqual(['healthy-session-0001']);
  });

  it('reports the unreadable recording with its file and reason in the detailed result', async () => {
    await createHealthySession(chatsDir, 'healthy-session-0002');
    const corrupt = await writeCorruptHeaderSession(chatsDir, {
      sessionId: 'corrupt-session-0002',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });

    const detailed = await SessionDiscovery.listContinueTargetsDetailed(
      chatsDir,
      PROJECT_HASH,
    );

    expect({
      targets: sessionIdsOf(detailed.targets),
      skippedCount: detailed.skippedCount,
      recordingErrors: detailed.recordingErrors,
    }).toStrictEqual({
      targets: ['healthy-session-0002'],
      skippedCount: 1,
      recordingErrors: [
        `${corrupt.filePath}: Invalid session_start: missing or malformed required fields`,
      ],
    });
  });

  it('lists a legacy unknown-provider recording as a readable target', async () => {
    await writeLegacyUnknownProviderSession(chatsDir, {
      sessionId: 'legacy-session-0001',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });

    const detailed = await SessionDiscovery.listContinueTargetsDetailed(
      chatsDir,
      PROJECT_HASH,
    );

    expect({
      targets: sessionIdsOf(detailed.targets),
      recordingErrors: detailed.recordingErrors,
    }).toStrictEqual({
      targets: ['legacy-session-0001'],
      recordingErrors: [],
    });
  });

  it('still propagates an I/O failure on the chats directory itself', async () => {
    const notADirectory = path.join(tempDir, 'chats-is-a-file');
    await fs.writeFile(notADirectory, 'not a directory');

    await expect(
      SessionDiscovery.listContinueTargets(notADirectory, PROJECT_HASH),
    ).rejects.toThrow(/ENOTDIR/);
  });

  it('lets session name validation succeed and still detect conflicts with healthy sessions', async () => {
    await createHealthySession(chatsDir, 'healthy-session-0003');
    await writeCorruptHeaderSession(chatsDir, {
      sessionId: 'corrupt-session-0003',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });

    const accepted = await SessionDiscovery.validateAvailableName(
      'fresh-name',
      chatsDir,
      PROJECT_HASH,
    );
    const conflict = SessionDiscovery.validateAvailableName(
      'healthy-session-0003',
      chatsDir,
      PROJECT_HASH,
    );

    expect(accepted).toBe('fresh-name');
    await expect(conflict).rejects.toThrow(/already exists/);
  });

  it('lets CheckpointService name the live session while an unreadable recording sits beside it', async () => {
    await writeCorruptHeaderSession(chatsDir, {
      sessionId: 'corrupt-session-0004',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });
    const recording = await SessionRecordingService.createLocked({
      sessionId: 'live-session-0004',
      projectHash: PROJECT_HASH,
      chatsDir,
      workspaceDirs: ['/test/workspace'],
      provider: 'anthropic',
      model: 'claude-4',
    });
    try {
      recording.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'name me' }],
      });
      await recording.flush();

      await new CheckpointService().setSessionName(
        recording,
        PROJECT_HASH,
        'my-live-session',
      );

      const targets = await SessionDiscovery.listContinueTargets(
        chatsDir,
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

  describe('headers that fail the session_start contract', () => {
    const SAME_TIME = new Date('2026-10-05T00:00:00.000Z');

    async function pinModifiedTime(filePath: string): Promise<void> {
      await fs.utimes(filePath, SAME_TIME, SAME_TIME);
    }

    function validHeaderPayload(
      overrides: Readonly<Record<string, unknown>>,
    ): Record<string, unknown> {
      return {
        sessionId: 'placeholder',
        projectHash: PROJECT_HASH,
        workspaceDirs: ['/x'],
        provider: 'anthropic',
        model: 'claude-4',
        startTime: '2026-10-08T21:18:08.000Z',
        ...overrides,
      };
    }

    it.each([
      ['a numeric sessionId', { sessionId: 42 }],
      ['a missing sessionId', { sessionId: undefined }],
      ['an empty sessionId', { sessionId: '' }],
    ])(
      'reports %s as unreadable instead of crashing when modification times are equal',
      async (_label, overrides) => {
        const healthyPath = await createHealthySession(
          chatsDir,
          'healthy-session-0101',
        );
        const brokenPath = await writeSessionWithHeaderPayload(
          chatsDir,
          'session-2026-10-08T21-18-08-brokenid0001.jsonl',
          validHeaderPayload(overrides),
        );
        await pinModifiedTime(healthyPath);
        await pinModifiedTime(brokenPath);

        const detailed = await SessionDiscovery.listContinueTargetsDetailed(
          chatsDir,
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
              reason:
                'Invalid session_start: missing or malformed required fields',
            },
          ],
          skippedCount: 1,
        });
      },
    );

    it('keeps the id of an unreadable recording only when it is a valid string', async () => {
      const brokenPath = await writeSessionWithHeaderPayload(
        chatsDir,
        'session-2026-10-08T21-18-08-modelnumber1.jsonl',
        validHeaderPayload({ sessionId: 'string-id-0001', model: 42 }),
      );

      const detailed = await SessionDiscovery.listSessionsDetailed(
        chatsDir,
        PROJECT_HASH,
      );

      expect(detailed.unreadableRecordings).toStrictEqual([
        {
          filePath: brokenPath,
          sessionId: 'string-id-0001',
          reason: 'Invalid session_start: missing or malformed required fields',
        },
      ]);
    });

    it('matches an explicit file reference to an unreadable recording that has no valid id', async () => {
      const healthyPath = await createHealthySession(
        chatsDir,
        'healthy-session-0102',
      );
      const brokenPath = await writeSessionWithHeaderPayload(
        chatsDir,
        'session-2026-10-08T21-18-08-brokenid0002.jsonl',
        validHeaderPayload({ sessionId: 42 }),
      );
      await pinModifiedTime(healthyPath);
      await pinModifiedTime(brokenPath);
      const detailed = await SessionDiscovery.listContinueTargetsDetailed(
        chatsDir,
        PROJECT_HASH,
      );
      const byName = 'session-2026-10-08T21-18-08-brokenid0002.jsonl';
      const unresolved = (ref: string): string => {
        const resolution = SessionDiscovery.resolveContinueRef(
          ref,
          detailed.targets,
        );
        if ('target' in resolution) throw new Error(`${ref} resolved`);
        return resolution.error;
      };

      const matches = (ref: string) =>
        matchUnreadableRecordings(
          ref,
          unresolved(ref),
          detailed.unreadableRecordings,
        ).map((recording) => recording.filePath);

      expect({
        byFileName: matches(byName),
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

    it('reports malformed first lines with their file and reason', async () => {
      await createHealthySession(chatsDir, 'healthy-session-0103');
      const badJson = await writeRawRecordingFile(
        chatsDir,
        'session-2026-10-08T21-18-08-badjson00001.jsonl',
        '{"type":"session_start", oops\n',
      );
      const empty = await writeRawRecordingFile(
        chatsDir,
        'session-2026-10-08T21-18-08-emptyfile001.jsonl',
        '',
      );
      const notStart = await writeRawRecordingFile(
        chatsDir,
        'session-2026-10-08T21-18-08-notstart0001.jsonl',
        `${JSON.stringify({ v: 1, seq: 1, ts: 'x', type: 'content', payload: {} })}\n`,
      );

      const detailed = await SessionDiscovery.listContinueTargetsDetailed(
        chatsDir,
        PROJECT_HASH,
      );

      expect({
        targets: sessionIdsOf(detailed.targets),
        skippedCount: detailed.skippedCount,
        unreadable: detailed.unreadableRecordings
          .map((recording) => ({
            filePath: recording.filePath,
            reason: recording.reason,
          }))
          .sort((a, b) => a.filePath.localeCompare(b.filePath)),
      }).toStrictEqual({
        targets: ['healthy-session-0103'],
        skippedCount: 3,
        unreadable: [
          {
            filePath: badJson,
            reason:
              'Missing or corrupt session_start event: first line is not valid JSON',
          },
          {
            filePath: empty,
            reason: 'Empty file or unreadable first line',
          },
          {
            filePath: notStart,
            reason:
              'Missing or corrupt session_start event: first line is not a session_start event',
          },
        ],
      });
    });
  });
});
