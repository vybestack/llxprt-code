/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Behavioral integration tests for recording-native checkpoint/session-name
 * metadata events, inclusive maxSequence replay, and metadata folding.
 *
 * Tests use real SessionRecordingService instances writing real JSONL files
 * in real temp directories. No mock theater.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import {
  replaySession,
  replaySessionThroughSequence,
  foldCheckpointMetadata,
  type CheckpointMetadataView,
} from './ReplayEngine.js';
import {
  type SessionRecordingServiceConfig,
  type SessionRecordLine,
  type CheckpointCreatedPayload,
  type CheckpointDeletedPayload,
  type SessionForkedPayload,
  type SessionNamedPayload,
  type ContinueTarget,
} from './types.js';
import { type IContent } from '../services/history/IContent.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager } from './SessionLockManager.js';

function requireCheckpointTarget(
  target: ContinueTarget | undefined,
): asserts target is Extract<ContinueTarget, { kind: 'checkpoint' }> {
  if (target?.kind !== 'checkpoint') {
    throw new Error('Expected a checkpoint continue target');
  }
}
const PROJECT_HASH = 'rec-meta-project-hash';

function requireReplaySuccess(
  result: Awaited<ReturnType<typeof replaySession>>,
): asserts result is Extract<
  Awaited<ReturnType<typeof replaySession>>,
  { ok: true }
> {
  if (!result.ok) throw new Error(`Expected replay success: ${result.error}`);
}

function makeConfig(
  chatsDir: string,
  overrides: Partial<SessionRecordingServiceConfig> = {},
): SessionRecordingServiceConfig {
  return {
    sessionId: overrides.sessionId ?? crypto.randomUUID(),
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    chatsDir,
    workspaceDirs: overrides.workspaceDirs ?? ['/test/workspace'],
    provider: overrides.provider ?? 'anthropic',
    model: overrides.model ?? 'claude-4',
  };
}

function makeContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

async function readJsonlFile(filePath: string): Promise<SessionRecordLine[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SessionRecordLine);
}

describe('recording metadata events and replay @plan:2026-07-28-issue-2625', () => {
  let tempDir: string;
  let chatsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rec-meta-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('checkpoint_created event', () => {
    it('writes a checkpoint_created event with a stable checkpointId and name', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      svc.recordContent(makeContent('A', 'human'));
      svc.recordContent(makeContent('B', 'ai'));

      const info = await svc.createCheckpoint('foo');

      expect(info.name).toBe('foo');
      expect(info.checkpointId).toBeTruthy();
      await svc.flush();
      await svc.dispose();

      const filePath = svc.getFilePath()!;
      const events = await readJsonlFile(filePath);
      const created = events.filter((e) => e.type === 'checkpoint_created');
      expect(created).toHaveLength(1);
      const payload = created[0].payload as CheckpointCreatedPayload;
      expect(payload.name).toBe('foo');
      expect(payload.checkpointId).toBe(info.checkpointId);
      expect(created[0].seq).toBe(info.sequence);
    });

    it('preserves the checkpoint event timestamp in replay metadata', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      svc.recordContent(makeContent('A', 'human'));
      await svc.createCheckpoint('timestamped');
      await svc.dispose();

      const replay = await replaySession(svc.getFilePath()!, PROJECT_HASH);
      requireReplaySuccess(replay);
      expect(replay.checkpoints?.[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('rejects checkpoint creation on an empty/unmaterialized conversation', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      await expect(svc.createCheckpoint('empty')).rejects.toThrow(
        'conversation has no content yet',
      );
      expect(svc.getFilePath()).toBeNull();
      await svc.dispose();
    });

    it('materializes an unstarted recording when naming the session', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));

      await svc.setSessionName('before-first-turn');

      expect(svc.getFilePath()).not.toBeNull();
      const replay = await replaySession(svc.getFilePath()!, PROJECT_HASH);
      requireReplaySuccess(replay);
      expect(replay.sessionName).toBe('before-first-turn');
      await svc.dispose();
    });

    it('rejects rename and delete on an unmaterialized recording', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));

      await expect(svc.renameCheckpoint('missing', 'renamed')).rejects.toThrow(
        'recording is not materialized',
      );
      await expect(svc.deleteCheckpoint('missing')).rejects.toThrow(
        'recording is not materialized',
      );
      await svc.dispose();
    });

    it('rejects checkpoint creation on an inactive recorder', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      svc.recordContent(makeContent('A', 'human'));
      await svc.flush();
      await svc.dispose();
      await expect(svc.createCheckpoint('after-dispose')).rejects.toThrow(
        'recording is not active',
      );
    });
  });

  describe('checkpoint_deleted event', () => {
    it('appends a checkpoint_deleted event by checkpointId', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      svc.recordContent(makeContent('A', 'human'));
      const created = await svc.createCheckpoint('foo');
      await svc.deleteCheckpoint(created.checkpointId);
      await svc.flush();
      await svc.dispose();

      const events = await readJsonlFile(svc.getFilePath()!);
      const deleted = events.filter((e) => e.type === 'checkpoint_deleted');
      expect(deleted).toHaveLength(1);
      const payload = deleted[0].payload as CheckpointDeletedPayload;
      expect(payload.checkpointId).toBe(created.checkpointId);
    });
  });

  describe('session_named event', () => {
    it('appends a session_named event with the name and null clears it', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      svc.recordContent(makeContent('A', 'human'));
      await svc.setSessionName('experiment-a');
      await svc.setSessionName(null);
      await svc.flush();
      await svc.dispose();

      const events = await readJsonlFile(svc.getFilePath()!);
      const named = events.filter((e) => e.type === 'session_named');
      expect(named).toHaveLength(2);
      const first = named[0].payload as SessionNamedPayload;
      expect(first.name).toBe('experiment-a');
      const second = named[1].payload as SessionNamedPayload;
      expect(second.name).toBeNull();
    });
  });

  describe('inclusive maxSequence replay', () => {
    it('replays only events up to and including the checkpoint sequence', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      svc.recordContent(makeContent('A', 'human')); // seq 2
      svc.recordContent(makeContent('B', 'ai')); // seq 3
      svc.recordContent(makeContent('C', 'human')); // seq 4
      const checkpointPromise = svc.createCheckpoint('atC'); // seq 5
      svc.recordContent(makeContent('D', 'ai')); // seq 6
      svc.recordContent(makeContent('E', 'human')); // seq 7
      const checkpoint = await checkpointPromise;
      await svc.flush();
      await svc.dispose();

      const result = await replaySessionThroughSequence(
        svc.getFilePath()!,
        PROJECT_HASH,
        checkpoint.sequence,
      );
      requireReplaySuccess(result);
      expect(checkpoint.sequence).toBe(5);
      expect(result.history).toHaveLength(3);
      const texts = result.history.map((h) =>
        h.blocks[0].type === 'text' ? h.blocks[0].text : '',
      );
      expect(texts).toStrictEqual(['A', 'B', 'C']);
    });

    it('skips a malformed line while replaying through a later checkpoint', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      svc.recordContent(makeContent('A', 'human'));
      const checkpoint = await svc.createCheckpoint('atA');
      await svc.dispose();
      const filePath = svc.getFilePath()!;
      const original = await fs.readFile(filePath, 'utf-8');
      const lines = original.trimEnd().split('\n');
      await fs.writeFile(
        filePath,
        `${lines[0]}\nnot-json\n${lines.slice(1).join('\n')}\n`,
        'utf-8',
      );

      const result = await replaySessionThroughSequence(
        filePath,
        PROJECT_HASH,
        checkpoint.sequence,
      );

      requireReplaySuccess(result);
      expect(result.history).toStrictEqual([makeContent('A', 'human')]);
      expect(result.warnings).toContain('Line 2: failed to parse JSON');
    });

    it('metadata events never appear in replayed history', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      svc.recordContent(makeContent('A', 'human'));
      await svc.createCheckpoint('foo');
      await svc.setSessionName('named');
      await svc.flush();
      await svc.dispose();

      const result = await replaySession(svc.getFilePath()!, PROJECT_HASH);
      requireReplaySuccess(result);
      {
        expect(result.history).toHaveLength(1);
        expect(result.history[0].blocks[0]).toStrictEqual({
          type: 'text',
          text: 'A',
        });
      }
    });
  });

  describe('checkpoint metadata folding', () => {
    it('folds create/delete/rename by stable checkpointId', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      svc.recordContent(makeContent('A', 'human'));
      const created = await svc.createCheckpoint('foo');
      await svc.renameCheckpoint(created.checkpointId, 'bar');
      await svc.flush();
      await svc.dispose();

      const events = await readJsonlFile(svc.getFilePath()!);
      const view = foldCheckpointMetadata(events);
      expect(view).toHaveLength(1);
      expect(view[0].checkpointId).toBe(created.checkpointId);
      expect(view[0].name).toBe('bar');
      expect(view[0].sequence).toBe(created.sequence);
      expect(view[0].deleted).toBe(false);
    });

    it('marks deleted checkpoints and excludes them from live view', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      svc.recordContent(makeContent('A', 'human'));
      const created = await svc.createCheckpoint('foo');
      await svc.deleteCheckpoint(created.checkpointId);
      await svc.flush();
      await svc.dispose();

      const events = await readJsonlFile(svc.getFilePath()!);
      const live = foldCheckpointMetadata(events).filter((c) => !c.deleted);
      expect(live).toHaveLength(0);
    });
    it('does not revive a tombstoned checkpoint when a duplicate create event is encountered', () => {
      const events: SessionRecordLine[] = [
        {
          v: 1,
          seq: 1,
          ts: '2026-01-01T00:00:00.000Z',
          type: 'checkpoint_created',
          payload: { checkpointId: 'stable-id', name: 'original' },
        },
        {
          v: 1,
          seq: 2,
          ts: '2026-01-01T00:00:01.000Z',
          type: 'checkpoint_deleted',
          payload: { checkpointId: 'stable-id' },
        },
        {
          v: 1,
          seq: 3,
          ts: '2026-01-01T00:00:02.000Z',
          type: 'checkpoint_created',
          payload: { checkpointId: 'stable-id', name: 'duplicate' },
        },
      ];

      expect(foldCheckpointMetadata(events)).toStrictEqual([
        expect.objectContaining({
          checkpointId: 'stable-id',
          name: 'original',
          deleted: true,
          sequence: 1,
        }),
      ]);
    });
  });

  describe('session_forked event', () => {
    it('records ancestry metadata when a fork is seeded', async () => {
      const parentSessionId = crypto.randomUUID();
      const parent = new SessionRecordingService(
        makeConfig(chatsDir, { sessionId: parentSessionId }),
      );
      parent.recordContent(makeContent('A', 'human'));
      parent.recordContent(makeContent('B', 'ai'));
      parent.recordContent(makeContent('C', 'human'));
      const checkpoint = await parent.createCheckpoint('atC');
      await parent.flush();
      await parent.dispose();

      const childSessionId = crypto.randomUUID();
      const child = new SessionRecordingService(
        makeConfig(chatsDir, { sessionId: childSessionId }),
      );
      child.recordContent(makeContent('A', 'human'));
      child.recordContent(makeContent('B', 'ai'));
      child.recordContent(makeContent('C', 'human'));
      child.recordSessionFork({
        parentSessionId,
        parentSequence: checkpoint.sequence,
        checkpointId: checkpoint.checkpointId,
        checkpointName: checkpoint.name,
      });
      await child.flush();
      await child.dispose();

      const events = await readJsonlFile(child.getFilePath()!);
      const forked = events.filter((e) => e.type === 'session_forked');
      expect(forked).toHaveLength(1);
      const payload = forked[0].payload as SessionForkedPayload;
      expect(payload.parentSessionId).toBe(parentSessionId);
      expect(payload.checkpointName).toBe('atC');

      const replay = await replaySession(child.getFilePath()!, PROJECT_HASH);
      requireReplaySuccess(replay);
      expect(replay.ancestry).toStrictEqual(payload);
    });
  });

  describe('metadata exposure from replay', () => {
    it('exposes folded checkpoints and session name from ReplayResult', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      svc.recordContent(makeContent('A', 'human'));
      const cp = await svc.createCheckpoint('foo');
      await svc.setSessionName('my-session');
      await svc.flush();
      await svc.dispose();

      const result = await replaySession(svc.getFilePath()!, PROJECT_HASH);
      requireReplaySuccess(result);
      {
        expect(result.checkpoints).toBeDefined();
        expect(result.checkpoints).toHaveLength(1);
        expect(result.checkpoints![0].checkpointId).toBe(cp.checkpointId);
        expect(result.checkpoints![0].name).toBe('foo');
        expect(result.sessionName).toBe('my-session');
      }
    });
  });

  describe('CheckpointMetadataView type', () => {
    it('is a readonly record with the expected shape', () => {
      const view: CheckpointMetadataView = {
        checkpointId: 'cp-1',
        name: 'foo',
        sequence: 5,
        deleted: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      expect(view.checkpointId).toBe('cp-1');
      expect(view.name).toBe('foo');
      expect(view.sequence).toBe(5);
      expect(view.deleted).toBe(false);
    });
  });

  describe('project-wide discovery and active lock ownership', () => {
    it('lists and resolves named sessions and checkpoints without changing titles', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir));
      svc.recordContent(makeContent('A'));
      await svc.createCheckpoint('branch-point');
      await svc.setSessionName('living-branch');
      await svc.dispose();

      const targets = await SessionDiscovery.listContinueTargets(
        chatsDir,
        PROJECT_HASH,
      );
      expect(targets.map((target) => target.kind)).toStrictEqual([
        'session',
        'checkpoint',
      ]);
      expect(
        SessionDiscovery.resolveContinueRef('branch-point', targets),
      ).toMatchObject({ target: { kind: 'checkpoint' } });
      expect(
        SessionDiscovery.resolveContinueRef('living-branch', targets),
      ).toMatchObject({ target: { kind: 'session' } });
      const sessionTarget = targets.find((target) => target.kind === 'session');
      const checkpointTarget = targets.find(
        (target) => target.kind === 'checkpoint',
      );
      requireCheckpointTarget(checkpointTarget);
      const checkpointId = checkpointTarget.checkpointId;
      expect(
        SessionDiscovery.resolveContinueRef(checkpointId, targets),
      ).toMatchObject({ target: { kind: 'checkpoint' } });
      expect(sessionTarget?.session.title).toBeUndefined();
      expect(checkpointTarget).not.toHaveProperty('session');
    });

    it('rejects reserved and project-duplicate names', async () => {
      const first = new SessionRecordingService(makeConfig(chatsDir));
      first.recordContent(makeContent('A'));
      await first.createCheckpoint('taken');
      await first.dispose();

      await expect(
        SessionDiscovery.validateAvailableName('taken', chatsDir, PROJECT_HASH),
      ).rejects.toThrow(/already exists/);
      await expect(
        SessionDiscovery.validateAvailableName(
          'latest',
          chatsDir,
          PROJECT_HASH,
        ),
      ).rejects.toThrow(/reserved/);
      await expect(
        SessionDiscovery.validateAvailableName('2', chatsDir, PROJECT_HASH),
      ).rejects.toThrow(/reserved/);
    });

    it('creates a fresh active recorder with a full-session-ID lock released by disposal', async () => {
      const sessionId = crypto.randomUUID();
      const svc = await SessionRecordingService.createLocked(
        makeConfig(chatsDir, { sessionId }),
      );
      svc.recordContent(makeContent('A'));
      await svc.flush();

      expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(true);
      await expect(
        SessionLockManager.acquire(chatsDir, sessionId),
      ).rejects.toThrow(/in use/);

      await svc.dispose();
      expect(await SessionLockManager.isLocked(chatsDir, sessionId)).toBe(
        false,
      );
    });
  });
});
