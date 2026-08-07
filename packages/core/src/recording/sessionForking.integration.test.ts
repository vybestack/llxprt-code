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
 * Behavioral integration tests for self-contained session forks and
 * checkpoint-based branching. Uses real recording files in temp dirs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import {
  SessionTransitionService,
  type ContinueTarget,
} from './SessionTransitionService.js';
import { CheckpointService } from './CheckpointService.js';
import { SessionLockManager } from './SessionLockManager.js';
import { replaySession } from './ReplayEngine.js';

function requireReplaySuccess(
  result: Awaited<ReturnType<typeof replaySession>>,
): asserts result is Extract<
  Awaited<ReturnType<typeof replaySession>>,
  { ok: true }
> {
  if (!result.ok) throw new Error(`Expected replay success: ${result.error}`);
}

function requireForkSuccess(
  result: Awaited<ReturnType<SessionTransitionService['forkFromCheckpoint']>>,
): asserts result is Extract<
  Awaited<ReturnType<SessionTransitionService['forkFromCheckpoint']>>,
  { ok: true }
> {
  if (!result.ok) throw new Error(`Expected fork success: ${result.error}`);
}
import { type SessionRecordingServiceConfig } from './types.js';
import { type IContent } from '../services/history/IContent.js';

const PROJECT_HASH = 'fork-project-hash';

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

function tempDirHelper(): {
  getDir: () => string;
  setup: () => Promise<void>;
  teardown: () => Promise<void>;
} {
  let dir = '';
  return {
    getDir: () => dir,
    setup: async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fork-'));
      await fs.mkdir(path.join(dir, 'chats'), { recursive: true });
    },
    teardown: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

describe('session forking and branching @plan:2026-07-28-issue-2625', () => {
  const tmp = tempDirHelper();
  beforeEach(tmp.setup);
  afterEach(tmp.teardown);
  const chatsDir = () => path.join(tmp.getDir(), 'chats');

  describe('A1: fork from checkpoint produces child with history up to checkpoint', () => {
    it('child initially replays A-C before F/G are added', async () => {
      const parent = new SessionRecordingService(makeConfig(chatsDir()));
      parent.recordContent(makeContent('A', 'human')); // seq 2
      parent.recordContent(makeContent('B', 'ai')); // seq 3
      parent.recordContent(makeContent('C', 'human')); // seq 4
      const cp = await parent.createCheckpoint('atC'); // seq 5
      parent.recordContent(makeContent('D', 'ai')); // seq 6
      parent.recordContent(makeContent('E', 'human')); // seq 7
      await parent.flush();
      await parent.dispose();

      const transition = new SessionTransitionService();
      const target: ContinueTarget = {
        kind: 'checkpoint',
        source: {
          sessionId: parent.getSessionId(),
          filePath: parent.getFilePath()!,
          projectHash: PROJECT_HASH,
          startTime: new Date().toISOString(),
          lastModified: new Date(),
          fileSize: 0,
          provider: 'anthropic',
          model: 'claude-4',
        },
        checkpointId: cp.checkpointId,
        checkpointName: cp.name,
        sequence: cp.sequence,
      };
      const result = await transition.forkFromCheckpoint(
        target,
        chatsDir(),
        PROJECT_HASH,
        'anthropic',
        'claude-4',
        ['/test/workspace'],
      );
      requireForkSuccess(result);
      {
        // Child history should be A, B, C (not D, E)
        expect(result.history).toHaveLength(3);
        const texts = result.history.map((h) =>
          h.blocks[0].type === 'text' ? h.blocks[0].text : '',
        );
        expect(texts).toStrictEqual(['A', 'B', 'C']);

        // Child recording is active and can append F/G
        try {
          result.recording.recordContent(makeContent('F', 'ai'));
          result.recording.recordContent(makeContent('G', 'human'));
          await result.recording.flush();
          await result.recording.dispose();
        } finally {
          await result.lockHandle.release();
        }

        // Replay child from disk: should have A-C + F,G
        const childReplay = await replaySession(
          result.recording.getFilePath()!,
          PROJECT_HASH,
        );
        requireReplaySuccess(childReplay);
        {
          expect(childReplay.history).toHaveLength(5);
        }
      }
    });

    it('uses checkpoint metadata refreshed under the source lock for ancestry', async () => {
      const parent = new SessionRecordingService(makeConfig(chatsDir()));
      parent.recordContent(makeContent('A', 'human'));
      const checkpoint = await parent.createCheckpoint('authoritative-name');
      await parent.dispose();

      const result = await new SessionTransitionService().forkFromCheckpoint(
        {
          kind: 'checkpoint',
          source: {
            sessionId: parent.getSessionId(),
            filePath: parent.getFilePath()!,
            projectHash: PROJECT_HASH,
            startTime: new Date().toISOString(),
            lastModified: new Date(),
            fileSize: 0,
            provider: 'anthropic',
            model: 'claude-4',
          },
          checkpointId: checkpoint.checkpointId,
          checkpointName: 'stale-name',
          sequence: checkpoint.sequence + 99,
        },
        chatsDir(),
        PROJECT_HASH,
        'anthropic',
        'claude-4',
        ['/test/workspace'],
      );
      requireForkSuccess(result);
      await result.recording.dispose();
      const replay = await replaySession(
        result.recording.getFilePath()!,
        PROJECT_HASH,
      );
      requireReplaySuccess(replay);
      expect(replay.ancestry).toMatchObject({
        checkpointName: 'authoritative-name',
        parentSequence: checkpoint.sequence,
      });
      await result.lockHandle.release();
    });
  });

  describe('A2: source and child remain independent', () => {
    it('source replay excludes child F/G; child replay excludes source D/E', async () => {
      const parent = new SessionRecordingService(makeConfig(chatsDir()));
      parent.recordContent(makeContent('A', 'human'));
      parent.recordContent(makeContent('B', 'ai'));
      parent.recordContent(makeContent('C', 'human'));
      const cp = await parent.createCheckpoint('atC');
      parent.recordContent(makeContent('D', 'ai'));
      parent.recordContent(makeContent('E', 'human'));
      await parent.flush();
      await parent.dispose();

      const transition = new SessionTransitionService();
      const result = await transition.forkFromCheckpoint(
        {
          kind: 'checkpoint',
          source: {
            sessionId: parent.getSessionId(),
            filePath: parent.getFilePath()!,
            projectHash: PROJECT_HASH,
            startTime: new Date().toISOString(),
            lastModified: new Date(),
            fileSize: 0,
            provider: 'anthropic',
            model: 'claude-4',
          },
          checkpointId: cp.checkpointId,
          checkpointName: cp.name,
          sequence: cp.sequence,
        },
        chatsDir(),
        PROJECT_HASH,
        'anthropic',
        'claude-4',
        ['/test/workspace'],
      );
      requireForkSuccess(result);

      try {
        result.recording.recordContent(makeContent('F', 'ai'));
        await result.recording.flush();
        await result.recording.dispose();
      } finally {
        await result.lockHandle.release();
      }

      // Source replay: A-E, no F
      const sourceReplay = await replaySession(
        parent.getFilePath()!,
        PROJECT_HASH,
      );
      requireReplaySuccess(sourceReplay);
      {
        expect(sourceReplay.history).toHaveLength(5); // A,B,C,D,E
      }

      // Child replay: A-C,F, no D,E
      const childReplay = await replaySession(
        result.recording.getFilePath()!,
        PROJECT_HASH,
      );
      requireReplaySuccess(childReplay);
      {
        expect(childReplay.history).toHaveLength(4); // A,B,C,F
      }
    });
  });

  describe('A3: repeated checkpoint forks create siblings', () => {
    it('two forks have distinct IDs and identical initial state', async () => {
      const parent = new SessionRecordingService(makeConfig(chatsDir()));
      parent.recordContent(makeContent('A', 'human'));
      parent.recordContent(makeContent('B', 'ai'));
      parent.recordContent(makeContent('C', 'human'));
      const cp = await parent.createCheckpoint('atC');
      await parent.flush();
      await parent.dispose();

      const transition = new SessionTransitionService();

      const fork1 = await transition.forkFromCheckpoint(
        {
          kind: 'checkpoint',
          source: {
            sessionId: parent.getSessionId(),
            filePath: parent.getFilePath()!,
            projectHash: PROJECT_HASH,
            startTime: new Date().toISOString(),
            lastModified: new Date(),
            fileSize: 0,
            provider: 'anthropic',
            model: 'claude-4',
          },
          checkpointId: cp.checkpointId,
          checkpointName: cp.name,
          sequence: cp.sequence,
        },
        chatsDir(),
        PROJECT_HASH,
        'anthropic',
        'claude-4',
        ['/test/workspace'],
      );
      const fork2 = await transition.forkFromCheckpoint(
        {
          kind: 'checkpoint',
          source: {
            sessionId: parent.getSessionId(),
            filePath: parent.getFilePath()!,
            projectHash: PROJECT_HASH,
            startTime: new Date().toISOString(),
            lastModified: new Date(),
            fileSize: 0,
            provider: 'anthropic',
            model: 'claude-4',
          },
          checkpointId: cp.checkpointId,
          checkpointName: cp.name,
          sequence: cp.sequence,
        },
        chatsDir(),
        PROJECT_HASH,
        'anthropic',
        'claude-4',
        ['/test/workspace'],
      );
      requireForkSuccess(fork1);
      requireForkSuccess(fork2);

      // Distinct IDs
      expect(fork1.recording.getSessionId()).not.toBe(
        fork2.recording.getSessionId(),
      );
      expect(fork1.recording.getFilePath()).not.toBe(
        fork2.recording.getFilePath(),
      );

      // Identical initial state
      expect(fork1.history).toStrictEqual(fork2.history);

      try {
        await fork1.recording.dispose();
      } finally {
        await fork1.lockHandle.release();
      }
      try {
        await fork2.recording.dispose();
      } finally {
        await fork2.lockHandle.release();
      }
    });
  });

  describe('A4: children are self-contained', () => {
    it('child resumes after checkpoint deletion and parent deletion', async () => {
      const parent = new SessionRecordingService(makeConfig(chatsDir()));
      parent.recordContent(makeContent('A', 'human'));
      parent.recordContent(makeContent('B', 'ai'));
      parent.recordContent(makeContent('C', 'human'));
      const cp = await parent.createCheckpoint('atC');
      await parent.flush();
      await parent.dispose();

      const transition = new SessionTransitionService();
      const fork = await transition.forkFromCheckpoint(
        {
          kind: 'checkpoint',
          source: {
            sessionId: parent.getSessionId(),
            filePath: parent.getFilePath()!,
            projectHash: PROJECT_HASH,
            startTime: new Date().toISOString(),
            lastModified: new Date(),
            fileSize: 0,
            provider: 'anthropic',
            model: 'claude-4',
          },
          checkpointId: cp.checkpointId,
          checkpointName: cp.name,
          sequence: cp.sequence,
        },
        chatsDir(),
        PROJECT_HASH,
        'anthropic',
        'claude-4',
        ['/test/workspace'],
      );
      requireForkSuccess(fork);

      const childFilePath = fork.recording.getFilePath()!;
      const childSessionId = fork.recording.getSessionId();
      try {
        await fork.recording.dispose();
      } finally {
        await fork.lockHandle.release();
      }

      // Delete checkpoint via CheckpointService on the parent (closed)
      const cpService = new CheckpointService();
      await cpService.deleteCheckpointClosed(
        parent.getFilePath()!,
        PROJECT_HASH,
        chatsDir(),
        parent.getSessionId(),
        cp.checkpointId,
      );

      // Delete parent session file entirely
      await fs.unlink(parent.getFilePath()!);

      // Child still replays from its own file
      const childReplay = await replaySession(childFilePath, PROJECT_HASH);
      requireReplaySuccess(childReplay);
      {
        expect(childReplay.history).toHaveLength(3); // A,B,C
        expect(childReplay.metadata.sessionId).toBe(childSessionId);
      }
    });
  });

  describe('A5: source deletion blocker enumeration', () => {
    it('lists live checkpoint names as deletion blockers', async () => {
      const parent = new SessionRecordingService(makeConfig(chatsDir()));
      parent.recordContent(makeContent('A', 'human'));
      parent.recordContent(makeContent('B', 'ai'));
      await parent.createCheckpoint('foo');
      await parent.flush();
      await parent.dispose();

      const cpService = new CheckpointService();
      const blockers = await cpService.getDeletionBlockers(
        parent.getFilePath()!,
        PROJECT_HASH,
      );
      expect(blockers).toHaveLength(1);
      expect(blockers[0].name).toBe('foo');
    });

    it('returns no blockers after checkpoint tombstones', async () => {
      const parent = new SessionRecordingService(makeConfig(chatsDir()));
      parent.recordContent(makeContent('A', 'human'));
      const cp = await parent.createCheckpoint('foo');
      await parent.flush();
      await parent.dispose();

      const cpService = new CheckpointService();
      await cpService.deleteCheckpointClosed(
        parent.getFilePath()!,
        PROJECT_HASH,
        chatsDir(),
        parent.getSessionId(),
        cp.checkpointId,
      );

      const blockers = await cpService.getDeletionBlockers(
        parent.getFilePath()!,
        PROJECT_HASH,
      );
      expect(blockers).toHaveLength(0);
    });
  });

  describe('source locking and failed-child cleanup', () => {
    it('does not read or fork a closed source while another owner holds its lock', async () => {
      const parent = new SessionRecordingService(makeConfig(chatsDir()));
      parent.recordContent(makeContent('A'));
      const cp = await parent.createCheckpoint('locked-source');
      await parent.dispose();
      const sourceLock = await SessionLockManager.acquire(
        chatsDir(),
        parent.getSessionId(),
      );

      try {
        const result = await new SessionTransitionService().forkFromCheckpoint(
          {
            kind: 'checkpoint',
            source: {
              sessionId: parent.getSessionId(),
              filePath: parent.getFilePath()!,
              projectHash: PROJECT_HASH,
              startTime: new Date().toISOString(),
              lastModified: new Date(),
              fileSize: 0,
              provider: 'anthropic',
              model: 'claude-4',
            },
            checkpointId: cp.checkpointId,
            checkpointName: cp.name,
            sequence: cp.sequence,
          },
          chatsDir(),
          PROJECT_HASH,
          'anthropic',
          'claude-4',
          ['/test/workspace'],
        );

        expect(result).toMatchObject({ ok: false });
      } finally {
        await sourceLock.release();
      }
    });
  });

  describe('A11: forked sessions hold locks', () => {
    it('forked session rejects second lock acquisition', async () => {
      const parent = new SessionRecordingService(makeConfig(chatsDir()));
      parent.recordContent(makeContent('A', 'human'));
      parent.recordContent(makeContent('B', 'ai'));
      const cp = await parent.createCheckpoint('atB');
      await parent.flush();
      await parent.dispose();

      const transition = new SessionTransitionService();
      const fork = await transition.forkFromCheckpoint(
        {
          kind: 'checkpoint',
          source: {
            sessionId: parent.getSessionId(),
            filePath: parent.getFilePath()!,
            projectHash: PROJECT_HASH,
            startTime: new Date().toISOString(),
            lastModified: new Date(),
            fileSize: 0,
            provider: 'anthropic',
            model: 'claude-4',
          },
          checkpointId: cp.checkpointId,
          checkpointName: cp.name,
          sequence: cp.sequence,
        },
        chatsDir(),
        PROJECT_HASH,
        'anthropic',
        'claude-4',
        ['/test/workspace'],
      );
      requireForkSuccess(fork);

      const checkpointService = new CheckpointService();
      await checkpointService.setSessionName(
        fork.recording,
        PROJECT_HASH,
        'forked-child',
      );
      await checkpointService.createCheckpoint(
        fork.recording,
        PROJECT_HASH,
        'child-checkpoint',
      );
      await expect(
        SessionLockManager.acquire(chatsDir(), fork.recording.getSessionId()),
      ).rejects.toThrow('Session is in use by another process');
      expect(fork.recording.ownsLockFor(fork.recording.getSessionId())).toBe(
        true,
      );

      try {
        await fork.recording.dispose();
      } finally {
        await fork.lockHandle.release();
      }

      expect(
        await SessionLockManager.isLocked(
          chatsDir(),
          fork.recording.getSessionId(),
        ),
      ).toBe(false);

      const childReplay = await replaySession(
        fork.recording.getFilePath()!,
        PROJECT_HASH,
      );
      requireReplaySuccess(childReplay);
      expect(childReplay.sessionName).toBe('forked-child');
      expect(
        childReplay.checkpoints?.some(
          (checkpoint) => checkpoint.name === 'child-checkpoint',
        ),
      ).toBe(true);
    });
  });

  describe('A9: checkpoint replay fidelity', () => {
    it('checkpoint after provider switch replays with correct provider', async () => {
      const parent = new SessionRecordingService(
        makeConfig(chatsDir(), { provider: 'openai', model: 'gpt-4' }),
      );
      parent.recordContent(makeContent('A', 'human'));
      parent.recordContent(makeContent('B', 'ai'));
      parent.recordProviderSwitch('anthropic', 'claude-4');
      parent.recordContent(makeContent('C', 'human'));
      const cp = await parent.createCheckpoint('atC');
      await parent.flush();
      await parent.dispose();

      const transition = new SessionTransitionService();
      const fork = await transition.forkFromCheckpoint(
        {
          kind: 'checkpoint',
          source: {
            sessionId: parent.getSessionId(),
            filePath: parent.getFilePath()!,
            projectHash: PROJECT_HASH,
            startTime: new Date().toISOString(),
            lastModified: new Date(),
            fileSize: 0,
            provider: 'openai',
            model: 'gpt-4',
          },
          checkpointId: cp.checkpointId,
          checkpointName: cp.name,
          sequence: cp.sequence,
        },
        chatsDir(),
        PROJECT_HASH,
        'anthropic',
        'claude-4',
        ['/test/workspace'],
      );
      requireForkSuccess(fork);

      // Child should have 3 items (A, B, C) with the active provider context.
      expect(fork.history).toHaveLength(3);
      expect(fork.metadata).toMatchObject({
        provider: 'anthropic',
        model: 'claude-4',
      });
      const replay = await replaySession(
        fork.recording.getFilePath()!,
        PROJECT_HASH,
      );
      requireReplaySuccess(replay);
      expect(replay.metadata).toMatchObject({
        provider: 'anthropic',
        model: 'claude-4',
      });
      try {
        await fork.recording.dispose();
      } finally {
        await fork.lockHandle.release();
      }
    });
  });
});
