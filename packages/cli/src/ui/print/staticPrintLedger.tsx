/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P04a
 * @requirement G5,G6
 *
 * Primary-buffer print-through protocol (issue-854-design.md §5d rev 3): an
 * append-only batch ledger hands rows to a real Ink `<Static>`, which tracks
 * a printed COUNT and slices `items` from it — a same-length array after
 * prefix removal would silently skip rows. The ledger therefore only ever
 * concatenates: eviction drops our own references without reshaping the
 * handed array, and Ink's count is reset solely by remounting a fresh
 * `<Static>` keyed by the ledger epoch after clear().
 *
 * A batch is acknowledged by the render pass that appended it. The pass
 * committer sits inside a module-private error boundary, so a pass that
 * throws mid-batch is discarded before any effect runs: the batch stays
 * pending and none of its rows reach the printed stream. Recovery remounts
 * `<Static>` fresh and hands it only the unprinted suffix (everything before
 * the crash was already printed), so pending rows print exactly once while
 * acknowledged rows never reprint.
 */

import {
  Component,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { Static } from 'ink';
import type { HistoryItem } from '../types.js';

/** A printable row: pager identity key plus the history item to render. */
export interface StaticPrintRow {
  key: string;
  item: HistoryItem;
}

/** Handle for one append; flips to acknowledged once its render pass commits. */
export type StaticPrintBatch = {
  status(): 'pending' | 'acknowledged';
};

export interface StaticPrintLedger {
  append(rows: readonly StaticPrintRow[]): StaticPrintBatch;
  items(): readonly StaticPrintRow[];
  forgetEvicted(keys: readonly string[]): void;
  clear(residentRows: readonly StaticPrintRow[]): void;
  epoch(): number;
}

export const REMOUNT_NOTICE_KEY = 'static-print-remount-notice';

const REMOUNT_NOTICE_TEXT = 'History cleared; committed output preserved above';

interface PendingBatchRecord {
  acknowledged: boolean;
}

interface LedgerInternals {
  rows: readonly StaticPrintRow[];
  appendedKeys: Set<string>;
  forgottenKeys: Set<string>;
  epochValue: number;
  pendingBatches: Set<PendingBatchRecord>;
  listeners: Set<() => void>;
}

const ledgerInternals = new WeakMap<StaticPrintLedger, LedgerInternals>();

function internalsOf(ledger: StaticPrintLedger): LedgerInternals {
  const internals = ledgerInternals.get(ledger);
  if (!internals) {
    throw new Error('Unknown static print ledger');
  }
  return internals;
}

function notifyListeners(internals: LedgerInternals): void {
  for (const listener of internals.listeners) {
    listener();
  }
}

/** Module-private: the protocol acknowledges every pending batch once its render pass commits. */
function acknowledgePending(ledger: StaticPrintLedger): void {
  const internals = internalsOf(ledger);
  for (const batch of internals.pendingBatches) {
    batch.acknowledged = true;
  }
  internals.pendingBatches.clear();
}

/** Module-private: the protocol re-renders when append/clear replaces the handed array. */
function subscribeLedger(
  ledger: StaticPrintLedger,
  onStoreChange: () => void,
): () => void {
  const internals = internalsOf(ledger);
  internals.listeners.add(onStoreChange);
  return () => {
    internals.listeners.delete(onStoreChange);
  };
}

let remountNoticeSeq = 0;

function createRemountNoticeRow(): StaticPrintRow {
  remountNoticeSeq += 1;
  const item: HistoryItem = {
    id: -remountNoticeSeq,
    type: 'info',
    text: REMOUNT_NOTICE_TEXT,
  };
  return { key: REMOUNT_NOTICE_KEY, item };
}

export function createStaticPrintLedger(): StaticPrintLedger {
  const internals: LedgerInternals = {
    rows: [],
    appendedKeys: new Set<string>(),
    forgottenKeys: new Set<string>(),
    epochValue: 0,
    pendingBatches: new Set<PendingBatchRecord>(),
    listeners: new Set<() => void>(),
  };

  const ledger: StaticPrintLedger = {
    append(rows) {
      for (const row of rows) {
        if (internals.appendedKeys.has(row.key)) {
          throw new Error(
            `Static print row key was already printed this epoch: ${row.key}`,
          );
        }
      }
      const batch: PendingBatchRecord = { acknowledged: false };
      // Concatenation only: previously handed arrays keep their length and
      // content, so Ink's printed count stays valid across evictions.
      internals.rows = [...internals.rows, ...rows];
      for (const row of rows) {
        internals.appendedKeys.add(row.key);
      }
      internals.pendingBatches.add(batch);
      notifyListeners(internals);
      return {
        status: () => (batch.acknowledged ? 'acknowledged' : 'pending'),
      };
    },
    items: () => internals.rows,
    forgetEvicted(keys) {
      // Eviction drops only our references; the handed array is untouched.
      for (const key of keys) {
        internals.forgottenKeys.add(key);
      }
    },
    clear(residentRows) {
      internals.epochValue += 1;
      internals.rows = [createRemountNoticeRow(), ...residentRows];
      internals.appendedKeys = new Set<string>([
        REMOUNT_NOTICE_KEY,
        ...residentRows.map((row) => row.key),
      ]);
      internals.forgottenKeys = new Set<string>();
      notifyListeners(internals);
    },
    epoch: () => internals.epochValue,
  };

  ledgerInternals.set(ledger, internals);
  return ledger;
}

interface ProtocolState {
  epoch: number;
  /** Items identity of the pass that threw; null while no crash is active. */
  crashedFor: readonly StaticPrintRow[] | null;
  /** Slice offset feeding the current `<Static>` instance. */
  printBase: number;
  /** Bumped whenever a fresh `<Static>` must mount (recovery). */
  generation: number;
}

interface CommittedPassProps {
  ledger: StaticPrintLedger;
  rows: readonly StaticPrintRow[];
  printBase: number;
  onPrinted: (absoluteCount: number) => void;
  children: ReactNode;
}

/**
 * Lives inside the error boundary, so its effect only ever runs for a render
 * pass that fully committed: record how far printing reached, then
 * acknowledge every batch that pass was holding.
 */
function CommittedPass({
  ledger,
  rows,
  printBase,
  onPrinted,
  children,
}: CommittedPassProps): ReactNode {
  useEffect(() => {
    onPrinted(printBase + rows.length);
    acknowledgePending(ledger);
  }, [rows, printBase, ledger, onPrinted]);
  return <>{children}</>;
}

interface PrintBoundaryProps {
  onCrash: () => void;
  children: ReactNode;
}

interface PrintBoundaryState {
  crashed: boolean;
}

/**
 * Module-private boundary around the rows region: a throwing renderRow
 * discards its render pass (no effects run, nothing prints) and settles on
 * an empty fallback instead of killing the protocol.
 */
class PrintBoundary extends Component<PrintBoundaryProps, PrintBoundaryState> {
  constructor(props: PrintBoundaryProps) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError(): Partial<PrintBoundaryState> {
    return { crashed: true };
  }

  override componentDidCatch(): void {
    this.props.onCrash();
  }

  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}

export interface StaticPrintProtocolProps {
  ledger: StaticPrintLedger;
  renderRow: (row: StaticPrintRow) => ReactNode;
}

export function StaticPrintProtocol({
  ledger,
  renderRow,
}: StaticPrintProtocolProps): ReactNode {
  const items = useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => subscribeLedger(ledger, onStoreChange),
      [ledger],
    ),
    useCallback(() => ledger.items(), [ledger]),
  );
  const epoch = ledger.epoch();
  const [state, setState] = useState<ProtocolState>(() => ({
    epoch,
    crashedFor: null,
    printBase: 0,
    generation: 0,
  }));
  // Absolute count of rows printed through <Static>. Updated only by
  // committed passes, so a crashed pass leaves it at the last good value.
  const printedThroughRef = useRef(0);

  let current = state;
  if (current.epoch !== epoch) {
    // clear(): fresh epoch, fresh stream.
    printedThroughRef.current = 0;
    current = { epoch, crashedFor: null, printBase: 0, generation: 0 };
    setState(current);
  } else if (current.crashedFor !== null && current.crashedFor !== items) {
    // Recovery: data moved past the crashed pass; mount a fresh <Static>
    // resuming from everything actually printed so far.
    current = {
      epoch,
      crashedFor: null,
      printBase: printedThroughRef.current,
      generation: current.generation + 1,
    };
    setState(current);
  }

  const handleCrash = useCallback(() => {
    setState((prev) =>
      prev.crashedFor === null ? { ...prev, crashedFor: items } : prev,
    );
  }, [items]);

  const visible = useMemo<StaticPrintRow[]>(
    () =>
      Array.from(
        current.printBase === 0 ? items : items.slice(current.printBase),
      ),
    [items, current.printBase],
  );

  const markPrinted = useCallback((absoluteCount: number) => {
    printedThroughRef.current = absoluteCount;
  }, []);

  const remountKey = `${current.epoch}:${current.generation}`;

  return (
    <PrintBoundary key={remountKey} onCrash={handleCrash}>
      <CommittedPass
        ledger={ledger}
        rows={visible}
        printBase={current.printBase}
        onPrinted={markPrinted}
      >
        <Static key={remountKey} items={visible}>
          {(row: StaticPrintRow) => (
            <Fragment key={row.key}>{renderRow(row)}</Fragment>
          )}
        </Static>
      </CommittedPass>
    </PrintBoundary>
  );
}
