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
 * Behavioral integration tests for checkpoint lifecycle on closed source sessions.
 * Tests lock-checked append, monotonic sequence, and lifecycle folding.
 * Uses real recording files in temp dirs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { CheckpointService } from './CheckpointService.js';
import { SessionLockManager } from './SessionLockManager.js';
import { replaySession } from './ReplayEngine.js';
import { type SessionRecordingServiceConfig } from './types.js';
import { type IContent } from '../services/history/IContent.js';

function requireReplaySuccess(
  result: Awaited<ReturnType<typeof replaySession>>,
): asserts result is Extract<
  Awaited<ReturnType<typeof replaySession>>,
  { ok: true }
> {
  if (!result.ok) throw new Error(`Expected replay success: ${result.error}`);
}
const PROJECT_HASH = 'lifecycle-project-hash';

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
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lifecycle-'));
      await fs.mkdir(path.join(dir, 'chats'), { recursive: true });
    },
    teardown: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

describe('checkpoint lifecycle on closed sessions @plan:2026-07-28-issue-2625', () => {
  const tmp = tempDirHelper();
  beforeEach(tmp.setup);
  afterEach(tmp.teardown);
  const chatsDir = () => path.join(tmp.getDir(), 'chats');

  describe('A6: lifecycle folds by stable ID', () => {
    it('rename preserves ID and sequence', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir()));
      svc.recordContent(makeContent('A', 'human'));
      svc.recordContent(makeContent('B', 'ai'));
      const cp = await svc.createCheckpoint('original');
      await svc.flush();
      await svc.dispose();

      const cpService = new CheckpointService();
      await cpService.renameCheckpointClosed(
        svc.getFilePath()!,
        PROJECT_HASH,
        chatsDir(),
        svc.getSessionId(),
        cp.checkpointId,
        'renamed',
      );

      const result = await replaySession(svc.getFilePath()!, PROJECT_HASH);
      requireReplaySuccess(result);
      {
        const checkpoints = result.checkpoints ?? [];
        expect(checkpoints).toHaveLength(1);
        expect(checkpoints[0].checkpointId).toBe(cp.checkpointId);
        expect(checkpoints[0].name).toBe('renamed');
        expect(checkpoints[0].sequence).toBe(cp.sequence);
      }
    });

    it('delete removes only the reference, not other checkpoints', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir()));
      svc.recordContent(makeContent('A', 'human'));
      const cp1 = await svc.createCheckpoint('foo');
      svc.recordContent(makeContent('B', 'ai'));
      await svc.createCheckpoint('bar');
      await svc.flush();
      await svc.dispose();

      const cpService = new CheckpointService();
      await cpService.deleteCheckpointClosed(
        svc.getFilePath()!,
        PROJECT_HASH,
        chatsDir(),
        svc.getSessionId(),
        cp1.checkpointId,
      );

      const checkpoints = await cpService.listCheckpoints(
        svc.getFilePath()!,
        PROJECT_HASH,
      );
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].name).toBe('bar');
    });
  });

  describe('project-wide lifecycle coordination', () => {
    it('rejects a second concurrent creator of the same project-wide name', async () => {
      const first = await SessionRecordingService.createLocked(
        makeConfig(chatsDir()),
      );
      const second = await SessionRecordingService.createLocked(
        makeConfig(chatsDir()),
      );
      first.recordContent(makeContent('first'));
      second.recordContent(makeContent('second'));
      await Promise.all([first.flush(), second.flush()]);

      try {
        const service = new CheckpointService();
        const results = await Promise.allSettled([
          service.createCheckpoint(first, PROJECT_HASH, 'shared-name'),
          service.createCheckpoint(second, PROJECT_HASH, 'shared-name'),
        ]);

        expect(
          results.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        expect(
          results.filter((result) => result.status === 'rejected'),
        ).toHaveLength(1);
      } finally {
        await Promise.allSettled([first.dispose(), second.dispose()]);
      }
    });

    it('rejects a duplicate name when creating a checkpoint on a closed session', async () => {
      const first = new SessionRecordingService(makeConfig(chatsDir()));
      first.recordContent(makeContent('first'));
      await first.createCheckpoint('shared-name');
      await first.flush();
      await first.dispose();

      const second = new SessionRecordingService(makeConfig(chatsDir()));
      second.recordContent(makeContent('second'));
      await second.flush();
      await second.dispose();

      const service = new CheckpointService();
      await expect(
        service.createCheckpointClosed(
          second.getFilePath()!,
          PROJECT_HASH,
          chatsDir(),
          second.getSessionId(),
          'shared-name',
        ),
      ).rejects.toThrow(/already exists/);
      expect(
        await service.listCheckpoints(second.getFilePath()!, PROJECT_HASH),
      ).toHaveLength(0);
    });

    it('overwrites a colliding closed-session checkpoint after confirmation', async () => {
      const replaced = new SessionRecordingService(makeConfig(chatsDir()));
      replaced.recordContent(makeContent('replaced'));
      const oldCheckpoint = await replaced.createCheckpoint('shared-name');
      await replaced.flush();
      await replaced.dispose();

      const source = new SessionRecordingService(makeConfig(chatsDir()));
      source.recordContent(makeContent('source'));
      const sourceCheckpoint = await source.createCheckpoint('source-name');
      await source.flush();
      await source.dispose();

      await new CheckpointService().renameCheckpointClosed(
        source.getFilePath()!,
        PROJECT_HASH,
        chatsDir(),
        source.getSessionId(),
        sourceCheckpoint.checkpointId,
        'shared-name',
        true,
      );

      const replacedReplay = await replaySession(
        replaced.getFilePath()!,
        PROJECT_HASH,
      );
      requireReplaySuccess(replacedReplay);
      expect(
        replacedReplay.checkpoints?.find(
          (checkpoint) =>
            checkpoint.checkpointId === oldCheckpoint.checkpointId,
        )?.deleted,
      ).toBe(true);
      const sourceReplay = await replaySession(
        source.getFilePath()!,
        PROJECT_HASH,
      );
      requireReplaySuccess(sourceReplay);
      expect(sourceReplay.checkpoints).toContainEqual(
        expect.objectContaining({
          checkpointId: sourceCheckpoint.checkpointId,
          name: 'shared-name',
          deleted: false,
        }),
      );
    });

    it('overwrites a colliding checkpoint in the active recording', async () => {
      const recording = await SessionRecordingService.createLocked(
        makeConfig(chatsDir()),
      );
      recording.recordContent(makeContent('source'));
      const replaced = await recording.createCheckpoint('shared-name');
      recording.recordContent(makeContent('tail'));

      try {
        const created = await new CheckpointService().createCheckpoint(
          recording,
          PROJECT_HASH,
          'shared-name',
          true,
        );

        const replay = await replaySession(
          recording.getFilePath()!,
          PROJECT_HASH,
        );
        requireReplaySuccess(replay);
        expect(
          replay.checkpoints?.find(
            (checkpoint) => checkpoint.checkpointId === replaced.checkpointId,
          )?.deleted,
        ).toBe(true);
        expect(replay.checkpoints).toContainEqual(
          expect.objectContaining({
            checkpointId: created.checkpointId,
            name: 'shared-name',
            deleted: false,
          }),
        );
      } finally {
        await recording.dispose();
      }
    });

    it('restores an overwritten checkpoint when the replacement action fails', async () => {
      const recording = await SessionRecordingService.createLocked(
        makeConfig(chatsDir()),
      );
      recording.recordContent(makeContent('source'));
      const existing = await recording.createCheckpoint('shared-name');
      recording.recordContent(makeContent('tail'));
      const createSpy = vi
        .spyOn(recording, 'createCheckpoint')
        .mockRejectedValueOnce(new Error('replacement failed'));

      try {
        await expect(
          new CheckpointService().createCheckpoint(
            recording,
            PROJECT_HASH,
            'shared-name',
            true,
          ),
        ).rejects.toThrow('replacement failed');

        const replay = await replaySession(
          recording.getFilePath()!,
          PROJECT_HASH,
        );
        requireReplaySuccess(replay);
        expect(replay.checkpoints).toContainEqual(
          expect.objectContaining({
            checkpointId: existing.checkpointId,
            name: 'shared-name',
            deleted: false,
          }),
        );
      } finally {
        createSpy.mockRestore();
        await recording.dispose();
      }
    });
  });

  describe('A15: metadata fold exposes checkpoints separately from history', () => {
    it('checkpoint events never appear in replayed history', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir()));
      svc.recordContent(makeContent('A', 'human'));
      await svc.createCheckpoint('foo');
      svc.recordContent(makeContent('B', 'ai'));
      await svc.flush();
      await svc.dispose();

      const result = await replaySession(svc.getFilePath()!, PROJECT_HASH);
      requireReplaySuccess(result);
      {
        // History has only content items, no checkpoint events
        expect(result.history).toHaveLength(2);
        // Checkpoints are exposed separately
        expect(result.checkpoints ?? []).toHaveLength(1);
        expect(result.checkpoints![0].name).toBe('foo');
      }
    });
  });

  describe('A17: closed-source append is lock-checked and monotonic', () => {
    it('held lock causes error and no write', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir()));
      svc.recordContent(makeContent('A', 'human'));
      const cp = await svc.createCheckpoint('foo');
      await svc.flush();
      await svc.dispose();

      const beforeEventLines = (await fs.readFile(svc.getFilePath()!, 'utf-8'))
        .trim()
        .split('\n').length;
      // Acquire the lock manually to simulate another process holding it
      const blockingLock = await SessionLockManager.acquire(
        chatsDir(),
        svc.getSessionId(),
      );

      try {
        const cpService = new CheckpointService();
        await expect(
          cpService.deleteCheckpointClosed(
            svc.getFilePath()!,
            PROJECT_HASH,
            chatsDir(),
            svc.getSessionId(),
            cp.checkpointId,
          ),
        ).rejects.toThrow(/in use/);

        const result = await replaySession(svc.getFilePath()!, PROJECT_HASH);
        requireReplaySuccess(result);
        expect(result.eventCount).toBe(beforeEventLines);
      } finally {
        await blockingLock.release();
      }
    });

    it('exactly one event is appended at lastSeq + 1', async () => {
      const svc = new SessionRecordingService(makeConfig(chatsDir()));
      svc.recordContent(makeContent('A', 'human'));
      svc.recordContent(makeContent('B', 'ai'));
      await svc.createCheckpoint('foo');
      await svc.flush();
      await svc.dispose();

      // Read file content before append
      const beforeContent = await fs.readFile(svc.getFilePath()!, 'utf-8');
      const beforeLines = beforeContent.trim().split('\n');
      const beforeLastLine = JSON.parse(
        beforeLines[beforeLines.length - 1],
      ) as {
        seq: number;
      };
      const beforeLastSeq = beforeLastLine.seq;

      // Do a rename (append) via CheckpointService
      const result = await replaySession(svc.getFilePath()!, PROJECT_HASH);
      requireReplaySuccess(result);

      const cp = (result.checkpoints ?? [])[0];
      const cpService = new CheckpointService();
      await cpService.renameCheckpointClosed(
        svc.getFilePath()!,
        PROJECT_HASH,
        chatsDir(),
        svc.getSessionId(),
        cp.checkpointId,
        'renamed',
      );

      // Verify exactly one line was appended
      const afterContent = await fs.readFile(svc.getFilePath()!, 'utf-8');
      const afterLines = afterContent.trim().split('\n');
      expect(afterLines.length).toBe(beforeLines.length + 1);

      const appendedLine = JSON.parse(afterLines[afterLines.length - 1]) as {
        seq: number;
        type: string;
      };
      expect(appendedLine.seq).toBe(beforeLastSeq + 1);
      expect(appendedLine.type).toBe('checkpoint_renamed');

      // Prior bytes unchanged
      const priorBytes = afterLines.slice(0, beforeLines.length).join('\n');

      const originalBytes = beforeLines.join('\n');
      expect(priorBytes).toBe(originalBytes);
    });
  });

  it('does not append closed metadata to a sequence-corrupt recording', async () => {
    const svc = new SessionRecordingService(makeConfig(chatsDir()));
    svc.recordContent(makeContent('A', 'human'));
    const checkpoint = await svc.createCheckpoint('foo');
    await svc.dispose();
    const filePath = svc.getFilePath()!;
    const original = await fs.readFile(filePath, 'utf-8');
    const lines = original.trim().split('\n');
    const lowerSequenceEvent = {
      ...(JSON.parse(lines[1]) as Record<string, unknown>),
      seq: 1,
    };
    await fs.appendFile(
      filePath,
      `${JSON.stringify(lowerSequenceEvent)}\n`,
      'utf-8',
    );
    const corruptBytes = await fs.readFile(filePath, 'utf-8');

    await expect(
      new CheckpointService().deleteCheckpointClosed(
        filePath,
        PROJECT_HASH,
        chatsDir(),
        svc.getSessionId(),
        checkpoint.checkpointId,
      ),
    ).rejects.toThrow('sequence-corrupt recording');
    expect(await fs.readFile(filePath, 'utf-8')).toBe(corruptBytes);
  });

  describe('SessionRecordingService disposal failures', () => {
    let tempDir: string;
    let chatsDir: string;
    let service: SessionRecordingService | undefined;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-dispose-'));
      chatsDir = path.join(tempDir, 'chats');
      await fs.mkdir(chatsDir, { recursive: true });
    });

    afterEach(async () => {
      await service?.dispose().catch(() => undefined);
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('releases its lock and becomes inactive when the final flush fails', async () => {
      const config = makeConfig(chatsDir, {
        sessionId: 'dispose-flush-failure-session',
      });
      service = await SessionRecordingService.createLocked(config);
      vi.spyOn(service, 'flush').mockRejectedValueOnce(
        new Error('final flush failed'),
      );

      await expect(service.dispose()).rejects.toThrow('final flush failed');

      expect(service.isActive()).toBe(false);
      expect(
        await SessionLockManager.isLocked(chatsDir, config.sessionId),
      ).toBe(false);
    });
  });
});
