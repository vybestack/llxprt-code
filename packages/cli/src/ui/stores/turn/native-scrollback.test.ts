/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { createScrollbackPagerStore } from './scrollbackPager.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';

describe('native journal scrollback', () => {
  it('resumes the last page and pages older committed rows in order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'native-scrollback-'));
    const recording = JournalRecordingService.create({
      chatsDir: directory,
      sessionId: 'scrollback',
      projectHash: 'project',
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    try {
      const session = await recording.session();
      await session.append(
        Array.from({ length: 7 }, (_, index) => ({
          speaker: 'human',
          blocks: [{ type: 'text', text: `message ${index}` }],
        })),
      );
      const decoded = createRowCounters();
      const ownership = new RowOwnership();
      const pager = createScrollbackPagerStore({
        counters: { ...decoded.counters, ownership },
        filePath: session.path,
        pageRows: 2,
        viewport: {
          visibleKeys: [],
          viewportLines: 2,
          rowHeightLines: () => 1,
        },
        settings: {
          marginViewports: 1,
          byteFloorBytes: 65536,
          purgeDebounceMs: 0,
        },
      });
      try {
        expect((await pager.resumeFromJournal()).seededRows).toBe(2);
        expect(decoded.snapshot().rowsDecoded).toBe(7);
        expect(ownership.snapshot().liveRows).toBe(2);
        expect(
          pager
            .getState()
            .rows.map(({ item }) => ('text' in item ? item.text : '')),
        ).toStrictEqual(['message 5', 'message 6']);
        await pager.pageBack();
        expect(
          pager
            .getState()
            .rows.map(({ item }) => ('text' in item ? item.text : '')),
        ).toStrictEqual(['message 3', 'message 4', 'message 5', 'message 6']);
        await session.append([
          { speaker: 'ai', blocks: [{ type: 'text', text: 'new reply' }] },
        ]);
        await pager.pageForward();
        expect(pager.getState().rows.at(-1)?.item).toMatchObject({
          text: 'new reply',
        });
        expect(pager.getState().error).toBeNull();
      } finally {
        await pager.close();
      }
      expect(ownership.snapshot().liveRows).toBe(0);
    } finally {
      await recording.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
