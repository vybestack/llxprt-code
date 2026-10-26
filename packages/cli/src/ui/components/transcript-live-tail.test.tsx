/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const { JournalDisplayWriter } = await import(
  '@vybestack/llxprt-code-core/journal/display-recording.js'
);

async function assertDisplayNotices(
  session: Awaited<ReturnType<typeof JournalSession.create>>,
  mounted: ReturnType<typeof render>,
): Promise<void> {
  const writer = new JournalDisplayWriter(session.store);
  await act(async () => {
    await writer.append({ type: 'slash' }, 'persisted slash output');
    await writer.append({ type: 'error' }, 'persisted error notice');
    await Bun.sleep(25);
  });
  await waitFor(() => {
    expect(mounted.lastFrame()).toContain('persisted slash output');
    expect(mounted.lastFrame()).toContain('persisted error notice');
  });
}

describe('journal-driven Ink transcript', () => {
  it('renders acknowledged partial output and later committed rows without a live-tail overlay', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ink-transcript-tail-'));
    const session = await JournalSession.create(
      join(directory, 'session.llxj'),
    );
    const recorder = new JournalArrivalRecorder(session.store);
    const viewport = {
      visibleKeys: [],
      viewportLines: 12,
      rowHeightLines: () => 1,
    };
    const pager = createScrollbackPagerStore({
      filePath: session.path,
      pageRows: 4,
      viewport,
      settings: {
        marginViewports: 1,
        byteFloorBytes: 65536,
        purgeDebounceMs: 0,
      },
    });
    let view: ReturnType<typeof render> | undefined;
    try {
      await session.append([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'submitted prompt' }],
        },
      ]);
      const row = await recorder.beginRow(
        encodeContentRow({ speaker: 'ai', blocks: [] }, { owner: 0 }),
        { id: 'a', submissionId: 's' },
      );
      const block = await recorder.beginNamedBlock(row, 0);
      await pager.resumeFromJournal();
      view = render(
        <ScrollbackViewport
          store={pager}
          viewport={viewport}
          viewportLines={12}
          pollMs={10}
        />,
      );
      await act(async () => {
        await recorder.appendText(block, 'text', 'visible partial response');
        await recorder.flush();
        await Bun.sleep(25);
      });
      const mounted = view;
      await waitFor(() =>
        expect(mounted.lastFrame()).toContain('visible partial response'),
      );
      await act(async () => {
        await recorder.endBlock(block);
        await recorder.sealRow(row);
        await session.append([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'later committed prompt' }],
          },
        ]);
        await Bun.sleep(25);
      });
      await waitFor(() =>
        expect(mounted.lastFrame()).toContain('later committed prompt'),
      );
      expect(
        pager
          .getState()
          .rows.filter((item) => item.item.text === 'visible partial response'),
      ).toHaveLength(1);
      expect(pager.getState().error).toBeNull();
      await assertDisplayNotices(session, mounted);
    } finally {
      view?.unmount();
      await pager.close();
      await recorder.close();
      await session.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
