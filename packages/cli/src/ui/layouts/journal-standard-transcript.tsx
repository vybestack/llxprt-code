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
import type { JournalRowRendering } from './journal-row-rendering.js';
import { SCROLLBACK_VIEWPORT_POLL_MS } from '../../constants/scrollbackLimits.js';

import {
  settledTranscriptPrefix,
  unprinted,
  transcriptPosition,
} from './journal-emission-rows.js';

interface Emission {
  readonly serial: number;
  readonly rows: ScrollbackRow[];
  readonly width: number;
  readonly header: boolean;
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
    header: true,
  });
  const printed = useRef({ transcriptId: -1n, keys: new Set<string>() });
  useEffect(() => {
    if (emission.rows.length > 0 || emission.header)
      setEmission((previous) => ({ ...previous, rows: [], header: false }));
  }, [emission]);
  useEffect(() => {
    printed.current = { transcriptId: -1n, keys: new Set<string>() };
    setFrame(store.getState());
    const timer = setInterval(() => {
      const next = store.getState();
      if (next.atFileEnd) setFrame(next);
      else void store.pageForward().then(() => setFrame(store.getState()));
    }, SCROLLBACK_VIEWPORT_POLL_MS);
    return () => clearInterval(timer);
  }, [store]);
  useEffect(() => {
    const candidates = responding ? frame.rows.slice(0, -1) : frame.rows;
    const stable = settledTranscriptPrefix(candidates, responding);
    const rows = stable.filter((row) => unprinted(row, printed.current));
    if (rows.length === 0) return;
    for (const row of rows) {
      const position = transcriptPosition(row);
      if (position === undefined) continue;
      if (position > printed.current.transcriptId) printed.current.keys.clear();
      printed.current.transcriptId = position;
      printed.current.keys.add(row.key);
    }
    setEmission((previous) => ({
      serial: previous.serial + 1,
      rows,
      width,
      header: false,
    }));
  }, [frame, width, responding]);
  const live = responding
    ? frame.rows.slice(-1).filter((row) => unprinted(row, printed.current))
    : [];
  return { emission, live, printed };
}

function PrintedBatch({
  emission,
  rendering,
  header,
}: {
  emission: Emission;
  rendering: JournalRowRendering;
  header: React.ReactNode;
}) {
  return (
    <Static
      key={emission.serial}
      style={{ width: emission.width }}
      items={[
        ...(emission.header
          ? [
              <Box key="header" flexDirection="column">
                {header}
              </Box>,
            ]
          : []),
        ...emission.rows.map((row) => (
          <HistoryItemDisplay
            key={row.key}
            item={row.item}
            terminalWidth={emission.width}
            isPending={false}
            {...rendering}
          />
        )),
      ]}
    >
      {(item) => item}
    </Static>
  );
}
const MemoizedPrintedBatch = React.memo(PrintedBatch);

export function JournalStandardTranscript({
  store,
  rendering,
  viewport,
  header,
}: {
  store: ScrollbackPagerStore;
  rendering: JournalRowRendering;
  viewport: ScrollbackViewportReporter;
  header?: React.ReactNode;
}): React.JSX.Element {
  const { width, height, pending, responding } = useJournalLiveState();
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
      <MemoizedPrintedBatch
        emission={emission}
        rendering={rendering}
        header={header}
      />
      <Box flexDirection="column" width={width} justifyContent="flex-end">
        <Box flexDirection="column" flexShrink={0}>
          {live.map((row) => (
            <HistoryItemDisplay
              key={row.key}
              item={row.item}
              terminalWidth={width}
              availableTerminalHeight={height}
              isPending={true}
              {...rendering}
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
              {...rendering}
            />
          ))}
        </Box>
      </Box>
    </>
  );
}

function useJournalLiveState() {
  const turn = useTurnStore();
  const terminal = useTerminalStore();
  const width = useStoreSelector(terminal.store, (state) =>
    Math.floor(state.mainAreaWidth * 0.9),
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
    (state) => state.streamingState === StreamingState.Responding,
  );
  return { width, height, pending, responding };
}
