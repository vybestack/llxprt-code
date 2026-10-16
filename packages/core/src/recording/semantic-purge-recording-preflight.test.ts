/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { foldDurableRows } from './durableRowFold.js';

const original: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'original' }],
};
async function* largeRows(): AsyncGenerator<IContent> {
  for (let index = 0; index < 8192; index++)
    yield {
      speaker: 'human',
      blocks: [{ type: 'text', text: `${index}:${'x'.repeat(2048)}` }],
    };
}
async function* corruptRows(): AsyncGenerator<IContent> {
  for await (const row of largeRows())
    yield {
      ...row,
      metadata: {
        chronology: { seq: -1, userTurn: 0, step: 0, recordedAt: 0 },
      },
    };
}
async function withRecording(
  action: (
    recording: SessionRecordingService,
    file: string,
    before: Buffer,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'purge-preflight-'));
  const recording = new SessionRecordingService({
    sessionId: 'preflight',
    projectHash: 'preflight',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  try {
    recording.recordContent(original);
    await recording.flush();
    const file = recording.getFilePath();
    if (!file) throw new Error('Missing journal');
    await action(recording, file, await readFile(file));
  } finally {
    await recording.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('semantic purge durable capability preflight: valid oversized replacement', () => {
  it('admits the original 8192-row fixture and reopens its exact membership without changing the preceding journal', async () => {
    await withRecording(async (recording, file, before) => {
      await recording.recordSemanticMediaPurgeRows(
        largeRows(),
        { contentIndex: 0, blockIndex: 0 },
        { requireLiveFold: true },
      );
      const after = await readFile(file);
      expect(after.subarray(0, before.length).equals(before)).toBe(true);
      expect(recording.getPendingRecordCount()).toBe(0);
      const fold = await foldDurableRows({
        filePath: file,
        maxBytes: after.length,
      });
      try {
        expect(fold.length).toBe(8192);
        let index = 0;
        for await (const expected of largeRows())
          expect(await fold.readRow(index++)).toStrictEqual(expected);
      } finally {
        await fold.close();
      }
    });
  });
});

describe('semantic purge durable capability preflight: unsupported chronology', () => {
  it('leaves exact journal bytes and live-fold membership unchanged when a replacement has invalid chronology', async () => {
    await withRecording(async (recording, file, before) => {
      await expect(
        recording.recordSemanticMediaPurgeRows(
          corruptRows(),
          { contentIndex: 0, blockIndex: 0 },
          { requireLiveFold: true },
        ),
      ).rejects.toMatchObject({
        name: 'UnsupportedDurableFoldEvent',
        eventType: 'non_numeric_chronology',
      });
      expect((await readFile(file)).equals(before)).toBe(true);
      expect(recording.isActive()).toBe(true);
      const fold = await foldDurableRows({
        filePath: file,
        maxBytes: before.length,
      });
      try {
        expect(fold.length).toBe(1);
        expect(await fold.readRow(0)).toStrictEqual(original);
      } finally {
        await fold.close();
      }
    });
  });
});
