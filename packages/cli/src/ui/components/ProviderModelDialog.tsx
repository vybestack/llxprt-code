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
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      models.findIndex((m) => m.id === currentModel),
    ),
  );

  const columns = 3;
  const longestId = models.reduce((len, m) => Math.max(len, m.id.length), 0);
  const colWidth = Math.max(longestId + 4, 24);
  const rows = Math.ceil(models.length / columns);

  const move = (delta: number) => {
    let next = index + delta;
    if (next < 0) next = 0;
    if (next >= models.length) next = models.length - 1;
    setIndex(next);
  };

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (key.return) return onSelect(models[index].id);
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

  const grid: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const rowItems = [];
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (i < models.length) rowItems.push(renderItem(models[i], i));
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
        Select Model (←/→/↑/↓, Enter to choose, Esc to cancel)
      </Text>
      {grid}
    </Box>
  );
};
