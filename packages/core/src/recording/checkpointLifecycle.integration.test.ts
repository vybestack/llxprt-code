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

import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { assertNotNull } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { type IContent } from '../services/history/IContent.js';
import { JournalCheckpointService } from './journalCheckpointService.js';
import {
  readJournalSnapshot,
  type JournalSnapshot,
} from './__tests__/support/journalSnapshot.js';
import { SessionLockManager } from './SessionLockManager.js';
import { openJournalReadOnly } from '../journal/journalReader.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { JournalRecordingService } from './journalRecordingService.js';
import {
  type CheckpointMetadataView,
  type SessionRecordingServiceConfig,
} from './types.js';

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

/**
 * Checkpoints folded from a successful replay (empty when no checkpoint
 * metadata events are present).
 */
function foldedCheckpoints(
  result: JournalSnapshot,
): readonly CheckpointMetadataView[] {
  return result.checkpoints;
}

describe('checkpoint lifecycle on closed sessions @plan:2026-07-28-issue-2625', () => {
  const tmp = tempDirHelper();
  beforeEach(tmp.setup);
  afterEach(tmp.teardown);
  const chatsDir = () => path.join(tmp.getDir(), 'chats');

  describe('A6: lifecycle folds by stable ID', () => {
    it('rename preserves ID and sequence', async () => {
      const svc = JournalRecordingService.create(makeConfig(chatsDir()));
      await recordRowsForTest(svc, [makeContent('A', 'human')]);
      await recordRowsForTest(svc, [makeContent('B', 'ai')]);
      const cp = await svc.createCheckpoint('original');
      await svc.flush();
      await svc.dispose();

      const cpService = new JournalCheckpointService();
      await cpService.renameCheckpointClosed(
        svc.getFilePath()!,
        PROJECT_HASH,
        chatsDir(),
        svc.getSessionId(),
        cp.checkpointId,
        'renamed',
      );

      const result = await readJournalSnapshot(
        svc.getFilePath()!,
        PROJECT_HASH,
      );
      {
        const checkpoints = foldedCheckpoints(result);
        expect(checkpoints).toHaveLength(1);
        expect(checkpoints[0].checkpointId).toBe(cp.checkpointId);
        expect(checkpoints[0].name).toBe('renamed');
        expect(checkpoints[0].sequence).toBe(cp.sequence);
      }
    });

    it('delete removes only the reference, not other checkpoints', async () => {
      const svc = JournalRecordingService.create(makeConfig(chatsDir()));
      await recordRowsForTest(svc, [makeContent('A', 'human')]);
      const cp1 = await svc.createCheckpoint('foo');
      await recordRowsForTest(svc, [makeContent('B', 'ai')]);
      await svc.createCheckpoint('bar');
      await svc.flush();
      await svc.dispose();

      const cpService = new JournalCheckpointService();
      await cpService.deleteCheckpointClosed(
        svc.getFilePath()!,
        PROJECT_HASH,
        chatsDir(),
        svc.getSessionId(),
        cp1.checkpointId,
      );

      const checkpoints = await cpService.listCheckpoints(svc.getFilePath()!);
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].name).toBe('bar');
    });
  });

  describe('project-wide lifecycle coordination', () => {
    it('rejects a second concurrent creator of the same project-wide name', async () => {
      const first = await JournalRecordingService.createLocked(
        makeConfig(chatsDir()),
      );
      const second = await JournalRecordingService.createLocked(
        makeConfig(chatsDir()),
      );
      await recordRowsForTest(first, [makeContent('first')]);
      await recordRowsForTest(second, [makeContent('second')]);
      await Promise.all([first.flush(), second.flush()]);

      try {
        const service = new JournalCheckpointService();
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
      const first = JournalRecordingService.create(makeConfig(chatsDir()));
      await recordRowsForTest(first, [makeContent('first')]);
      await first.createCheckpoint('shared-name');
      await first.flush();
      await first.dispose();

      const second = JournalRecordingService.create(makeConfig(chatsDir()));
      await recordRowsForTest(second, [makeContent('second')]);
      await second.flush();
      await second.dispose();

      const service = new JournalCheckpointService();
      await expect(
        service.createCheckpointClosed(
          second.getFilePath()!,
          PROJECT_HASH,
          chatsDir(),
          second.getSessionId(),
          'shared-name',
        ),
      ).rejects.toThrow(/already exists/);
      expect(await service.listCheckpoints(second.getFilePath()!)).toHaveLength(
        0,
      );
    });

    it('overwrites a colliding closed-session checkpoint after confirmation', async () => {
      const replaced = JournalRecordingService.create(makeConfig(chatsDir()));
      await recordRowsForTest(replaced, [makeContent('replaced')]);
      const oldCheckpoint = await replaced.createCheckpoint('shared-name');
      await replaced.flush();
      await replaced.dispose();

      const source = JournalRecordingService.create(makeConfig(chatsDir()));
      await recordRowsForTest(source, [makeContent('source')]);
      const sourceCheckpoint = await source.createCheckpoint('source-name');
      await source.flush();
      await source.dispose();

      await new JournalCheckpointService().renameCheckpointClosed(
        source.getFilePath()!,
        PROJECT_HASH,
        chatsDir(),
        source.getSessionId(),
        sourceCheckpoint.checkpointId,
        'shared-name',
        true,
      );

      const replacedReplay = await readJournalSnapshot(
        replaced.getFilePath()!,
        PROJECT_HASH,
      );
      expect(
        replacedReplay.checkpoints.find(
          (checkpoint) =>
            checkpoint.checkpointId === oldCheckpoint.checkpointId,
        ),
      ).toBeUndefined();
      const sourceReplay = await readJournalSnapshot(
        source.getFilePath()!,
        PROJECT_HASH,
      );
      expect(sourceReplay.checkpoints).toContainEqual(
        expect.objectContaining({
          checkpointId: sourceCheckpoint.checkpointId,
          name: 'shared-name',
          deleted: false,
        }),
      );
    });

    it('overwrites a colliding checkpoint in the active recording', async () => {
      const recording = await JournalRecordingService.createLocked(
        makeConfig(chatsDir()),
      );
      await recordRowsForTest(recording, [makeContent('source')]);
      const replaced = await recording.createCheckpoint('shared-name');
      await recordRowsForTest(recording, [makeContent('tail')]);

      try {
        const created = await new JournalCheckpointService().createCheckpoint(
          recording,
          PROJECT_HASH,
          'shared-name',
          true,
        );

        const replay = await readJournalSnapshot(
          recording.getFilePath()!,
          PROJECT_HASH,
        );
        expect(
          replay.checkpoints.find(
            (checkpoint) => checkpoint.checkpointId === replaced.checkpointId,
          ),
        ).toBeUndefined();
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
      const recording = await JournalRecordingService.createLocked(
        makeConfig(chatsDir()),
      );
      await recordRowsForTest(recording, [makeContent('source')]);
      const existing = await recording.createCheckpoint('shared-name');
      await recordRowsForTest(recording, [makeContent('tail')]);
      const createSpy = vi
        .spyOn(recording, 'createCheckpoint')
        .mockRejectedValueOnce(new Error('replacement failed'));

      try {
        await expect(
          new JournalCheckpointService().createCheckpoint(
            recording,
            PROJECT_HASH,
            'shared-name',
            true,
          ),
        ).rejects.toThrow('replacement failed');

        const replay = await readJournalSnapshot(
          recording.getFilePath()!,
          PROJECT_HASH,
        );
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
      const svc = JournalRecordingService.create(makeConfig(chatsDir()));
      await recordRowsForTest(svc, [makeContent('A', 'human')]);
      await svc.createCheckpoint('foo');
      await recordRowsForTest(svc, [makeContent('B', 'ai')]);
      await svc.flush();
      await svc.dispose();

      const result = await readJournalSnapshot(
        svc.getFilePath()!,
        PROJECT_HASH,
      );
      {
        // History has only content items, no checkpoint events
        expect(result.history).toHaveLength(2);
        // Checkpoints are exposed separately
        const checkpoints = foldedCheckpoints(result);
        expect(checkpoints).toHaveLength(1);
        expect(checkpoints[0].name).toBe('foo');
      }
    });
  });

  describe('A17: closed-source append is lock-checked and monotonic', () => {
    it('held lock causes error and no write', async () => {
      const svc = JournalRecordingService.create(makeConfig(chatsDir()));
      await recordRowsForTest(svc, [makeContent('A', 'human')]);
      const cp = await svc.createCheckpoint('foo');
      await svc.flush();
      await svc.dispose();

      const beforeBytes = await fs.readFile(svc.getFilePath()!);
      // Acquire the lock manually to simulate another process holding it
      const blockingLock = await SessionLockManager.acquire(
        chatsDir(),
        svc.getSessionId(),
      );

      try {
        const cpService = new JournalCheckpointService();
        await expect(
          cpService.deleteCheckpointClosed(
            svc.getFilePath()!,
            PROJECT_HASH,
            chatsDir(),
            svc.getSessionId(),
            cp.checkpointId,
          ),
        ).rejects.toThrow(/in use/);

        const result = await readJournalSnapshot(
          svc.getFilePath()!,
          PROJECT_HASH,
        );
        expect(result.checkpoints).toContainEqual(
          expect.objectContaining({ checkpointId: cp.checkpointId }),
        );
        expect(await fs.readFile(svc.getFilePath()!)).toStrictEqual(
          beforeBytes,
        );
      } finally {
        await blockingLock.release();
      }
    });

    it('commits one metadata group without changing prior bytes', async () => {
      const svc = JournalRecordingService.create(makeConfig(chatsDir()));
      await recordRowsForTest(svc, [
        makeContent('A', 'human'),
        makeContent('B', 'ai'),
      ]);
      const checkpoint = await svc.createCheckpoint('foo');
      await svc.dispose();
      const filePath = svc.getFilePath()!;
      const beforeBytes = await fs.readFile(filePath);
      const before = await readJournalSnapshot(filePath, PROJECT_HASH);
      await new JournalCheckpointService().renameCheckpointClosed(
        filePath,
        PROJECT_HASH,
        chatsDir(),
        svc.getSessionId(),
        checkpoint.checkpointId,
        'renamed',
      );
      const afterBytes = await fs.readFile(filePath);
      const after = await readJournalSnapshot(filePath, PROJECT_HASH);
      expect(after.commitSeq).toBe(before.commitSeq + 1);
      expect(after.checkpoints).toContainEqual(
        expect.objectContaining({
          checkpointId: checkpoint.checkpointId,
          name: 'renamed',
        }),
      );
      expect(after.history).toStrictEqual(before.history);
      expect(afterBytes.subarray(0, beforeBytes.length)).toStrictEqual(
        beforeBytes,
      );
    });
  });

  it('lists checkpoint metadata without a media verification context', async () => {
    const mediaStore = new LocalMediaStore({
      rootDirectory: path.join(tmp.getDir(), 'media'),
      quotaBytes: 1024,
    });
    const reference = await mediaStore.admit({
      bytes: new Uint8Array([1, 2, 3, 4]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const recording = JournalRecordingService.create({
      ...makeConfig(chatsDir()),
      mediaStore,
    });
    await recordRowsForTest(recording, [
      { speaker: 'human', blocks: [reference] },
    ]);
    const checkpoint = await recording.createCheckpoint('verified-media');
    await recording.dispose();
    const filePath = recording.getFilePath();
    assertNotNull(filePath, 'Expected recording path');
    expect(
      (await new JournalCheckpointService().listCheckpoints(filePath)).map(
        ({ checkpointId, name, sequence, deleted }) => ({
          checkpointId,
          name,
          sequence,
          deleted,
        }),
      ),
    ).toStrictEqual([{ ...checkpoint, deleted: false }]);
  });

  it('does not append closed metadata to a corrupt journal', async () => {
    const recording = JournalRecordingService.create(makeConfig(chatsDir()));
    await recordRowsForTest(recording, [makeContent('A', 'human')]);
    const checkpoint = await recording.createCheckpoint('foo');
    await recording.dispose();
    const filePath = recording.getFilePath();
    assertNotNull(filePath, 'Expected recording path');
    const reader = await openJournalReadOnly(filePath);
    const root = reader.trailer?.stateRoot;
    await reader.close();
    if (root === undefined || root === 0)
      throw new Error('Missing checkpoint state root');
    const handle = await fs.open(filePath, 'r+');
    try {
      const crc = Buffer.alloc(1);
      await handle.read(crc, 0, 1, root + 16);
      crc[0] ^= 1;
      await handle.write(crc, 0, 1, root + 16);
    } finally {
      await handle.close();
    }
    const corruptBytes = await fs.readFile(filePath);
    await expect(
      new JournalCheckpointService().deleteCheckpointClosed(
        filePath,
        PROJECT_HASH,
        chatsDir(),
        recording.getSessionId(),
        checkpoint.checkpointId,
      ),
    ).rejects.toThrow(/corrupt|CRC/i);
    expect(await fs.readFile(filePath)).toStrictEqual(corruptBytes);
  });

  describe('JournalRecordingService disposal failures', () => {
    let tempDir: string;
    let chatsDir: string;
    let service: JournalRecordingService | undefined;

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
      service = await JournalRecordingService.createLocked(config);
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
