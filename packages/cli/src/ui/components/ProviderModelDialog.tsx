/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { IModel } from '../../providers/index.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { truncateStart } from '../utils/responsive.js';
import { useKeypress } from '../hooks/useKeypress.js';

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
  const { isNarrow, isWide, width } = useResponsive();
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

  // Calculate optimal layout based on available width and content
  const calculateLayout = () => {
    // Calculate minimum column width needed
    const longestModelName = filteredModels.reduce(
      (len, m) => Math.max(len, m.id.length),
      0,
    );

    if (isNarrow) {
      return { columns: 1, colWidth: Math.max(longestModelName + 4, 25) };
    }

    // Step 1: Get actual content width - responsive to screen size
    // For narrow screens, use full width; for wider screens, use 80% of width
    const maxDialogWidth = isNarrow ? width : Math.floor(width * 0.8);
    const contentWidth = maxDialogWidth - 4; // 4 for padding/borders

    // Step 2: Calculate column width needed (model name + marker + small buffer)
    const markerWidth = 2; // "● " or "○ "
    const spacingBetweenCols = 4; // Fixed spacing between columns
    const colWidthNeeded = longestModelName + markerWidth + 1; // +1 for a tiny buffer

    // Step 3: Determine optimal column count
    // Try to fit as many columns as possible without truncation
    let optimalColumns = 1;

    for (let cols = 5; cols >= 1; cols--) {
      // Calculate total width needed for this many columns
      const totalWidthNeeded =
        colWidthNeeded * cols + spacingBetweenCols * (cols - 1);

      if (totalWidthNeeded <= contentWidth) {
        optimalColumns = cols;
        break;
      }
    }

    // If even 1 column doesn't fit, we'll need to truncate
    const columns = optimalColumns;

    // Step 4: Calculate actual column width
    if (columns === 1) {
      // Single column: use all available width
      return { columns: 1, colWidth: contentWidth };
    } else {
      // Multiple columns: use exact width needed + spacing
      return { columns, colWidth: colWidthNeeded };
    }
  };

  const layout = calculateLayout();
  const { columns, colWidth } = layout;
  const rows = Math.ceil(filteredModels.length / columns);
  const maxDialogWidth = isNarrow ? width : Math.floor(width * 0.8);

  const move = (delta: number) => {
    if (filteredModels.length === 0) return;
    let next = index + delta;
    if (next < 0) next = 0;
    if (next >= filteredModels.length) next = filteredModels.length - 1;
    setIndex(next);
  };

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (isSearching && searchTerm.length > 0) {
          setSearchTerm('');
        } else {
          return onClose();
        }
      }

      if (isSearching) {
        if (key.name === 'return') {
          if (filteredModels.length > 0) {
            setIsSearching(false);
          }
        } else if (
          key.name === 'tab' ||
          (key.name === 'down' && searchTerm.length === 0)
        ) {
          setIsSearching(false);
        } else if (key.name === 'backspace' || key.name === 'delete') {
          setSearchTerm((prev) => prev.slice(0, -1));
        } else if (
          key.sequence &&
          typeof key.sequence === 'string' &&
          !key.ctrl &&
          !key.meta &&
          key.sequence.length === 1
        ) {
          setSearchTerm((prev) => prev + key.sequence);
        }
      } else {
        if (key.name === 'return' && filteredModels.length > 0) {
          return onSelect(filteredModels[index].id);
        }
        if (key.name === 'tab' || (key.name === 'up' && index === 0)) {
          setIsSearching(true);
          return;
        }
        if (key.name === 'left') move(-1);
        if (key.name === 'right') move(1);
        if (key.name === 'up') move(-columns);
        if (key.name === 'down') move(columns);
      }
    },
    { isActive: true },
  );

  const renderItem = (m: IModel, i: number, isLastInRow: boolean) => {
    const selected = i === index;
    // Calculate display name - truncate from start to preserve model name
    let displayName: string;
    const maxLength = colWidth - 3; // Account for marker and space

    if (m.id.length > maxLength) {
      // Truncate from start to preserve the important model name at the end
      displayName = truncateStart(m.id, maxLength);
    } else {
      displayName = m.id;
    }

    return (
      <Box key={m.id} width={colWidth} marginRight={isLastInRow ? 0 : 1}>
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

  // Calculate visible items for scrolling (limit to reasonable amount)
  const maxVisibleRows = Math.min(rows, 10);
  const currentRow = Math.floor(index / columns);
  const scrollOffset = Math.max(
    0,
    Math.min(
      currentRow - Math.floor(maxVisibleRows / 2),
      rows - maxVisibleRows,
    ),
  );

  const startIndex = scrollOffset * columns;
  const endIndex = Math.min(
    startIndex + maxVisibleRows * columns,
    filteredModels.length,
  );
  const visibleModels = filteredModels.slice(startIndex, endIndex);

  // Create the model grid with proper row/column layout
  const renderModelGrid = () => {
    const gridRows = [];
    for (let row = 0; row < maxVisibleRows; row++) {
      const rowItems = [];
      for (let col = 0; col < columns; col++) {
        const idx = row * columns + col;
        if (idx < visibleModels.length) {
          const isLastInRow = col === columns - 1;
          rowItems.push(
            renderItem(visibleModels[idx], startIndex + idx, isLastInRow),
          );
        }
      }
      if (rowItems.length > 0) {
        gridRows.push(
          <Box key={row} flexDirection="row">
            {rowItems}
          </Box>,
        );
      }
    }
    return <Box flexDirection="column">{gridRows}</Box>;
  };

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
            renderModelGrid()
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
          renderModelGrid()
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
      width={maxDialogWidth} // Responsive width based on screen size
    >
      {renderContent()}
    </Box>
  );
};
