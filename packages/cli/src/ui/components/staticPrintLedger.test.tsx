/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P04
 * @requirement G5,G6
 *
 * Behavioral tests for the primary-buffer print-through protocol
 * (issue-854-design.md §5d rev 3): an append-only batch ledger hands rows to
 * a real Ink `<Static>`, which tracks a printed COUNT and slices from it — a
 * same-length array after prefix removal would SKIP rows. The protocol
 * therefore never mutates or prefix-trims a handed array, never rotates it,
 * drops only our own references on eviction, resets Ink's count solely by
 * remounting a fresh `<Static>` element (post-clear), and acknowledges a
 * batch only when the render pass that appended it completes. A pass that
 * throws mid-batch acknowledges nothing; recovery prints the pending suffix
 * exactly once without reprinting acknowledged rows.
 *
 * Rendering goes through real Ink: 'ink' is redirected to the real Ink build
 * while ink-testing-library renders into fake streams, matching
 * ScrollbackViewport.test.tsx. Assertions are on printed bytes, not ledger
 * counts: in Ink's debug mode every frame write carries the full static
 * archive, so the last frame after a flush is the complete printed stream and
 * each row's label must occur in it exactly once.
 *
 * The ledger consumes the pager store's resident rows through its adapter
 * surface: rows enter via append() ({key: rowIdentityKey, item: HistoryItem}
 * straight from ScrollbackPagerState.rows) and pager eviction is reported via
 * forgetEvicted() with the store's current resident keys.
 */

import { act, type ReactNode } from 'react';
import { describe, expect, it, vi, afterEach, beforeEach } from 'bun:test';
await import('ink-testing-library');
const ink = await import('../../../test-utils/real-ink.js');
void vi.mock('ink', () => ink);
import type { HistoryItem } from '../types.js';
import type {
  StaticPrintBatch,
  StaticPrintLedger,
  StaticPrintRow,
} from '../print/staticPrintLedger.js';

const { Text, Colors } = ink;
const { waitFor } = await import('../../test-utils/render.js');
const { render } = await import('ink-testing-library');
const { createStaticPrintLedger, StaticPrintProtocol, REMOUNT_NOTICE_KEY } =
  await import('../print/staticPrintLedger.js');

type InkView = ReturnType<typeof render>;

let itemId = 0;

function textRow(key: string, label: string): StaticPrintRow {
  itemId += 1;
  const item: HistoryItem = { id: itemId, type: 'user', text: label };
  return { key, item };
}

function rowLabel(n: number): string {
  return `row-${String(n).padStart(2, '0')}`;
}

function labelRange(from: number, to: number): string[] {
  const labels: string[] = [];
  for (let n = from; n <= to; n += 1) labels.push(rowLabel(n));
  return labels;
}

function fourLabels(batch: number): [string, string, string, string] {
  const start = (batch - 1) * 4;
  return [
    rowLabel(start + 1),
    rowLabel(start + 2),
    rowLabel(start + 3),
    rowLabel(start + 4),
  ];
}

/** Occurrence count of `needle` in the printed byte stream. */
function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

describe('staticPrintLedger @plan:PLAN-20260917-ISSUE854.P04 @requirement:G5,G6', () => {
  const views: InkView[] = [];

  afterEach(() => {
    for (const view of views.splice(0)) {
      view.unmount();
    }
  });

  const plainRenderRow = (row: StaticPrintRow): ReactNode => (
    <Text key={row.key} color={Colors.Foreground}>
      {row.item.text}
    </Text>
  );

  async function mountProtocol(
    ledger: StaticPrintLedger,
    renderRow: (row: StaticPrintRow) => ReactNode,
  ): Promise<InkView> {
    let view: InkView | undefined;
    await act(async () => {
      view = render(
        <StaticPrintProtocol ledger={ledger} renderRow={renderRow} />,
      );
    });
    if (view === undefined) throw new Error('Ink render produced no view');
    views.push(view);
    return view;
  }

  function appendBatch(
    ledger: StaticPrintLedger,
    labels: readonly string[],
  ): StaticPrintBatch {
    let batch: StaticPrintBatch | undefined;
    act(() => {
      batch = ledger.append(labels.map((label) => textRow(label, label)));
    });
    if (batch === undefined) throw new Error('append produced no batch');
    return batch;
  }

  async function waitForAcknowledged(batch: StaticPrintBatch): Promise<void> {
    await waitFor(() => {
      expect(batch.status()).toBe('acknowledged');
    });
  }

  /** Waits until the printed stream contains `needle`, then returns it. */
  async function waitForFrame(view: InkView, needle: string): Promise<string> {
    await waitFor(() => {
      expect(view.lastFrame() ?? '').toContain(needle);
    });
    return view.lastFrame() ?? '';
  }

  describe('append-only invariant', () => {
    it('appending after a batch was handed out concatenates and never touches previous items', () => {
      const ledger = createStaticPrintLedger();
      const first = ledger.append([
        textRow('k1', rowLabel(1)),
        textRow('k2', rowLabel(2)),
      ]);
      expect(first.status()).toBe('pending');
      const handedOut = ledger.items();
      expect(handedOut.map((row) => row.key)).toStrictEqual(['k1', 'k2']);

      ledger.append([textRow('k3', rowLabel(3))]);
      const grown = ledger.items();

      expect(grown).toHaveLength(3);
      // Every previously handed index still holds the same row object: the
      // array Static slices from is extended, never rewritten.
      expect(grown[0]).toBe(handedOut[0]);
      expect(grown[1]).toBe(handedOut[1]);
      expect(grown[2]?.key).toBe('k3');
      // The earlier array reference itself is unchanged.
      expect(handedOut).toHaveLength(2);
      expect(handedOut.map((row) => row.key)).toStrictEqual(['k1', 'k2']);
      expect(first.status()).toBe('pending');
    });

    it('the API cannot express prefix-trimming and re-appending a printed row throws', () => {
      const ledger = createStaticPrintLedger();
      ledger.append([textRow('k1', rowLabel(1)), textRow('k2', rowLabel(2))]);

      // Compile-time pin (§5d rev 3: never prefix-trimmed): if the ledger
      // ever grows a trim surface, this ceases to be never and the file
      // stops compiling.
      type TrimProbe = Extract<
        'trimPrinted' | 'dropPrintedPrefix' | 'spliceItems',
        keyof StaticPrintLedger
      >;
      type AssertNever<T> = [T] extends [never] ? true : never;
      const noTrimSurface: AssertNever<TrimProbe> = true;
      expect(noTrimSurface).toBe(true);

      // Eviction reports cannot reshape the handed array either.
      const before = ledger.items();
      ledger.forgetEvicted(['k1']);
      expect(ledger.items()[0]).toBe(before[0]);
      expect(ledger.items()[1]).toBe(before[1]);

      // The only batch-shaping call is append, which only grows: a printed
      // key cannot re-enter the array (it would print twice).
      expect(() => ledger.append([textRow('k1', rowLabel(1))])).toThrow(Error);
    });
  });

  describe('exactly-once across eviction', () => {
    it('append, evict, then an equal-length batch: every row prints exactly once', async () => {
      const ledger = createStaticPrintLedger();
      const view = await mountProtocol(ledger, plainRenderRow);

      appendBatch(ledger, [rowLabel(1), rowLabel(2)]);
      await waitForFrame(view, rowLabel(2));

      // The pager evicted row-01; only our reference drops. The handed
      // array keeps both rows so Ink's printed count stays valid.
      ledger.forgetEvicted([rowLabel(2)]);
      expect(ledger.items()).toHaveLength(2);
      expect(occurrences(view.lastFrame() ?? '', rowLabel(1))).toBe(1);

      // Same length as the first batch — the exact shape that makes a
      // prefix-trimming ledger silently SKIP rows in Ink's Static.
      appendBatch(ledger, [rowLabel(3), rowLabel(4)]);
      const frame = await waitForFrame(view, rowLabel(4));

      for (const label of [
        rowLabel(1),
        rowLabel(2),
        rowLabel(3),
        rowLabel(4),
      ]) {
        expect(occurrences(frame, label)).toBe(1);
      }
    });
  });

  describe('acknowledgement is the render pass', () => {
    it('a batch is pending until the render pass that appended it completes', async () => {
      const ledger = createStaticPrintLedger();
      const preMount = ledger.append([textRow('k1', rowLabel(1))]);
      expect(preMount.status()).toBe('pending');

      const view = await mountProtocol(ledger, plainRenderRow);
      await waitForAcknowledged(preMount);
      await waitForFrame(view, rowLabel(1));

      let postMount: StaticPrintBatch | undefined;
      let pendingAtAppend = false;
      await act(async () => {
        const batch = ledger.append([textRow('k2', rowLabel(2))]);
        postMount = batch;
        pendingAtAppend = batch.status() === 'pending';
      });
      expect(pendingAtAppend).toBe(true);
      if (postMount === undefined) throw new Error('append produced no batch');
      await waitForAcknowledged(postMount);
    });

    it('batches appended within one render pass acknowledge together after that pass', async () => {
      const ledger = createStaticPrintLedger();
      const view = await mountProtocol(ledger, plainRenderRow);

      let first: StaticPrintBatch | undefined;
      let second: StaticPrintBatch | undefined;
      let bothPendingAtAppend = false;
      await act(async () => {
        const a = ledger.append([textRow('k1', rowLabel(1))]);
        const b = ledger.append([textRow('k2', rowLabel(2))]);
        first = a;
        second = b;
        bothPendingAtAppend =
          a.status() === 'pending' && b.status() === 'pending';
      });
      expect(bothPendingAtAppend).toBe(true);
      if (first === undefined || second === undefined) {
        throw new Error('append produced no batch');
      }
      await waitForAcknowledged(first);
      await waitForAcknowledged(second);
      await waitForFrame(view, rowLabel(2));
    });
  });

  describe('no batch rotation', () => {
    it('a long session of appends grows the handed array monotonically', () => {
      const ledger = createStaticPrintLedger();
      ledger.append(labelRange(1, 6).map((label) => textRow(label, label)));
      const baseline = ledger.items().slice();

      for (let batch = 2; batch <= 6; batch += 1) {
        const start = (batch - 1) * 6;
        ledger.append(
          labelRange(start + 1, start + 6).map((label) =>
            textRow(label, label),
          ),
        );
        const items = ledger.items();
        expect(items).toHaveLength(batch * 6);
        for (let i = 0; i < baseline.length; i += 1) {
          expect(items[i]).toBe(baseline[i]);
        }
      }
      expect(ledger.items()).toHaveLength(36);
    });

    it('repeated batches through real Ink print each row once and the printed stream only grows', async () => {
      const ledger = createStaticPrintLedger();
      const view = await mountProtocol(ledger, plainRenderRow);

      for (let batch = 1; batch <= 8; batch += 1) {
        const labels = fourLabels(batch);
        appendBatch(ledger, labels);
        const frame = await waitForFrame(view, labels[3]);
        for (let n = 1; n <= batch * 4; n += 1) {
          expect(occurrences(frame, rowLabel(n))).toBe(1);
        }
      }
    });
  });

  describe('remount after clear', () => {
    it('clear() stages resident rows behind a one-line notice on a fresh epoch', () => {
      const ledger = createStaticPrintLedger();
      ledger.append([textRow('k1', rowLabel(1)), textRow('k2', rowLabel(2))]);
      const epochBefore = ledger.epoch();

      ledger.clear([textRow('k3', rowLabel(3))]);

      expect(ledger.epoch()).toBe(epochBefore + 1);
      const items = ledger.items();
      expect(items).toHaveLength(2);
      expect(items[0]?.key).toBe(REMOUNT_NOTICE_KEY);
      const noticeText = items[0]?.item.text ?? '';
      expect(noticeText.length).toBeGreaterThan(0);
      expect(noticeText.includes('\n')).toBe(false);
      expect(items[1]?.key).toBe('k3');
    });

    it('the post-clear remount prints notice plus residents and never reprints pre-clear rows', async () => {
      const ledger = createStaticPrintLedger();
      const view = await mountProtocol(ledger, plainRenderRow);

      appendBatch(ledger, [rowLabel(1), rowLabel(2)]);
      const before = await waitForFrame(view, rowLabel(2));
      expect(occurrences(before, rowLabel(1))).toBe(1);

      let noticeText = '';
      await act(async () => {
        ledger.clear([textRow('k3', rowLabel(3))]);
        noticeText = ledger.items()[0]?.item.text ?? '';
      });
      const after = await waitForFrame(view, rowLabel(3));

      expect(after).toContain(noticeText);
      expect(occurrences(after, noticeText)).toBe(1);
      // Pre-clear rows keep their single printed occurrence: the fresh
      // element restarted Ink's count at zero with only notice + residents.
      for (const label of [rowLabel(1), rowLabel(2), rowLabel(3)]) {
        expect(occurrences(after, label)).toBe(1);
      }
    });
  });

  describe('interrupted output', () => {
    let restoreConsole: (() => void) | undefined;

    beforeEach(() => {
      const spy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      restoreConsole = () => {
        spy.mockRestore();
      };
    });

    afterEach(() => {
      restoreConsole?.();
    });

    function throwingRenderRow(
      broken: ReadonlySet<string>,
    ): (row: StaticPrintRow) => ReactNode {
      return function renderRow(row: StaticPrintRow): ReactNode {
        if (broken.has(row.key)) {
          throw new Error(`row loader failed: ${row.key}`);
        }
        return (
          <Text key={row.key} color={Colors.Foreground}>
            {row.item.text}
          </Text>
        );
      };
    }

    it('a render pass that throws mid-batch leaves the batch pending and prints none of it', async () => {
      const ledger = createStaticPrintLedger();
      const broken = new Set<string>(['row-02']);
      const renderRow = throwingRenderRow(broken);
      const view = await mountProtocol(ledger, renderRow);

      appendBatch(ledger, [rowLabel(1)]);
      await waitForFrame(view, rowLabel(1));

      const failed = appendBatch(ledger, [rowLabel(2), rowLabel(3)]);

      // The failed pass settles (protocol survives on its fallback); the
      // batch stays pending and none of its rows reached the printed
      // stream, while the earlier acknowledged batch is still there.
      await act(async () => {
        view.rerender(
          <StaticPrintProtocol ledger={ledger} renderRow={renderRow} />,
        );
      });
      expect(failed.status()).toBe('pending');
      const frame = view.lastFrame() ?? '';
      expect(frame).toContain(rowLabel(1));
      expect(frame).not.toContain(rowLabel(2));
      expect(frame).not.toContain(rowLabel(3));
    });

    it('recovery prints the pending suffix exactly once and never reprints acknowledged rows', async () => {
      const ledger = createStaticPrintLedger();
      const broken = new Set<string>(['row-02']);
      const renderRow = throwingRenderRow(broken);
      const view = await mountProtocol(ledger, renderRow);

      appendBatch(ledger, [rowLabel(1)]);
      await waitForFrame(view, rowLabel(1));

      const failed = appendBatch(ledger, [rowLabel(2), rowLabel(3)]);
      expect(failed.status()).toBe('pending');

      broken.clear();
      const retried = appendBatch(ledger, [rowLabel(4)]);
      await waitForAcknowledged(failed);
      await waitForAcknowledged(retried);
      const frame = await waitForFrame(view, rowLabel(4));

      for (const label of [
        rowLabel(1),
        rowLabel(2),
        rowLabel(3),
        rowLabel(4),
      ]) {
        expect(occurrences(frame, label)).toBe(1);
      }
    });
  });
});
