/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';
import { MetadataJsonProjection } from './metadataJsonProjection.js';
import { foldDurableRows } from './durableRowFold.js';
import type { IContent } from '../services/history/IContent.js';
import { field } from './resolverProjection.js';
import { purgeRow } from './purge-durable-fold-test-helpers.js';

async function* source(): AsyncGenerator<IContent> {
  for (let index = 0; index < 8192; index++) yield purgeRow(index);
}
async function withRecording(
  action: (recording: SessionRecordingService) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'purge-recording-order-'));
  const recording = new SessionRecordingService({
    sessionId: 'order',
    projectHash: 'order',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  try {
    await action(recording);
  } finally {
    await recording.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}
const frontier = { contentIndex: 0, blockIndex: 0 };

describe('oversized purge preflight cancellation before admission', () => {
  it('preserves exact original bytes, sequence and membership, then admits a fresh replacement', async () => {
    await withRecording(async (recording) => {
      recording.recordContent(purgeRow(99));
      await recording.flush();
      const file = recording.getFilePath();
      if (!file) throw new Error('Missing journal');
      const before = await readFile(file);
      const controller = new AbortController();
      const failure = new Error('cancel preflight');
      const push = MetadataJsonProjection.prototype.push;
      const watch = spyOn(
        MetadataJsonProjection.prototype,
        'push',
      ).mockImplementation(function (
        this: MetadataJsonProjection,
        text: string,
      ): void {
        push.call(this, text);
        controller.abort(failure);
      });
      try {
        await expect(
          recording.recordSemanticMediaPurgeRows(source(), frontier, {
            requireLiveFold: true,
            signal: controller.signal,
          }),
        ).rejects.toBe(failure);
      } finally {
        watch.mockRestore();
      }
      expect((await readFile(file)).equals(before)).toBe(true);
      expect(recording.isActive()).toBe(true);
      expect(recording.getPendingRecordCount()).toBe(0);
      const original = await foldDurableRows({
        filePath: file,
        maxBytes: before.length,
      });
      try {
        expect(await original.readRow(0)).toStrictEqual(purgeRow(99));
      } finally {
        await original.close();
      }
      await recording.recordSemanticMediaPurgeRows(source(), frontier, {
        requireLiveFold: true,
      });
      const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
      expect(lines).toHaveLength(3);
      expect(field(JSON.parse(lines[2]), 'seq')).toBe(3);
    });
  });
});

describe('oversized purge preflight interleaving admission', () => {
  it('admits exactly one replacement after a content enqueue during preflight and preserves sequence order', async () => {
    await withRecording(async (recording) => {
      const push = MetadataJsonProjection.prototype.push;
      let interleaved = false;
      const watch = spyOn(
        MetadataJsonProjection.prototype,
        'push',
      ).mockImplementation(function (
        this: MetadataJsonProjection,
        text: string,
      ): void {
        push.call(this, text);
        if (!interleaved) {
          interleaved = true;
          recording.recordContent(purgeRow(99));
        }
      });
      try {
        await recording.recordSemanticMediaPurgeRows(source(), frontier, {
          requireLiveFold: true,
        });
      } finally {
        watch.mockRestore();
      }
      const file = recording.getFilePath();
      if (!file) throw new Error('Missing journal');
      const text = await readFile(file, 'utf8');
      const lines = text
        .trimEnd()
        .split('\n')
        .map((line: string): unknown => JSON.parse(line));
      expect(lines.map((line) => field(line, 'type'))).toStrictEqual([
        'session_start',
        'content',
        'semantic_media_purge',
      ]);
      expect(lines.map((line) => field(line, 'seq'))).toStrictEqual([1, 2, 3]);
      const fold = await foldDurableRows({
        filePath: file,
        maxBytes: Buffer.byteLength(text),
      });
      try {
        expect(fold.length).toBe(8192);
        expect(await fold.readRow(0)).toStrictEqual(purgeRow(0));
        expect(await fold.readRow(8191)).toStrictEqual(purgeRow(8191));
      } finally {
        await fold.close();
      }
    });
  });
});
