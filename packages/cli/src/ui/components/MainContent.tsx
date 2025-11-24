/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Static } from 'ink';
import { type Config } from '@vybestack/llxprt-code-core';
import { HistoryItemDisplay } from './HistoryItemDisplay.js';
import { ShowMoreLines } from './ShowMoreLines.js';
import { OverflowProvider } from '../contexts/OverflowContext.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useAppContext } from '../contexts/AppContext.js';
import { AppHeader } from './AppHeader.js';
import { useAlternateBuffer } from '../hooks/useAlternateBuffer.js';
import { SCROLL_TO_ITEM_END } from './shared/VirtualizedList.js';
import { ScrollableList } from './shared/ScrollableList.js';
import { useMemo, memo, useCallback } from 'react';
import { type HistoryItem } from '../types.js';

const MemoizedHistoryItemDisplay = memo(HistoryItemDisplay);
const MemoizedAppHeader = memo(AppHeader);

const getEstimatedItemHeight = () => 100;

const keyExtractor = (
  item: { type: 'header' | 'history' | 'pending'; item?: HistoryItem },
  _index: number,
) => {
  if (item.type === 'header') return 'header';
  if (item.type === 'history' && item.item) return item.item.id.toString();
  return 'pending';
};

// Limit Gemini messages to a very high number of lines to mitigate performance
// issues in the worst case if we somehow get an enormous response from Gemini.
// This threshold is arbitrary but should be high enough to never impact normal
// usage.
export const MainContent = ({ config }: { config: Config }) => {
  const { version } = useAppContext();
  const uiState = useUIState();
  const isAlternateBuffer = useAlternateBuffer();

  const { pendingHistoryItems, mainAreaWidth, availableTerminalHeight } =
    uiState;

  const historyItems = uiState.history.map((h) => (
    <HistoryItemDisplay
      terminalWidth={mainAreaWidth}
      availableTerminalHeight={availableTerminalHeight}
      key={h.id}
      item={h}
      isPending={false}
      commands={uiState.slashCommands}
      config={config}
    />
  ));

  const pendingItems = useMemo(
    () => (
      <OverflowProvider>
        <Box flexDirection="column">
          {pendingHistoryItems.map((item, i) => (
            <HistoryItemDisplay
              key={i}
              availableTerminalHeight={
                uiState.constrainHeight ? availableTerminalHeight : undefined
              }
              terminalWidth={mainAreaWidth}
              item={{ ...item, id: 0 }}
              isPending={true}
              isFocused={!uiState.isEditorDialogOpen}
              activeShellPtyId={uiState.activePtyId}
              config={config}
            />
          ))}
          <ShowMoreLines constrainHeight={uiState.constrainHeight} />
        </Box>
      </OverflowProvider>
    ),
    [
      pendingHistoryItems,
      uiState.constrainHeight,
      availableTerminalHeight,
      mainAreaWidth,
      uiState.isEditorDialogOpen,
      uiState.activePtyId,
      config,
    ],
  );

  const virtualizedData = useMemo(
    () => [
      { type: 'header' as const },
      ...uiState.history.map((item) => ({ type: 'history' as const, item })),
      { type: 'pending' as const },
    ],
    [uiState.history],
  );

  const renderItem = useCallback(
    ({ item }: { item: (typeof virtualizedData)[number] }) => {
      if (item.type === 'header') {
        return <MemoizedAppHeader key="app-header" version={version} />;
      } else if (item.type === 'history') {
        return (
          <MemoizedHistoryItemDisplay
            terminalWidth={mainAreaWidth}
            availableTerminalHeight={availableTerminalHeight}
            key={item.item.id}
            item={item.item}
            isPending={false}
            commands={uiState.slashCommands}
            config={config}
          />
        );
      } else {
        return pendingItems;
      }
    },
    [
      version,
      mainAreaWidth,
      availableTerminalHeight,
      uiState.slashCommands,
      pendingItems,
      config,
    ],
  );

  if (isAlternateBuffer) {
    return (
      <ScrollableList
        hasFocus={!uiState.isEditorDialogOpen}
        data={virtualizedData}
        renderItem={renderItem}
        estimatedItemHeight={getEstimatedItemHeight}
        keyExtractor={keyExtractor}
        initialScrollIndex={SCROLL_TO_ITEM_END}
        initialScrollOffsetInIndex={SCROLL_TO_ITEM_END}
      />
    );
  }

  return (
    <>
      <Static
        key={uiState.staticKey}
        items={[
          <AppHeader key="app-header" version={version} />,
          ...historyItems,
        ]}
      >
        {(item) => item}
      </Static>
      {pendingItems}
    </>
  );
};
