/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { retireSourceImages } from '../source-image-retirement.js';

function image(id: string): IContent {
  return {
    speaker: 'human',
    metadata: { turnId: id },
    blocks: [
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'AAAA',
      },
    ],
  };
}

describe('journal source image retirement', () => {
  it('discovers retirement without reading unrelated text rows or opening a whole-history reader', async () => {
    const history = new HistoryService();
    await history.addBatch([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'x'.repeat(10 * 1024 * 1024) }],
      },
      image('old'),
      image('pending'),
    ]);
    const source = await history.prepareCuratedForProviderSnapshot();
    const rows = spyOn(VersionSnapshot.prototype, 'readRow').mockImplementation(
      () => {
        throw new Error('Whole row materialization during media discovery');
      },
    );
    const stream = spyOn(source, 'openReader').mockImplementation(() => {
      throw new Error('Whole history traversal during media discovery');
    });
    let view: Awaited<ReturnType<typeof retireSourceImages>> = source;
    try {
      view = await retireSourceImages(source, [image('pending')], 1000, true);
    } finally {
      rows.mockRestore();
      stream.mockRestore();
    }
    try {
      expect(view.native).toBeDefined();
      expect((await view.readAt(1)).blocks[0]?.type).toBe('text');
      expect((await view.readAt(2)).blocks[0]?.type).toBe('media');
    } finally {
      await view.close();
    }
  });
  it('retires oldest images to the low water mark and protects a durably submitted user image', async () => {
    const history = new HistoryService();
    const pending = image('pending');
    await history.addBatch([image('old1'), image('old2'), pending]);
    const original = await history.prepareCuratedForProviderSnapshot();
    const view = await retireSourceImages(original, [pending], 10);
    try {
      expect(view.native).toBeDefined();
      expect((await view.readAt(0)).blocks[0]?.type).toBe('text');
      expect((await view.readAt(1)).blocks[0]?.type).toBe('text');
      expect((await view.readAt(2)).blocks).toStrictEqual(pending.blocks);
      expect((await original.readAt(0)).blocks[0]?.type).toBe('media');
    } finally {
      await view.close();
    }
  });

  it('keeps retirement disabled for an explicit zero budget', async () => {
    const history = new HistoryService();
    await history.addBatch([image('old'), image('new')]);
    const source = await history.prepareCuratedForProviderSnapshot();
    try {
      expect(await retireSourceImages(source, [], 0)).toBe(source);
    } finally {
      await source.close();
    }
  });

  it('relieves every historical image without retiring a repeated pending attachment', async () => {
    const history = new HistoryService();
    const pending = image('new');
    await history.addBatch([image('old'), pending]);
    const source = await history.prepareCuratedForProviderSnapshot();
    const view = await retireSourceImages(source, [pending], 1000, true);
    try {
      expect((await view.readAt(0)).blocks[0]?.type).toBe('text');
      expect((await view.readAt(1)).blocks).toStrictEqual(pending.blocks);
    } finally {
      await view.close();
    }
  });
  it('does not protect an older unlabeled copy beyond the pending occurrence count', async () => {
    const history = new HistoryService();
    const older = { ...image('older'), metadata: undefined };
    const first = image('now');
    const last = image('now');
    const declared = { ...first, blocks: [...first.blocks, ...first.blocks] };
    await history.addBatch([older, first, last]);
    const source = await history.prepareCuratedForProviderSnapshot();
    const view = await retireSourceImages(source, [declared], 1000, true);
    try {
      expect((await view.readAt(0)).blocks[0]?.type).toBe('text');
      expect((await view.readAt(1)).blocks).toStrictEqual(first.blocks);
      expect((await view.readAt(2)).blocks).toStrictEqual(last.blocks);
    } finally {
      await view.close();
    }
  });

  it('stops provenance extension at an unrelated text row', async () => {
    const history = new HistoryService();
    const fragment = image('now');
    const note: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'unrelated' }],
    };
    await history.addBatch([fragment, note, fragment, fragment]);
    const source = await history.prepareCuratedForProviderSnapshot();
    const view = await retireSourceImages(source, [fragment], 1000, true);
    try {
      expect((await view.readAt(0)).blocks[0]?.type).toBe('text');
      expect((await view.readAt(2)).blocks).toStrictEqual(fragment.blocks);
      expect((await view.readAt(3)).blocks).toStrictEqual(fragment.blocks);
    } finally {
      await view.close();
    }
  });
});
