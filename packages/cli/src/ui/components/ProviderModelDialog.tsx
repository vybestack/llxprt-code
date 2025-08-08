/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { SemanticColors } from '../colors.js';
import { IModel } from '../../providers/index.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { truncateEnd } from '../utils/responsive.js';

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
  const { isNarrow, isWide } = useResponsive();
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(true);

  // Sort models alphabetically by ID
  const sortedModels = useMemo(
    () =>
      [...models].sort((a, b) =>
        a.id.toLowerCase().localeCompare(b.id.toLowerCase()),
      ),
    [models],
  );

  // Filter models based on search term
  const filteredModels = useMemo(
    () =>
      sortedModels.filter((m) =>
        m.id.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [sortedModels, searchTerm],
  );

  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      sortedModels.findIndex((m) => m.id === currentModel),
    ),
  );

  // Reset index when search term changes
  React.useEffect(() => {
    const currentIndex = filteredModels.findIndex((m) => m.id === currentModel);
    setIndex(Math.max(0, currentIndex));
  }, [searchTerm, filteredModels, currentModel]);

  // Responsive layout calculations
  const longestId = filteredModels.reduce(
    (len, m) => Math.max(len, m.id.length),
    0,
  );
  const columns = isNarrow ? 1 : 3;
  const colWidth = isWide
    ? Math.max(longestId + 4, 30)
    : Math.max(longestId + 4, 20);
  const rows = Math.ceil(filteredModels.length / columns);

  const move = (delta: number) => {
    let next = index + delta;
    if (next < 0) next = 0;
    if (next >= filteredModels.length) next = filteredModels.length - 1;
    setIndex(next);
  };

  useInput((input, key) => {
    if (key.escape) {
      if (isSearching && searchTerm.length > 0) {
        setSearchTerm('');
      } else {
        return onClose();
      }
    }

    if (isSearching) {
      if (key.return) {
        if (filteredModels.length > 0) {
          setIsSearching(false);
        }
      } else if (key.tab || (key.downArrow && searchTerm.length === 0)) {
        setIsSearching(false);
      } else if (key.backspace || key.delete) {
        setSearchTerm((prev) => prev.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setSearchTerm((prev) => prev + input);
      }
    } else {
      if (key.return && filteredModels.length > 0) {
        return onSelect(filteredModels[index].id);
      }
      if (key.tab || (key.upArrow && index === 0)) {
        setIsSearching(true);
      }
      if (key.leftArrow) move(-1);
      if (key.rightArrow) move(1);
      if (key.upArrow) move(-columns);
      if (key.downArrow) move(columns);
    }
  });

  const renderItem = (m: IModel, i: number) => {
    const selected = i === index;
    // In wide mode, don't truncate. In standard/narrow, truncate reasonably
    const displayName = isWide
      ? m.id
      : m.id.length > 20
        ? truncateEnd(m.id, 20)
        : m.id;

    return (
      <Box key={m.id} width={isWide ? undefined : colWidth} marginRight={2}>
        <Text
          color={
            selected
              ? SemanticColors.text.accent
              : isSearching && !isNarrow
                ? SemanticColors.text.secondary
                : SemanticColors.text.primary
          }
        >
          {selected ? '● ' : '○ '}
          {displayName}
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
      if (i < filteredModels.length)
        rowItems.push(renderItem(filteredModels[i], i));
    }
    visibleGrid.push(<Box key={r}>{rowItems}</Box>);
  }

  const renderContent = () => {
    if (isNarrow) {
      return (
        <Box flexDirection="column">
          <Text bold color={SemanticColors.text.primary}>
            Select Model
          </Text>

          {/* Search input - prominent for narrow */}
          <Box marginY={1}>
            <Text color={SemanticColors.text.primary}>
              search: <Text color={SemanticColors.text.accent}>▌</Text>
            </Text>
            <Text color={SemanticColors.text.primary}>{searchTerm}</Text>
          </Box>

          <Text color={SemanticColors.text.secondary}>
            Tab to switch modes, Enter to select, Esc to cancel
          </Text>

          {/* Model count for narrow */}
          <Text color={SemanticColors.text.secondary}>
            {filteredModels.length} models{searchTerm && ` found`}
          </Text>

          {/* Results */}
          {filteredModels.length > 0 ? (
            visibleGrid
          ) : (
            <Box marginY={1}>
              <Text color={SemanticColors.text.secondary}>
                No models match &quot;{searchTerm}&quot;
              </Text>
            </Box>
          )}
        </Box>
      );
    }

    return (
      <Box flexDirection="column">
        <Text bold color={SemanticColors.text.primary}>
          {isSearching
            ? 'Search Models'
            : 'Select Model (Tab to switch modes, Enter to select, Esc to cancel)'}
        </Text>

        {/* Search input */}
        <Box marginY={1}>
          <Text
            color={
              isSearching
                ? SemanticColors.text.primary
                : SemanticColors.text.secondary
            }
          >
            search:{' '}
            {isSearching && <Text color={SemanticColors.text.accent}>▌</Text>}
          </Text>
          <Text color={SemanticColors.text.primary}>{searchTerm}</Text>
        </Box>

        {/* Results info - show for standard and wide */}
        <Text color={SemanticColors.text.secondary}>
          Found {filteredModels.length} of {sortedModels.length} models
        </Text>

        {/* Scrolling info for wide layouts */}
        {isWide && rows > maxVisibleRows && (
          <Text color={SemanticColors.text.secondary}>
            Showing {scrollOffset + 1}-
            {Math.min(scrollOffset + maxVisibleRows, rows)} of {rows} rows
          </Text>
        )}

        {/* Model grid */}
        {filteredModels.length > 0 ? (
          visibleGrid
        ) : (
          <Box marginY={1}>
            <Text color={SemanticColors.text.secondary}>
              No models match &quot;{searchTerm}&quot;
            </Text>
          </Box>
        )}

        {/* Current selection - show for non-searching in standard/wide */}
        {filteredModels.length > 0 && !isSearching && (
          <Text color={SemanticColors.text.secondary}>
            Selected: {filteredModels[index].id}
          </Text>
        )}

        <Text color={SemanticColors.text.secondary}>Tab to switch modes</Text>
      </Box>
    );
  };

  return isNarrow ? (
    <Box flexDirection="column" padding={1}>
      {renderContent()}
    </Box>
  ) : (
    <Box
      borderStyle="round"
      borderColor={SemanticColors.border.default}
      flexDirection="column"
      padding={1}
    >
      {renderContent()}
    </Box>
  );
};
