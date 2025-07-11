/*
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';

interface ProviderDialogProps {
  providers: string[];
  currentProvider?: string;
  onSelect: (providerName: string) => void;
  onClose: () => void;
}

export const ProviderDialog: React.FC<ProviderDialogProps> = ({
  providers,
  currentProvider,
  onSelect,
  onClose,
}) => {
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      providers.findIndex((p) => p === currentProvider),
    ),
  );

  const columns = 3;
  const longest = providers.reduce((len, p) => Math.max(len, p.length), 0);
  const colWidth = Math.max(longest + 4, 20);
  const rows = Math.ceil(providers.length / columns);

  const move = (delta: number) => {
    let next = index + delta;
    if (next < 0) next = 0;
    if (next >= providers.length) next = providers.length - 1;
    setIndex(next);
  };

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (key.return) return onSelect(providers[index]);
    if (key.leftArrow) move(-1);
    if (key.rightArrow) move(1);
    if (key.upArrow) move(-columns);
    if (key.downArrow) move(columns);
  });

  const renderItem = (name: string, i: number) => {
    const selected = i === index;
    return (
      <Box key={name} width={colWidth} marginRight={2}>
        <Text color={selected ? '#00ff00' : Colors.Foreground}>
          {selected ? '● ' : '○ '}
          {name}
        </Text>
      </Box>
    );
  };

  const grid: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const rowItems = [] as React.ReactNode[];
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (i < providers.length) rowItems.push(renderItem(providers[i], i));
    }
    grid.push(<Box key={r}>{rowItems}</Box>);
  }

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
    >
      <Text bold color={Colors.Foreground}>
        Select Provider (←/→/↑/↓, Enter to choose, Esc to cancel)
      </Text>
      {grid}
    </Box>
  );
};
