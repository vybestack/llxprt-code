/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Static } from 'ink';
import type {
  ScrollbackPagerStore,
  ScrollbackRow,
  ScrollbackViewportReporter,
} from '../stores/turn/scrollbackPager.js';
import { useTurnStore } from '../stores/turn/TurnContext.js';
import { useTerminalStore } from '../stores/terminal/TerminalContext.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';
import { HistoryItemDisplay } from '../components/HistoryItemDisplay.js';
import { StreamingState } from '../types.js';
import type { SlashCommandRuntime } from '../cliUiRuntime.js';
import { SCROLLBACK_VIEWPORT_POLL_MS } from '../../constants/scrollbackLimits.js';

import { settledTranscriptPrefix } from './journal-emission-rows.js';

interface Emission {
  readonly serial: number;
  readonly rows: ScrollbackRow[];
  readonly width: number;
}

interface PrintedPosition {
  readonly offset: number;
  readonly keys: ReadonlySet<string>;
}

function unprinted(row: ScrollbackRow, printed: PrintedPosition): boolean {
  return (
    row.offset !== null &&
    (row.offset > printed.offset ||
      (row.offset === printed.offset && !printed.keys.has(row.key)))
  );
}

function useJournalEmission(
  store: ScrollbackPagerStore,
  width: number,
  responding: boolean,
) {
  const [frame, setFrame] = useState(() => store.getState());
  const [emission, setEmission] = useState<Emission>({
    serial: 0,
    rows: [],
    width,
  });
  const printed = useRef({ offset: -1, keys: new Set<string>() });
  useEffect(() => {
    if (emission.rows.length > 0)
      setEmission((previous) => ({ ...previous, rows: [] }));
  }, [emission]);
  useEffect(() => {
    printed.current = { offset: -1, keys: new Set<string>() };
    setFrame(store.getState());
    const timer = setInterval(
      () => setFrame(store.getState()),
      SCROLLBACK_VIEWPORT_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [store]);
  useEffect(() => {
    const candidates = responding ? frame.rows.slice(0, -1) : frame.rows;
    const stable = settledTranscriptPrefix(candidates, responding);
    const rows = stable.filter((row) => unprinted(row, printed.current));
    if (rows.length === 0) return;
    for (const row of rows) {
      if (row.offset === null) continue;
      if (row.offset > printed.current.offset) printed.current.keys.clear();
      printed.current.offset = row.offset;
      printed.current.keys.add(row.key);
    }
    setEmission((previous) => ({ serial: previous.serial + 1, rows, width }));
  }, [frame, width, responding]);
  const live = responding
    ? frame.rows.slice(-1).filter((row) => unprinted(row, printed.current))
    : [];
  return { emission, live, printed };
}

function PrintedBatch({
  emission,
  config,
}: {
  emission: Emission;
  config: SlashCommandRuntime;
}) {
  return (
    <Static key={emission.serial} items={emission.rows}>
      {(row) => (
        <HistoryItemDisplay
          key={row.key}
          item={row.item}
          terminalWidth={emission.width}
          isPending={false}
          config={config}
        />
      )}
    </Static>
  );
}
const MemoizedPrintedBatch = React.memo(PrintedBatch);

export function JournalStandardTranscript({
  store,
  config,
  viewport,
}: {
  store: ScrollbackPagerStore;
  config: SlashCommandRuntime;
  viewport: ScrollbackViewportReporter;
}): React.JSX.Element {
  const turn = useTurnStore();
  const terminal = useTerminalStore();
  const width = useStoreSelector(
    terminal.store,
    (state) => state.mainAreaWidth,
  );
  const height = useStoreSelector(
    terminal.store,
    (state) => state.availableTerminalHeight,
  );
  const pending = useStoreSelector(
    turn.store,
    (state) => state.pendingHistoryItems,
  );
  const responding = useStoreSelector(
    turn.store,
    (state) => state.streamingState !== StreamingState.Idle,
  );
  const { emission, live, printed } = useJournalEmission(
    store,
    width,
    responding,
  );
  useEffect(() => {
    viewport.followingTail = true;
    viewport.viewportLines = Math.max(1, height);
    viewport.visibleKeys = store
      .getState()
      .rows.filter((row) => unprinted(row, printed.current))
      .map((row) => row.key);
    store.reportViewport();
    store.pageOut('older');
  }, [store, viewport, height, emission, printed]);
  return (
    <>
      <MemoizedPrintedBatch emission={emission} config={config} />
      <Box flexDirection="column">
        {live.map((row) => (
          <HistoryItemDisplay
            key={row.key}
            item={row.item}
            terminalWidth={width}
            isPending={true}
            config={config}
          />
        ))}
        {pending.map((item, index) => (
          <HistoryItemDisplay
            key={index}
            item={{ ...item, id: index }}
            terminalWidth={width}
            availableTerminalHeight={
              item.type === 'tool_group' ? height : undefined
            }
            isPending={true}
            config={config}
          />
        ))}
      </Box>
    </>
  );
}
