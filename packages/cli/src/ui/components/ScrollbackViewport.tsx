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
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { Colors } from '../colors.js';
import type {
  ScrollbackPagerStore,
  ScrollbackRow,
  ScrollbackViewportReporter,
} from '../stores/turn/scrollbackPager.js';

export interface ScrollbackViewportProps {
  store: ScrollbackPagerStore;
  viewport: ScrollbackViewportReporter;
  viewportLines: number;
  pollMs: number;
  onPageUp?: () => void;
  onPageDown?: () => void;
}

/** Row keys never contain NUL, so a NUL join is a lossless list encoding. */
const KEY_SEPARATOR = '\u0000';

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

export function ScrollbackViewport({
  store,
  viewport,
  viewportLines,
  pollMs,
  onPageUp,
  onPageDown,
}: ScrollbackViewportProps): React.JSX.Element {
  const [pageOffset, setPageOffset] = useState(0);
  const [, bumpTick] = useState(0);
  const { stdout } = useStdout();
  const rowHeightLines = Math.max(1, viewport.rowHeightLines());

  // The store has no subscription API; poll it into renders.
  useEffect(() => {
    const timer = setInterval(() => {
      bumpTick((tick) => tick + 1);
    }, pollMs);
    return () => {
      clearInterval(timer);
    };
  }, [pollMs]);

  const state = store.getState();
  const frame = clipWindow(
    state.rows,
    pageOffset,
    viewportLines,
    rowHeightLines,
  );
  const visibleKeysSig = frame.rows.map((row) => row.key).join(KEY_SEPARATOR);

  // Publish the window through the store-shared reporter whenever its
  // contents change; the key signature gates the store-side report.
  useEffect(() => {
    viewport.viewportLines = viewportLines;
    viewport.visibleKeys =
      visibleKeysSig === '' ? [] : visibleKeysSig.split(KEY_SEPARATOR);
    store.reportViewport();
  }, [store, viewport, viewportLines, visibleKeysSig]);

  useInput((_input, key) => {
    const windowRows = windowRowsFor(viewportLines, rowHeightLines);
    if (key.pageUp) {
      setPageOffset((offset) => offset + windowRows);
      void store.pageBack();
      onPageUp?.();
    } else if (key.pageDown) {
      setPageOffset((offset) => Math.max(0, offset - windowRows));
      void store.pageForward();
      onPageDown?.();
    }
  });

  useResizeReport(
    store,
    viewport,
    stdout,
    pageOffset,
    viewportLines,
    rowHeightLines,
  );

  return (
    <Box flexDirection="column">
      <TopEdgeRow
        loadingOlder={state.loadingOlder}
        atVisibilityFloor={state.atVisibilityFloor}
        hiddenAbove={frame.hiddenAbove}
      />
      {frame.rows.map((row) => (
        <Text key={row.key} color={Colors.Foreground}>
          {row.item.text ?? ''}
        </Text>
      ))}
      <BottomEdgeRow
        hiddenBelow={frame.hiddenBelow}
        atFileEnd={state.atFileEnd}
      />
    </Box>
  );
}
