/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { join } from 'node:path';
import type { ScrollbackViewportReporter } from '../stores/turn/scrollbackPager.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
await import('ink-testing-library');
const ink = await import('../../../test-utils/real-ink.js');
void vi.mock('ink', () => ink);
const { render, waitFor } = await import('../../__tests__/render.js');
const { ScrollbackViewport } = await import('./ScrollbackViewport.js');
const { JournalSession } = await import('@vybestack/llxprt-code-core');
const { JournalArrivalRecorder } = await import(
  '@vybestack/llxprt-code-core/journal/arrival-recorder.js'
);
const { encodeContentRow } = await import(
  '@vybestack/llxprt-code-core/services/history/journalRowCodec.js'
);
const { createScrollbackPagerStore } = await import(
  '../stores/turn/scrollbackPager.js'
);

async function fixture(directory: string) {
  const session = await JournalSession.create(join(directory, 'session.llxj'));
  for (let index = 0; index < 12; index++) {
    await session.append([
      { speaker: 'human', blocks: [{ type: 'text', text: `anchor-${index}` }] },
    ]);
  }
  const recorder = new JournalArrivalRecorder(session.store);
  const viewport: ScrollbackViewportReporter = {
    visibleKeys: [],
    viewportLines: 2,
    rowHeightLines: () => 1,
  };
  const pager = createScrollbackPagerStore({
    filePath: session.path,
    pageRows: 4,
    viewport,
    settings: { marginViewports: 1, byteFloorBytes: 65536, purgeDebounceMs: 0 },
  });
  await pager.resumeFromJournal();
  const view = render(
    <ScrollbackViewport
      store={pager}
      viewport={viewport}
      viewportLines={2}
      pollMs={10}
    />,
  );
  return {
    session,
    recorder,
    viewport,
    pager,
    view,
    close: async (): Promise<void> => {
      view.unmount();
      await pager.close();
      await recorder.close();
      await session.close();
    },
  };
}

describe('journal output while scrolled away', () => {
  const directory = useTempDir('journal-output-indicator-');

  it('keeps the anchor and only a scalar indicator, then reads the current row at the tail', async () => {
    const current = await fixture(directory());
    try {
      await waitFor(() =>
        expect(current.view.lastFrame()).toContain('anchor-11'),
      );
      await act(async () => {
        current.view.stdin.write('\u001b[5~');
        await Bun.sleep(30);
      });
      await waitFor(() => {
        expect(current.viewport.followingTail).toBe(false);
        expect(current.pager.getState().loadingOlder).toBe(false);
        expect(current.pager.metrics().residentRows).toBe(8);
      });
      const anchor = current.view.lastFrame();
      const row = await current.recorder.beginRow(
        encodeContentRow({ speaker: 'ai', blocks: [] }, { owner: 0 }),
        { id: 'tail', submissionId: 's' },
      );
      const block = await current.recorder.beginNamedBlock(row, 0);
      await act(async () => {
        await current.recorder.appendText(block, 'text', 'offscreen response');
        await current.recorder.flush();
        await Bun.sleep(30);
      });
      await waitFor(() =>
        expect(current.view.lastFrame()).toContain('new output below'),
      );
      expect(current.view.lastFrame()).not.toContain('offscreen response');
      expect(current.pager.metrics().residentRows).toBe(8);
      expect(
        current.pager
          .getState()
          .rows.some(
            (entry) => entry.item.text?.includes('offscreen response') === true,
          ),
      ).toBe(false);
      expect(
        current.view
          .lastFrame()
          ?.split('\n')
          .filter((line) => line.includes('anchor-')),
      ).toStrictEqual(
        anchor?.split('\n').filter((line) => line.includes('anchor-')),
      );
      await act(async () => {
        current.view.stdin.write('\u001b[F');
        await Bun.sleep(30);
      });
      await waitFor(() =>
        expect(current.view.lastFrame()).toContain('offscreen response'),
      );
      expect(current.view.lastFrame()).not.toContain('new output below');
      expect('setLiveTail' in current.pager).toBe(false);
      expect('commitPendingRow' in current.pager).toBe(false);
    } finally {
      await current.close();
    }
  });
});
