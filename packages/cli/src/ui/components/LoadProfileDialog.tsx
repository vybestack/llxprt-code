/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { useKeypress } from '../hooks/useKeypress.js';

interface LoadProfileDialogProps {
  profiles: string[];
  onSelect: (profileName: string) => void;
  onClose: () => void;
  isLoading?: boolean;
}

export const LoadProfileDialog: React.FC<LoadProfileDialogProps> = ({
  profiles,
  onSelect,
  onClose,
  isLoading = false,
}) => {
  const [index, setIndex] = useState(0);

  const columns = 2;
  const longest = profiles.reduce((len, p) => Math.max(len, p.length), 0);
  const colWidth = Math.max(longest + 4, 30);
  const rows = Math.ceil(profiles.length / columns);

  const move = (delta: number) => {
    let next = index + delta;
    if (next < 0) next = 0;
    if (next >= profiles.length) next = profiles.length - 1;
    setIndex(next);
  };

  useKeypress(
    (key) => {
      if (key.name === 'escape') return onClose();
      if (key.name === 'return') return onSelect(profiles[index]);
      if (key.name === 'left') move(-1);
      if (key.name === 'right') move(1);
      if (key.name === 'up') move(-columns);
      if (key.name === 'down') move(columns);
    },
    { isActive: !isLoading },
  );

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
      if (i < profiles.length) rowItems.push(renderItem(profiles[i], i));
    }
    grid.push(<Box key={r}>{rowItems}</Box>);
  }

  if (isLoading) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        flexDirection="column"
        padding={1}
      >
        <Text color={Colors.Foreground}>Loading profiles...</Text>
      </Box>
    );
  }

  if (profiles.length === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        flexDirection="column"
        padding={1}
      >
        <Text color={Colors.Foreground}>
          No saved profiles found. Use /save to create a profile.
        </Text>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
    >
      <Text bold color={Colors.Foreground}>
        Select Profile (←/→/↑/↓, Enter to load, Esc to cancel)
      </Text>
      {grid}
    </Box>
  );
};
