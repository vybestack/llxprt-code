/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { foldDurableRows } from './durableRowFold.js';

describe('oversized individual purge row staging allocations', () => {
  it('writes only bounded UTF-8 chunks during staging and preflight while preserving surrogate pairs and the lazy row', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'purge-stage-bound-'));
    const recording = new SessionRecordingService({
      sessionId: 'bound',
      projectHash: 'bound',
      chatsDir: directory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    const text = '雪😀'.repeat(2_000_000);
    const expected: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text }],
    };
    const open = fs.open;
    let peak = 0;
    const watch = spyOn(fs, 'open').mockImplementation(
      async (...args: Parameters<typeof fs.open>) => {
        const handle = await open(...args);
        const write = handle.writeFile.bind(handle);
        Object.defineProperty(handle, 'writeFile', {
          value: async (
            ...writeArgs: Parameters<typeof handle.writeFile>
          ): Promise<void> => {
            if (typeof writeArgs[0] === 'string') {
              const bytes = Buffer.byteLength(writeArgs[0]);
              if (bytes > 8 * 1024 * 1024)
                throw new Error('oversized staging buffer trap');
              peak = Math.max(peak, bytes);
            }
            await write(...writeArgs);
          },
        });
        return handle;
      },
    );
    async function* source(): AsyncGenerator<IContent> {
      yield expected;
    }
    try {
      await recording.recordSemanticMediaPurgeRows(
        source(),
        { contentIndex: 0, blockIndex: 0 },
        { requireLiveFold: true },
      );
      const file = recording.getFilePath();
      if (!file) throw new Error('Missing journal');
      const fold = await foldDurableRows({
        filePath: file,
        maxBytes: (await fs.stat(file)).size,
      });
      try {
        expect(await fold.readRow(0)).toStrictEqual(expected);
      } finally {
        await fold.close();
      }
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThanOrEqual(256 * 1024);
    } finally {
      watch.mockRestore();
      await recording.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
