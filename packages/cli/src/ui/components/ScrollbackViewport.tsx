/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P02d
 * @requirement G1,G2
 *
 * The pager's own window over a ScrollbackPagerStore (issue-854-design.md
 * §3): resident rows rendered identity-anchored (React key = row key) and
 * clipped to a `viewportLines`-tall window, with loading / visibility-floor
 * placeholders above and a below-bottom placeholder under the window.
 *
 * The store exposes no subscription API, so the window re-reads getState()
 * on a `pollMs` cadence. Page input slides the window and pages the store.
 * Scroll position is an offset counted from the bottom of the resident set,
 * so prepending older rows never shifts the visible slice, and the offset
 * is clamped to the rows that actually exist. Window metrics are published
 * through the store-shared ScrollbackViewportReporter (change-gated) and
 * re-reported on stdout resize.
 *
 * P02d addendum: Home/End jump the window to the oldest/newest resident
 * edge (matched from raw stdin chunks; Ink's useInput exposes no home/end),
 * arrow keys drive the direction-paged wheel path (onScrollUp/onScrollDown;
 * real wheel/drag arrives via the same paging path in P02e), a store error
 * renders a one-line error row in place of the top edge, a row-height
 * change remaps the offset so the window's first line keeps its anchor
 * row, and pending live-tail rows the window does not cover render as
 * independent slots below it.
 *
 * P03 addendum: when the layout supplies a context `range` snapshot and the
 * CLI runtime (`config`), resident rows render through HistoryItemDisplay
 * with a contextState badge derived from classifyContextState; unwired
 * callers render the raw row text as before. Resident-set gaps that fully
 * contain a removedInterior span render a HistoryBoundaryRow between the
 * bracketing rows; 'x' toggles the boundary rows in the window and the
 * toggle position is pruned when a boundary leaves the window, so an
 * evicted boundary remounts collapsed. Boundary summaries are placeholder
 * text until P05 lands the journal re-read.
 */

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, useStdin, useStdout } from 'ink';
import type {
  ContextRange,
  RemovedInteriorSpan,
} from '@vybestack/llxprt-code-core';
import { Colors, SemanticColors } from '../colors.js';
import { ESC } from '../utils/input.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { HistoryItemDisplay } from './HistoryItemDisplay.js';
import { HistoryBoundaryRow } from './HistoryBoundaryRow.js';
import {
  classifyContextState,
  type HistoryContextState,
} from '../utils/historyContextState.js';
import type {
  ScrollbackPagerState,
  ScrollbackPagerStore,
  ScrollbackRow,
  ScrollbackViewportReporter,
} from '../stores/turn/scrollbackPager.js';

export interface ScrollbackViewportProps {
  store: ScrollbackPagerStore;
  viewport: ScrollbackViewportReporter;
  viewportLines: number;
  pollMs: number;
  /**
   * Context boundary snapshot (#854). When absent (or paired with no
   * `config`), rows render as raw text exactly as before P03.
   */
  range?: ContextRange;
  /** CLI runtime handed to wired rows' HistoryItemDisplay. */
  config?: CliUiRuntime;
  onPageUp?: () => void;
  onPageDown?: () => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
}

/** Row keys never contain NUL, so a NUL join is a lossless list encoding. */
const KEY_SEPARATOR = '\u0000';

/** Home/End arrive as raw stdin sequences; useInput blanks them from input. */
const HOME_SEQUENCES = [`${ESC}[H`, `${ESC}[1~`, `${ESC}OH`, `${ESC}[7~`];
const END_SEQUENCES = [`${ESC}[F`, `${ESC}[4~`, `${ESC}OF`, `${ESC}[8~`];

function matchesAny(chunk: string, sequences: readonly string[]): boolean {
  return sequences.some((sequence) => chunk.includes(sequence));
}

function windowRowsFor(viewportLines: number, rowHeightLines: number): number {
  return Math.max(1, Math.floor(viewportLines / rowHeightLines));
}

interface WindowFrame {
  readonly rows: readonly ScrollbackRow[];
  /** Resident rows hidden above the window's top edge. */
  readonly hiddenAbove: number;
  /** Resident rows hidden below the window's bottom edge. */
  readonly hiddenBelow: number;
}

/**
 * Clips the resident rows to the window ending `offset` rows above the
 * newest row. The offset-from-bottom anchor survives prepends and evictions
 * of older rows without shifting the visible slice; the offset is clamped
 * so the window never leaves the rows that exist.
 */
function clipWindow(
  rows: readonly ScrollbackRow[],
  offset: number,
  viewportLines: number,
  rowHeightLines: number,
): WindowFrame {
  const windowRows = windowRowsFor(viewportLines, rowHeightLines);
  const clamped = Math.max(
    0,
    Math.min(Math.max(0, offset), rows.length - windowRows),
  );
  const end = rows.length - clamped;
  const start = Math.max(0, end - windowRows);
  return {
    rows: rows.slice(start, end),
    hiddenAbove: start,
    hiddenBelow: clamped,
  };
}

function TopEdgeRow({
  loadingOlder,
  atVisibilityFloor,
  hiddenAbove,
}: {
  loadingOlder: boolean;
  atVisibilityFloor: boolean;
  hiddenAbove: number;
}): React.JSX.Element | null {
  if (loadingOlder) {
    return <Text color={Colors.DimComment}>loading older…</Text>;
  }
  if (atVisibilityFloor) {
    return <Text color={Colors.DimComment}>history above was cleared</Text>;
  }
  if (hiddenAbove > 0) {
    return <Text color={Colors.DimComment}>…</Text>;
  }
  return null;
}

function BottomEdgeRow({
  hiddenBelow,
  atFileEnd,
}: {
  hiddenBelow: number;
  atFileEnd: boolean;
}): React.JSX.Element | null {
  if (hiddenBelow > 0 || !atFileEnd) {
    return <Text color={Colors.DimComment}>more below</Text>;
  }
  return null;
}

/**
 * Pending live-tail rows the window does not cover render as independent
 * slots below it, so the live tail stays visible while scrolled away.
 */
function pendingRowsBelow(
  rows: readonly ScrollbackRow[],
  windowKeys: ReadonlySet<string>,
): ScrollbackRow[] {
  return rows.filter(
    (row) => row.identity.kind === 'pending' && !windowKeys.has(row.key),
  );
}

function boundarySpanKey(span: RemovedInteriorSpan): string {
  return `boundary:${span.start}:${span.end}`;
}

/** Removed-interior spans fully inside the seq gap between two rows. */
function spansWithinGap(
  olderSeq: number,
  newerSeq: number,
  range: ContextRange,
): RemovedInteriorSpan[] {
  return range.removedInterior.filter(
    (span) => span.start > olderSeq && span.end < newerSeq,
  );
}

function windowSpanKeys(
  rows: readonly ScrollbackRow[],
  range: ContextRange | undefined,
): string[] {
  if (range === undefined) return [];
  const keys: string[] = [];
  let olderSeq: number | null = null;
  for (const row of rows) {
    if (olderSeq !== null && row.seq !== null) {
      for (const span of spansWithinGap(olderSeq, row.seq, range)) {
        keys.push(boundarySpanKey(span));
      }
    }
    if (row.seq !== null) olderSeq = row.seq;
  }
  return keys;
}

/**
 * Boundary summaries are placeholder text until P05's journal re-read;
 * the loader shape stays, so the swap is one function.
 */
function placeholderSummaryLoader(
  span: RemovedInteriorSpan,
): () => Promise<string> {
  const count = span.end - span.start + 1;
  return () =>
    Promise.resolve(
      `${count} ${count === 1 ? 'entry' : 'entries'} removed (${span.reason})`,
    );
}

function contextStateForRow(
  seq: number | null,
  range: ContextRange | undefined,
): HistoryContextState | undefined {
  if (seq === null || range === undefined) return undefined;
  return classifyContextState(seq, range);
}

function RawScrollbackRow({ row }: { row: ScrollbackRow }): React.JSX.Element {
  return <Text color={Colors.Foreground}>{row.item.text ?? ''}</Text>;
}

function WiredScrollbackRow({
  row,
  config,
  range,
  terminalWidth,
}: {
  row: ScrollbackRow;
  config: CliUiRuntime;
  range: ContextRange | undefined;
  terminalWidth: number;
}): React.JSX.Element {
  return (
    <HistoryItemDisplay
      item={row.item}
      terminalWidth={terminalWidth}
      isPending={false}
      config={config}
      contextState={contextStateForRow(row.seq, range)}
    />
  );
}

function PendingTailSlots({
  rows,
}: {
  rows: readonly ScrollbackRow[];
}): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <>
      <Text color={Colors.DimComment}>··· pending ···</Text>
      {rows.map((row) => (
        <Text key={row.key} color={Colors.Foreground}>
          {row.item.text ?? ''}
        </Text>
      ))}
    </>
  );
}

/** The store has no subscription API; poll it into renders. */
function usePollTick(pollMs: number): void {
  const [, bumpTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      bumpTick((tick) => tick + 1);
    }, pollMs);
    return () => {
      clearInterval(timer);
    };
  }, [pollMs]);
}

/**
 * Publishes the window through the store-shared reporter whenever its
 * contents change; the key signature gates the store-side report.
 */
function useViewportReport(
  store: ScrollbackPagerStore,
  viewport: ScrollbackViewportReporter,
  viewportLines: number,
  visibleKeysSig: string,
): void {
  useEffect(() => {
    viewport.viewportLines = viewportLines;
    viewport.visibleKeys =
      visibleKeysSig === '' ? [] : visibleKeysSig.split(KEY_SEPARATOR);
    store.reportViewport();
  }, [store, viewport, viewportLines, visibleKeysSig]);
}

/**
 * Home/End edge jumps: Ink's useInput exposes no home/end flags, so the raw
 * stdin chunk is matched here (the stdin-listener pattern KeypressContext
 * uses). Home points the window at the oldest resident edge and pages the
 * store toward the floor; End returns it to the newest edge and pages
 * forward while the file continues.
 */
function useEdgeJumpInput(
  store: ScrollbackPagerStore,
  stdin: NodeJS.ReadStream,
  windowRows: number,
  setPageOffset: (offset: number) => void,
): void {
  useEffect(() => {
    const handleData = (data: string | Buffer): void => {
      const chunk = typeof data === 'string' ? data : data.toString('utf8');
      if (matchesAny(chunk, HOME_SEQUENCES)) {
        const residentRows = store.getState().rows.length;
        setPageOffset(Math.max(0, residentRows - windowRows));
        void store.pageBack();
      } else if (matchesAny(chunk, END_SEQUENCES)) {
        setPageOffset(0);
        if (!store.getState().atFileEnd) void store.pageForward();
      }
    };
    stdin.on('data', handleData);
    return () => {
      stdin.off('data', handleData);
    };
  }, [store, stdin, windowRows, setPageOffset]);
}

/**
 * A row's rendered height can change (expand/collapse). On a rowHeightLines
 * change while scrolled away from the bottom, remap the offset-from-bottom
 * so the same anchor row stays the window's first line; at the bottom the
 * window stays pinned to the newest row instead.
 */
function useHeightAnchorRemap(
  pageOffset: number,
  setPageOffset: (offset: number) => void,
  rowHeightLines: number,
  windowRows: number,
  residentRows: number,
): void {
  const heightRef = useRef({ rowHeightLines, windowRows });
  useEffect(() => {
    const prev = heightRef.current;
    if (prev.rowHeightLines === rowHeightLines) return;
    heightRef.current = { rowHeightLines, windowRows };
    if (pageOffset === 0) return;
    const clampedPrev = Math.max(
      0,
      Math.min(pageOffset, residentRows - prev.windowRows),
    );
    const anchorIndex = Math.max(
      0,
      residentRows - clampedPrev - prev.windowRows,
    );
    const end = Math.min(residentRows, anchorIndex + windowRows);
    const nextOffset = Math.max(0, residentRows - end);
    if (nextOffset !== pageOffset) setPageOffset(nextOffset);
  }, [rowHeightLines, windowRows, pageOffset, residentRows, setPageOffset]);
}

/**
 * Re-reports the current window through the store-shared reporter on stdout
 * resize, computed from the freshest store state and reported even when the
 * window did not change.
 */
function useResizeReport(
  store: ScrollbackPagerStore,
  viewport: ScrollbackViewportReporter,
  stdout: NodeJS.WriteStream,
  pageOffset: number,
  viewportLines: number,
  rowHeightLines: number,
): void {
  useEffect(() => {
    const handleResize = (): void => {
      const next = clipWindow(
        store.getState().rows,
        pageOffset,
        viewportLines,
        rowHeightLines,
      );
      viewport.viewportLines = viewportLines;
      viewport.visibleKeys = next.rows.map((row) => row.key);
      store.reportViewport();
    };
    stdout.on('resize', handleResize);
    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout, store, viewport, viewportLines, pageOffset, rowHeightLines]);
}

/** Per-render wiring handed down from the owning component. */
interface FrameWiring {
  readonly range: ContextRange | undefined;
  readonly config: CliUiRuntime | undefined;
  readonly terminalWidth: number;
  readonly expandedSpans: ReadonlySet<string>;
  readonly onToggleBoundary: () => void;
}

/** Renders one computed window frame: edges, rows, boundaries, pending tail. */
function ViewportFrame({
  state,
  frame,
  pendingBelow,
  wiring,
}: {
  state: ScrollbackPagerState;
  frame: WindowFrame;
  pendingBelow: readonly ScrollbackRow[];
  wiring: FrameWiring;
}): React.JSX.Element {
  const lines: React.JSX.Element[] = [];
  let olderSeq: number | null = null;
  for (const row of frame.rows) {
    if (wiring.range !== undefined && olderSeq !== null && row.seq !== null) {
      for (const span of spansWithinGap(olderSeq, row.seq, wiring.range)) {
        const key = boundarySpanKey(span);
        lines.push(
          <HistoryBoundaryRow
            key={key}
            reason={span.reason}
            count={span.end - span.start + 1}
            expanded={wiring.expandedSpans.has(key)}
            onToggle={wiring.onToggleBoundary}
            loadSummary={placeholderSummaryLoader(span)}
          />,
        );
      }
    }
    lines.push(
      wiring.config === undefined ? (
        <RawScrollbackRow key={row.key} row={row} />
      ) : (
        <WiredScrollbackRow
          key={row.key}
          row={row}
          config={wiring.config}
          range={wiring.range}
          terminalWidth={wiring.terminalWidth}
        />
      ),
    );
    if (row.seq !== null) olderSeq = row.seq;
  }
  return (
    <Box flexDirection="column">
      {state.error !== null ? (
        <Text color={SemanticColors.status.error}>
          scrollback unavailable: {state.error}
        </Text>
      ) : (
        <TopEdgeRow
          loadingOlder={state.loadingOlder}
          atVisibilityFloor={state.atVisibilityFloor}
          hiddenAbove={frame.hiddenAbove}
        />
      )}
      {lines}
      <BottomEdgeRow
        hiddenBelow={frame.hiddenBelow}
        atFileEnd={state.atFileEnd}
      />
      <PendingTailSlots rows={pendingBelow} />
    </Box>
  );
}

/**
 * Expansion state for the boundary rows in the window. Expansion dies with
 * the boundary's residency: a span key no longer in the window is pruned,
 * so an evicted boundary remounts collapsed and re-reads on its next expand
 * (no global expansion purge). The visible-key set is rebuilt inside the
 * effect from the window's span-key signature, so per-render Set identity
 * churn cannot retrigger the prune.
 */
function useBoundaryExpansion(
  spanKeysSig: string,
): [ReadonlySet<string>, () => void] {
  const [expandedSpans, setExpandedSpans] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  useEffect(() => {
    const visibleSpanKeySet = new Set<string>(
      spanKeysSig === '' ? [] : spanKeysSig.split(KEY_SEPARATOR),
    );
    setExpandedSpans((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const key of prev) {
        if (visibleSpanKeySet.has(key)) next.add(key);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [spanKeysSig]);

  const toggleVisibleBoundaries = useCallback(() => {
    const keys = spanKeysSig === '' ? [] : spanKeysSig.split(KEY_SEPARATOR);
    if (keys.length === 0) return;
    setExpandedSpans((prev) => {
      const allExpanded = keys.every((key) => prev.has(key));
      const next = new Set(prev);
      for (const key of keys) {
        if (allExpanded) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }, [spanKeysSig]);

  return [expandedSpans, toggleVisibleBoundaries];
}

/**
 * Page/scroll keystrokes: PageUp/PageDown slide the window a full window
 * and page the store, the arrow keys carry the same direction-paged step
 * (wheel/drag events land here via the P02e wiring), and 'x' toggles the
 * boundary rows in the window.
 */
function usePagingInput(
  store: ScrollbackPagerStore,
  windowRows: number,
  setPageOffset: React.Dispatch<React.SetStateAction<number>>,
  onToggleBoundaries: () => void,
  onPageUp: (() => void) | undefined,
  onPageDown: (() => void) | undefined,
  onScrollUp: (() => void) | undefined,
  onScrollDown: (() => void) | undefined,
): void {
  useInput((input, key) => {
    if (key.pageUp) {
      setPageOffset((offset) => offset + windowRows);
      void store.pageBack();
      onPageUp?.();
    } else if (key.pageDown) {
      setPageOffset((offset) => Math.max(0, offset - windowRows));
      void store.pageForward();
      onPageDown?.();
    } else if (key.upArrow) {
      // Wheel/drag path: real mouse events land here via P02e wiring; the
      // arrow keys carry the same direction-paged step in no-TTY contexts.
      setPageOffset((offset) => offset + 1);
      void store.pageBack();
      onScrollUp?.();
    } else if (key.downArrow) {
      setPageOffset((offset) => Math.max(0, offset - 1));
      void store.pageForward();
      onScrollDown?.();
    } else if (input === 'x') {
      onToggleBoundaries();
    }
  });
}

export function ScrollbackViewport({
  store,
  viewport,
  viewportLines,
  pollMs,
  range,
  config,
  onPageUp,
  onPageDown,
  onScrollUp,
  onScrollDown,
}: ScrollbackViewportProps): React.JSX.Element {
  const [pageOffset, setPageOffset] = useState(0);
  const { stdout } = useStdout();
  const { stdin } = useStdin();
  const rowHeightLines = Math.max(1, viewport.rowHeightLines());
  const windowRows = windowRowsFor(viewportLines, rowHeightLines);
  usePollTick(pollMs);

  const state = store.getState();
  const frame = clipWindow(
    state.rows,
    pageOffset,
    viewportLines,
    rowHeightLines,
  );
  const visibleKeysSig = frame.rows.map((row) => row.key).join(KEY_SEPARATOR);
  const spanKeysSig = windowSpanKeys(frame.rows, range).join(KEY_SEPARATOR);

  useViewportReport(store, viewport, viewportLines, visibleKeysSig);

  const [expandedSpans, toggleVisibleBoundaries] =
    useBoundaryExpansion(spanKeysSig);

  usePagingInput(
    store,
    windowRows,
    setPageOffset,
    toggleVisibleBoundaries,
    onPageUp,
    onPageDown,
    onScrollUp,
    onScrollDown,
  );

  useEdgeJumpInput(store, stdin, windowRows, setPageOffset);
  useHeightAnchorRemap(
    pageOffset,
    setPageOffset,
    rowHeightLines,
    windowRows,
    state.rows.length,
  );
  useResizeReport(
    store,
    viewport,
    stdout,
    pageOffset,
    viewportLines,
    rowHeightLines,
  );

  const windowKeys = new Set(frame.rows.map((row) => row.key));
  const pendingBelow = pendingRowsBelow(state.rows, windowKeys);

  return (
    <ViewportFrame
      state={state}
      frame={frame}
      pendingBelow={pendingBelow}
      wiring={{
        range,
        config,
        terminalWidth: stdout.columns,
        expandedSpans,
        onToggleBoundary: toggleVisibleBoundaries,
      }}
    />
  );
}
