/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P02d
 * @requirement G1,G2
 *
 * Behavioral tests for the ScrollbackViewport component (issue-854-design.md
 * §3): the pager's own window over the ScrollbackPagerStore — resident rows
 * rendered identity-anchored and clipped to the viewport, visibility reported
 * through the store-shared ScrollbackViewportReporter, pageBack/pageForward
 * driven from PageUp/PageDown input, and loading / visibility-floor /
 * below-bottom placeholder rows.
 *
 * The store exposes no subscription API, so the component re-reads
 * getState() on a poll cadence (`pollMs`) and after each input or resize;
 * tests pass a small cadence and use waitFor to observe store-driven
 * changes. Rendering goes through real Ink: 'ink' is redirected to the real
 * Ink build while ink-testing-library renders into fake streams, matching
 * footer-trust.test.tsx. G1 is pinned by the census test: rendered rows stay
 * bounded by the window across repeated page cycles while store residency
 * grows. G2 is pinned by paging real journal records through a real
 * JournalCursor on a real temp file.
 *
 * P02d addendum: Home/End edge jumps (raw stdin sequences; Ink's useInput
 * exposes no home/end), arrow-key wheel-path paging with onScrollUp /
 * onScrollDown, an error row in place of the top edge, the window anchor
 * held on its first line across row-height expansion, an explicit
 * equal-length slide contiguity pin, and pending live-tail slots below the
 * window while scrolled away.
 */

import { act } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
await import('ink-testing-library');
const ink = await import('../../../test-utils/real-ink.js');
void vi.mock('ink', () => ink);
import type { IContent } from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../types.js';
import type {
  ScrollbackPagerState,
  ScrollbackPagerStore,
  ScrollbackRow,
  ScrollbackViewportReporter,
} from '../stores/turn/scrollbackPager.js';
import type { RowIdentity } from '../utils/rowIdentity.js';

const { waitFor } = await import('../../test-utils/render.js');
const { render } = await import('ink-testing-library');
const { createScrollbackPagerStore } = await import(
  '../stores/turn/scrollbackPager.js'
);
const { pendingRowIdentity } = await import('../utils/rowIdentity.js');
const { ScrollbackViewport } = await import('./ScrollbackViewport.js');

type InkView = ReturnType<typeof render>;

const PAGE_UP = '\u001B[5~';
const PAGE_DOWN = '\u001B[6~';
const UP_ARROW = '\u001B[A';
const DOWN_ARROW = '\u001B[B';
const HOME_KEY = '\u001B[H';
const END_KEY = '\u001B[F';

/** Separator rendered above pending live-tail slots (addendum gap 6). */
const PENDING_SEPARATOR = '··· pending ···';

const TS = '2026-01-01T00:00:00.000Z';
const ROW_PAD = 'x'.repeat(60);

function rowLabel(seq: number): string {
  return `u-${String(seq).padStart(2, '0')}`;
}

const chronology = (seq: number) => ({
  seq,
  userTurn: 1,
  step: 1,
  recordedAt: 0,
});

function userContent(text: string, seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: chronology(seq) },
  };
}

function envelope(seq: number, type: string, payload: unknown): string {
  return JSON.stringify({ v: 1, seq, ts: TS, type, payload });
}

interface Fixture {
  filePath: string;
  addUser(seq: number): Promise<number>;
}

async function useJournalFixture(): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrollback-viewport-'));
  const filePath = path.join(dir, 'session-under-test.jsonl');
  let offset = 0;
  return {
    filePath,
    async addUser(seq: number): Promise<number> {
      const at = offset;
      const line = envelope(seq, 'content', {
        content: userContent(`${rowLabel(seq)}${ROW_PAD}`, seq),
      });
      await fs.appendFile(filePath, `${line}\n`, 'utf8');
      offset += Buffer.byteLength(line, 'utf8') + 1;
      return at;
    },
  };
}

interface ViewOptions {
  readonly viewportLines?: number;
  readonly pollMs?: number;
  readonly onPageUp?: () => void;
  readonly onPageDown?: () => void;
  readonly onScrollUp?: () => void;
  readonly onScrollDown?: () => void;
}

function makeReporter(): ScrollbackViewportReporter {
  return { visibleKeys: [], viewportLines: 0, rowHeightLines: () => 1 };
}

let scriptedItemId = 0;

function scriptedRow(key: string, text: string): ScrollbackRow {
  scriptedItemId += 1;
  const identity: RowIdentity = pendingRowIdentity(`scripted:${key}`);
  const item: HistoryItem = { id: scriptedItemId, type: 'user', text };
  return { key, seq: null, identity, offset: null, item };
}

/**
 * Mutable view of ScrollbackPagerState for scripted stores: the viewport has
 * no subscription API and polls the store, so the loading test flips the
 * flag on the shared state object in place; the store type's fields are
 * readonly (TS2540 on the direct return type).
 */
type MutableScrollbackPagerState = {
  -readonly [K in keyof ScrollbackPagerState]: ScrollbackPagerState[K];
};

function scriptedState(
  rows: readonly ScrollbackRow[],
  overrides: Partial<ScrollbackPagerState> = {},
): MutableScrollbackPagerState {
  return {
    rows: [...rows],
    loadingOlder: false,
    atVisibilityFloor: false,
    atFileEnd: true,
    generation: 0,
    error: null,
    ...overrides,
  };
}

function scriptedStore(config: {
  state: ScrollbackPagerState;
  onReportViewport?: () => void;
}): ScrollbackPagerStore {
  const state = config.state;
  return {
    getState: () => state,
    pageBack: () => new Promise<void>(() => undefined),
    pageForward: () => Promise.resolve(),
    invalidate: () => Promise.resolve(),
    reportViewport: () => config.onReportViewport?.(),
    pageOut: () => undefined,
    setContextWindow: () => undefined,
    setLiveTail: () => undefined,
    commitPendingRow: () => false,
    metrics: () => ({ residentRows: state.rows.length, residentBytes: 0 }),
    close: () => Promise.resolve(),
  };
}

describe('ScrollbackViewport @plan:PLAN-20260917-ISSUE854.P02d @requirement:G1,G2', () => {
  let fixture: Fixture;
  let stores: ScrollbackPagerStore[];

  beforeEach(async () => {
    fixture = await useJournalFixture();
    stores = [];
  });

  afterEach(async () => {
    for (const store of stores.splice(0)) {
      await store.close().catch(() => undefined);
    }
    await fs.rm(path.dirname(fixture.filePath), {
      recursive: true,
      force: true,
    });
  });

  function makeStore(
    reporter: ScrollbackViewportReporter,
    overrides: Partial<Parameters<typeof createScrollbackPagerStore>[0]> = {},
  ): ScrollbackPagerStore {
    const store = createScrollbackPagerStore({
      filePath: fixture.filePath,
      viewport: reporter,
      pageRows: 4,
      settings: {
        marginViewports: 2,
        byteFloorBytes: Number.POSITIVE_INFINITY,
        purgeDebounceMs: 1500,
      },
      ...overrides,
    });
    stores.push(store);
    return store;
  }

  async function mountViewport(
    store: ScrollbackPagerStore,
    reporter: ScrollbackViewportReporter,
    options: ViewOptions = {},
  ): Promise<InkView> {
    let view: InkView | undefined;
    await act(async () => {
      view = render(
        <ScrollbackViewport
          store={store}
          viewport={reporter}
          viewportLines={options.viewportLines ?? 6}
          pollMs={options.pollMs ?? 10}
          onPageUp={options.onPageUp}
          onPageDown={options.onPageDown}
          onScrollUp={options.onScrollUp}
          onScrollDown={options.onScrollDown}
        />,
      );
    });
    if (view === undefined) throw new Error('Ink render produced no view');
    return view;
  }

  async function fillFromDisk(store: ScrollbackPagerStore): Promise<void> {
    await act(async () => {
      void store.pageBack();
    });
  }

  function sendKey(view: InkView, sequence: string): void {
    act(() => {
      view.stdin.write(sequence);
    });
  }

  async function waitForResident(
    store: ScrollbackPagerStore,
    min: number,
  ): Promise<void> {
    await waitFor(() => {
      expect(store.metrics().residentRows).toBeGreaterThanOrEqual(min);
    });
  }

  /** Row-marker labels in the frame: fixture rows render one line each. */
  function markerLabels(frame: string): string[] {
    const labels: string[] = [];
    for (const line of frame.split('\n')) {
      const match = line.match(/u-\d{2}/);
      if (match !== null) labels.push(match[0]);
    }
    return labels;
  }

  function assertNoDuplicateLabels(frame: string): void {
    const labels = markerLabels(frame);
    expect(new Set(labels).size).toBe(labels.length);
  }

  function seqKey(store: ScrollbackPagerStore, seq: number): string {
    const key = store.getState().rows.find((row) => row.seq === seq)?.key;
    if (key === undefined) throw new Error(`no resident row for seq ${seq}`);
    return key;
  }

  it('renders resident rows once each and stays duplicate-free across a page cycle', async () => {
    for (let seq = 1; seq <= 12; seq += 1) await fixture.addUser(seq);
    const reporter = makeReporter();
    const store = makeStore(reporter);
    const view = await mountViewport(store, reporter);
    try {
      await fillFromDisk(store);
      await waitFor(() => {
        expect(view.lastFrame()).toContain(rowLabel(12));
      });
      const initial = markerLabels(view.lastFrame() ?? '');
      expect(initial).toContain(rowLabel(9));
      expect(new Set(initial).size).toBe(initial.length);

      const before = new Set(initial);
      sendKey(view, PAGE_UP);
      await waitForResident(store, 8);
      await waitFor(() => {
        const after = markerLabels(view.lastFrame() ?? '');
        expect(after.some((label) => !before.has(label))).toBe(true);
      });
      expect(markerLabels(view.lastFrame() ?? '').length).toBeLessThanOrEqual(
        6,
      );
      assertNoDuplicateLabels(view.lastFrame() ?? '');

      sendKey(view, PAGE_DOWN);
      await waitFor(() => {
        expect(markerLabels(view.lastFrame() ?? '').length).toBeGreaterThan(0);
      });
      assertNoDuplicateLabels(view.lastFrame() ?? '');
    } finally {
      view.unmount();
    }
  });

  it('keeps reported visible rows resident across a pageOut purge', async () => {
    for (let seq = 1; seq <= 12; seq += 1) await fixture.addUser(seq);
    const reporter = makeReporter();
    const store = makeStore(reporter, {
      settings: {
        marginViewports: 0,
        byteFloorBytes: Number.POSITIVE_INFINITY,
        purgeDebounceMs: 25,
      },
    });
    const view = await mountViewport(store, reporter);
    try {
      await fillFromDisk(store);
      await waitFor(() => {
        expect(view.lastFrame()).toContain(rowLabel(12));
      });

      sendKey(view, PAGE_UP);
      await waitForResident(store, 8);
      sendKey(view, PAGE_UP);
      await waitFor(() => {
        expect(store.metrics().residentRows).toBe(12);
      });

      const newestKey = seqKey(store, 12);
      await waitFor(() => {
        expect(reporter.visibleKeys.length).toBeGreaterThan(0);
        expect(reporter.visibleKeys).not.toContain(newestKey);
      });
      const visibleBefore = [...reporter.visibleKeys];

      store.pageOut('older');
      await waitFor(() => {
        const keys = store.getState().rows.map((row) => row.key);
        for (const key of visibleBefore) expect(keys).toContain(key);
        expect(keys).toContain(newestKey);
      });
    } finally {
      view.unmount();
    }
  });

  it('pages older rows in on page-up and fires onPageUp', async () => {
    for (let seq = 1; seq <= 12; seq += 1) await fixture.addUser(seq);
    const reporter = makeReporter();
    const store = makeStore(reporter);
    const onPageUp = vi.fn();
    const view = await mountViewport(store, reporter, { onPageUp });
    try {
      await fillFromDisk(store);
      await waitFor(() => {
        expect(view.lastFrame()).toContain(rowLabel(12));
      });

      const before = new Set(markerLabels(view.lastFrame() ?? ''));
      sendKey(view, PAGE_UP);
      expect(onPageUp).toHaveBeenCalledTimes(1);
      await waitForResident(store, 8);
      await waitFor(() => {
        const after = markerLabels(view.lastFrame() ?? '');
        expect(after.some((label) => !before.has(label))).toBe(true);
      });
    } finally {
      view.unmount();
    }
  });

  it('fires onPageDown on page-down input and returns the window toward newer rows', async () => {
    for (let seq = 1; seq <= 12; seq += 1) await fixture.addUser(seq);
    const reporter = makeReporter();
    const store = makeStore(reporter);
    const onPageDown = vi.fn();
    const view = await mountViewport(store, reporter, { onPageDown });
    try {
      await fillFromDisk(store);
      await waitFor(() => {
        expect(view.lastFrame()).toContain(rowLabel(12));
      });

      sendKey(view, PAGE_UP);
      await waitForResident(store, 8);
      const scrolledUp = new Set(markerLabels(view.lastFrame() ?? ''));

      sendKey(view, PAGE_DOWN);
      expect(onPageDown).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        const after = markerLabels(view.lastFrame() ?? '');
        expect(after.some((label) => !scrolledUp.has(label))).toBe(true);
      });
    } finally {
      view.unmount();
    }
  });

  it('shows the loading placeholder while pageBack is in flight and clears it after', async () => {
    const state = scriptedState(
      [scriptedRow('k1', 's-01'), scriptedRow('k2', 's-02')],
      { loadingOlder: true, atFileEnd: false },
    );
    const store = scriptedStore({ state });
    const reporter = makeReporter();
    const view = await mountViewport(store, reporter);
    try {
      await waitFor(() => {
        expect(view.lastFrame()).toContain('loading older…');
      });
      state.loadingOlder = false;
      await waitFor(() => {
        expect(view.lastFrame() ?? '').not.toContain('loading older…');
      });
      expect(view.lastFrame()).toContain('s-01');
    } finally {
      view.unmount();
    }
  });

  it('shows the visibility-floor notice only at the floor', async () => {
    await fixture.addUser(1);
    await fixture.addUser(2);
    const reporter = makeReporter();
    const store = makeStore(reporter);
    const view = await mountViewport(store, reporter);
    try {
      expect(view.lastFrame() ?? '').not.toContain('history above was cleared');
      await fillFromDisk(store);
      await waitFor(() => {
        expect(view.lastFrame()).toContain('history above was cleared');
      });
      expect(store.getState().atVisibilityFloor).toBe(true);
    } finally {
      view.unmount();
    }
  });

  it('clamps at the bottom of the journal and shows the below-placeholder when scrolled up', async () => {
    for (let seq = 1; seq <= 12; seq += 1) await fixture.addUser(seq);
    const reporter = makeReporter();
    const store = makeStore(reporter);
    const view = await mountViewport(store, reporter);
    try {
      await fillFromDisk(store);
      await waitFor(() => {
        expect(view.lastFrame()).toContain(rowLabel(12));
      });
      expect(view.lastFrame() ?? '').not.toContain('more below');

      sendKey(view, PAGE_UP);
      await waitFor(() => {
        expect(view.lastFrame()).toContain('more below');
      });
      expect(view.lastFrame() ?? '').not.toContain('history above was cleared');
    } finally {
      view.unmount();
    }
  });

  it('census: rendered rows stay bounded by the window across repeated page cycles', async () => {
    for (let seq = 1; seq <= 40; seq += 1) await fixture.addUser(seq);
    const reporter = makeReporter();
    const store = makeStore(reporter);
    const view = await mountViewport(store, reporter, { viewportLines: 6 });
    try {
      await fillFromDisk(store);
      await waitFor(() => {
        expect(view.lastFrame()).toContain(rowLabel(40));
      });

      let maxMarkerRows = markerLabels(view.lastFrame() ?? '').length;
      for (let cycle = 1; cycle <= 5; cycle += 1) {
        sendKey(view, PAGE_UP);
        await waitForResident(store, 4 * (cycle + 1));
        const frame = view.lastFrame() ?? '';
        maxMarkerRows = Math.max(maxMarkerRows, markerLabels(frame).length);
        assertNoDuplicateLabels(frame);
      }

      expect(maxMarkerRows).toBeGreaterThanOrEqual(4);
      expect(maxMarkerRows).toBeLessThanOrEqual(9);
      expect(store.metrics().residentRows).toBeGreaterThanOrEqual(20);
    } finally {
      view.unmount();
    }
  });

  it('feeds viewport metrics to the reporter and re-reports on stdout resize', async () => {
    const state = scriptedState([
      scriptedRow('k1', 's-01'),
      scriptedRow('k2', 's-02'),
    ]);
    let reports = 0;
    const store = scriptedStore({
      state,
      onReportViewport: () => {
        reports += 1;
      },
    });
    const reporter = makeReporter();
    const view = await mountViewport(store, reporter, { pollMs: 60_000 });
    try {
      expect(reporter.viewportLines).toBe(6);
      expect(reporter.rowHeightLines()).toBe(1);
      await waitFor(() => {
        expect(reports).toBeGreaterThan(0);
      });
      expect([...reporter.visibleKeys]).toStrictEqual(['k1', 'k2']);

      const reportsAfterMount = reports;
      act(() => {
        view.stdout.emit('resize');
      });
      await waitFor(() => {
        expect(reports).toBeGreaterThan(reportsAfterMount);
      });
    } finally {
      view.unmount();
    }
  });

  describe('addendum @plan:PLAN-20260917-ISSUE854.P02d: Home/End, wheel path, error row, expand anchor, pending tail', () => {
    function labelRange(from: number, to: number): string[] {
      const labels: string[] = [];
      for (let seq = from; seq <= to; seq += 1) labels.push(rowLabel(seq));
      return labels;
    }

    it('Home jumps the window to the oldest resident edge and issues pageBack', async () => {
      for (let seq = 1; seq <= 60; seq += 1) await fixture.addUser(seq);
      const reporter = makeReporter();
      const store = makeStore(reporter, { pageRows: 20 });
      const view = await mountViewport(store, reporter);
      try {
        await fillFromDisk(store);
        await waitForResident(store, 20);
        sendKey(view, PAGE_UP);
        await waitForResident(store, 40);
        await waitFor(() => {
          expect(markerLabels(view.lastFrame() ?? '')).toStrictEqual(
            labelRange(49, 54),
          );
        });
        expect(store.getState().atVisibilityFloor).toBe(false);

        sendKey(view, HOME_KEY);
        await waitFor(() => {
          expect(store.getState().atVisibilityFloor).toBe(true);
          expect(markerLabels(view.lastFrame() ?? '')).toStrictEqual(
            labelRange(21, 26),
          );
        });
        assertNoDuplicateLabels(view.lastFrame() ?? '');
      } finally {
        view.unmount();
      }
    });

    it('End jumps the window to the newest edge and pages forward when not at file end', async () => {
      for (let seq = 1; seq <= 60; seq += 1) await fixture.addUser(seq);
      const reporter = makeReporter();
      const store = makeStore(reporter, { pageRows: 20 });
      const view = await mountViewport(store, reporter);
      try {
        await fillFromDisk(store);
        await waitForResident(store, 20);
        sendKey(view, PAGE_UP);
        await waitForResident(store, 40);
        await waitFor(() => {
          expect(markerLabels(view.lastFrame() ?? '')).toStrictEqual(
            labelRange(49, 54),
          );
        });
        // The journal is append-only and a concurrent writer appends while
        // the window is scrolled up. The next pageBack observes the longer
        // file: the forward head now lags EOF, which is the store's
        // not-at-file-end state, and End's pageForward consumes the appends.
        for (let seq = 61; seq <= 80; seq += 1) await fixture.addUser(seq);
        sendKey(view, PAGE_UP);
        await waitForResident(store, 60);
        await waitFor(() => {
          expect(store.getState().atFileEnd).toBe(false);
        });

        sendKey(view, END_KEY);
        await waitFor(() => {
          expect(store.metrics().residentRows).toBe(80);
          expect(markerLabels(view.lastFrame() ?? '')).toStrictEqual(
            labelRange(75, 80),
          );
        });
        assertNoDuplicateLabels(view.lastFrame() ?? '');
      } finally {
        view.unmount();
      }
    });

    it('arrow keys drive the direction-paged wheel path via onScrollUp/onScrollDown', async () => {
      for (let seq = 1; seq <= 12; seq += 1) await fixture.addUser(seq);
      const reporter = makeReporter();
      const store = makeStore(reporter);
      const onScrollUp = vi.fn();
      const onScrollDown = vi.fn();
      const view = await mountViewport(store, reporter, {
        onScrollUp,
        onScrollDown,
      });
      try {
        await fillFromDisk(store);
        await waitFor(() => {
          expect(markerLabels(view.lastFrame() ?? '')).toStrictEqual(
            labelRange(9, 12),
          );
        });

        sendKey(view, UP_ARROW);
        expect(onScrollUp).toHaveBeenCalledTimes(1);
        await waitForResident(store, 8);
        await waitFor(() => {
          expect(markerLabels(view.lastFrame() ?? '')).toStrictEqual(
            labelRange(6, 11),
          );
        });

        sendKey(view, DOWN_ARROW);
        expect(onScrollDown).toHaveBeenCalledTimes(1);
        await waitFor(() => {
          expect(markerLabels(view.lastFrame() ?? '')).toStrictEqual(
            labelRange(7, 12),
          );
        });
      } finally {
        view.unmount();
      }
    });

    it('renders a one-line error row in place of the top edge while the store has an error', async () => {
      const rows: ScrollbackRow[] = [];
      for (let i = 1; i <= 8; i += 1) {
        rows.push(scriptedRow(`k${i}`, `s-${String(i).padStart(2, '0')}`));
      }
      const errorState = scriptedState(rows, { error: 'disk offline' });
      const errorStore = scriptedStore({ state: errorState });
      const errorReporter = makeReporter();
      const errorView = await mountViewport(errorStore, errorReporter);
      try {
        await waitFor(() => {
          expect(errorView.lastFrame()).toContain(
            'scrollback unavailable: disk offline',
          );
        });
        expect((errorView.lastFrame() ?? '').split('\n')).not.toContain('…');
        expect(errorView.lastFrame()).toContain('s-08');
      } finally {
        errorView.unmount();
      }

      const okStore = scriptedStore({ state: scriptedState(rows) });
      const okReporter = makeReporter();
      const okView = await mountViewport(okStore, okReporter);
      try {
        await waitFor(() => {
          expect(okView.lastFrame()).toContain('…');
        });
        expect(okView.lastFrame() ?? '').not.toContain(
          'scrollback unavailable',
        );
      } finally {
        okView.unmount();
      }
    });

    it('keeps the anchor row as the first window line when rowHeightLines expands', async () => {
      for (let seq = 1; seq <= 12; seq += 1) await fixture.addUser(seq);
      const reporter = makeReporter();
      const store = makeStore(reporter);
      const view = await mountViewport(store, reporter);
      try {
        await fillFromDisk(store);
        sendKey(view, UP_ARROW);
        await waitForResident(store, 8);
        sendKey(view, UP_ARROW);
        await waitForResident(store, 12);
        sendKey(view, UP_ARROW);
        await waitFor(() => {
          expect(markerLabels(view.lastFrame() ?? '')).toStrictEqual(
            labelRange(4, 9),
          );
        });

        reporter.rowHeightLines = () => 3;
        act(() => {
          view.stdout.emit('resize');
        });
        await waitFor(() => {
          expect(markerLabels(view.lastFrame() ?? '')).toStrictEqual([
            rowLabel(4),
            rowLabel(5),
          ]);
        });
        expect([...reporter.visibleKeys]).toStrictEqual([
          seqKey(store, 4),
          seqKey(store, 5),
        ]);
      } finally {
        view.unmount();
      }

      const bottomReporter = makeReporter();
      const bottomStore = makeStore(bottomReporter);
      const bottomView = await mountViewport(bottomStore, bottomReporter);
      try {
        await fillFromDisk(bottomStore);
        await waitFor(() => {
          expect(markerLabels(bottomView.lastFrame() ?? '')).toStrictEqual(
            labelRange(9, 12),
          );
        });
        bottomReporter.rowHeightLines = () => 3;
        act(() => {
          bottomView.stdout.emit('resize');
        });
        await waitFor(() => {
          expect(markerLabels(bottomView.lastFrame() ?? '')).toStrictEqual([
            rowLabel(11),
            rowLabel(12),
          ]);
        });
      } finally {
        bottomView.unmount();
      }
    });

    it('equal-length pageBack slides the window with no duplicate or missing markers', async () => {
      for (let seq = 1; seq <= 12; seq += 1) await fixture.addUser(seq);
      const reporter = makeReporter();
      const store = makeStore(reporter, { pageRows: 6 });
      const view = await mountViewport(store, reporter);
      try {
        await fillFromDisk(store);
        await waitForResident(store, 6);
        await waitFor(() => {
          expect(markerLabels(view.lastFrame() ?? '')).toStrictEqual(
            labelRange(7, 12),
          );
        });
        const before = markerLabels(view.lastFrame() ?? '');

        sendKey(view, PAGE_UP);
        await waitForResident(store, 12);
        await waitFor(() => {
          expect(markerLabels(view.lastFrame() ?? '')).toStrictEqual(
            labelRange(1, 6),
          );
        });
        const after = markerLabels(view.lastFrame() ?? '');

        expect(before).toStrictEqual(labelRange(7, 12));
        expect(after).toStrictEqual(labelRange(1, 6));
        expect(new Set([...before, ...after]).size).toBe(12);
        expect([...before, ...after].sort()).toStrictEqual(labelRange(1, 12));
      } finally {
        view.unmount();
      }
    });

    it('renders pending live-tail rows as slots below the window while scrolled away', async () => {
      for (let seq = 1; seq <= 12; seq += 1) await fixture.addUser(seq);
      const reporter = makeReporter();
      const store = makeStore(reporter);
      const view = await mountViewport(store, reporter);
      try {
        await fillFromDisk(store);
        await waitFor(() => {
          expect(view.lastFrame()).toContain(rowLabel(12));
        });
        store.setLiveTail([
          {
            id: 424242,
            type: 'user',
            text: 'p-01',
            rowIdentity: pendingRowIdentity('live:p-01'),
          },
        ]);
        await waitFor(() => {
          expect(view.lastFrame()).toContain('p-01');
        });
        expect(view.lastFrame() ?? '').not.toContain(PENDING_SEPARATOR);

        sendKey(view, PAGE_UP);
        await waitForResident(store, 8);
        await waitFor(() => {
          expect(view.lastFrame()).toContain(PENDING_SEPARATOR);
        });
        expect(view.lastFrame()).toContain('p-01');
        expect(markerLabels(view.lastFrame() ?? '')).toStrictEqual(
          labelRange(5, 10),
        );
        expect(view.lastFrame() ?? '').not.toContain(rowLabel(11));
        expect(view.lastFrame() ?? '').not.toContain(rowLabel(12));

        sendKey(view, PAGE_DOWN);
        await waitFor(() => {
          const frame = view.lastFrame() ?? '';
          expect(frame).toContain('p-01');
          expect(frame).not.toContain(PENDING_SEPARATOR);
        });
      } finally {
        view.unmount();
      }
    });
  });
});
