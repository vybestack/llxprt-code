/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';
import { IModel } from '../../providers/index.js';

interface ProviderModelDialogProps {
  models: IModel[];
  currentModel: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export const ProviderModelDialog: React.FC<ProviderModelDialogProps> = ({
  models,
  currentModel,
  onSelect,
  onClose,
}) => {
  // Sort models alphabetically by ID
  const sortedModels = [...models].sort((a, b) =>
    a.id.toLowerCase().localeCompare(b.id.toLowerCase()),
  );

  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      sortedModels.findIndex((m) => m.id === currentModel),
    ),
  );

  // Dynamically calculate columns based on terminal width and longest model ID
  const terminalWidth = process.stdout.columns || 80;
  const longestId = sortedModels.reduce(
    (len, m) => Math.max(len, m.id.length),
    0,
  );
  const minColWidth = Math.max(longestId + 4, 24);
  const padding = 8; // Border + margins
  const maxColumns = Math.floor((terminalWidth - padding) / minColWidth);
  const columns = Math.min(Math.max(3, maxColumns), 5); // Between 3-5 columns
  const colWidth = Math.floor((terminalWidth - padding) / columns);
  const rows = Math.ceil(sortedModels.length / columns);

  const move = (delta: number) => {
    let next = index + delta;
    if (next < 0) next = 0;
    if (next >= sortedModels.length) next = sortedModels.length - 1;
    setIndex(next);
  };

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (key.return) return onSelect(sortedModels[index].id);
    if (key.leftArrow) move(-1);
    if (key.rightArrow) move(1);
    if (key.upArrow) move(-columns);
    if (key.downArrow) move(columns);
  });

  const renderItem = (m: IModel, i: number) => {
    const selected = i === index;
    return (
      <Box key={m.id} width={colWidth} marginRight={2}>
        <Text color={selected ? '#00ff00' : Colors.Foreground}>
          {selected ? '● ' : '○ '}
          {m.id}
        </Text>
      </Box>
    );
  };

  // Calculate visible rows for scrolling
  const maxVisibleRows = Math.min(rows, 10); // Show max 10 rows at a time
  const currentRow = Math.floor(index / columns);
  const scrollOffset = Math.max(
    0,
    Math.min(
      currentRow - Math.floor(maxVisibleRows / 2),
      rows - maxVisibleRows,
    ),
  );

  const visibleGrid: React.ReactNode[] = [];
  for (
    let r = scrollOffset;
    r < Math.min(scrollOffset + maxVisibleRows, rows);
    r++
  ) {
    const rowItems = [];
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (i < sortedModels.length)
        rowItems.push(renderItem(sortedModels[i], i));
    }
    visibleGrid.push(<Box key={r}>{rowItems}</Box>);
  }

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
    >
      <Text bold color={Colors.Foreground}>
        Select Model (←/→/↑/↓, Enter to choose, Esc to cancel)
      </Text>
      {rows > maxVisibleRows && (
        <Text color={Colors.Gray}>
          Showing {scrollOffset + 1}-
          {Math.min(scrollOffset + maxVisibleRows, rows)} of {rows} rows (
          {sortedModels.length} models)
        </Text>
      )}
      {visibleGrid}
      {sortedModels.length > 0 && (
        <Text color={Colors.Gray}>Current: {sortedModels[index].id}</Text>
      )}
    </Box>
  );
};
