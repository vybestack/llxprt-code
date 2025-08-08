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

    // Step 1: Get actual content width (dialog is constrained to 120)
    const contentWidth = Math.min(width, 120) - 4; // 4 for padding/borders

    // Step 2: Calculate minimum column width needed
    // In wide mode, be more flexible to allow for better space utilization
    const baseMinColWidth = longestModelName + 3; // for "● " or "○ " marker
    const minColWidth = isWide ? Math.min(baseMinColWidth, 45) : baseMinColWidth;

    // Step 3: Determine column count
    const maxDesiredCols = isNarrow ? 1 : 3;
    let columns = 1;
    
    for (let cols = maxDesiredCols; cols >= 1; cols--) {
      const totalWidth = (minColWidth * cols) + ((cols - 1) * 2); // 2 spaces between columns
      if (totalWidth <= contentWidth) {
        columns = cols;
        break;
      }
    }

    // Step 4: Calculate actual column width for even distribution
    const availableWidth = contentWidth - ((columns - 1) * 2);
    const colWidth = Math.floor(availableWidth / columns);

    // Force reasonable column width limits to ensure truncation in standard mode
    // But don't constrain in wide mode where we want to show full names
    let finalColWidth = colWidth;
    if (!isWide) {
      const maxReasonableColWidth = contentWidth < 100 ? 35 : 50;
      finalColWidth = Math.min(colWidth, maxReasonableColWidth);
    }

    return { columns, colWidth: finalColWidth };
  };

  const layout = calculateLayout();
  const { columns, colWidth } = layout;
  const rows = Math.ceil(filteredModels.length / columns);
  const contentWidth = Math.min(width, 120) - 4; // Same as used in calculateLayout

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
    // Calculate display name based on breakpoint
    let displayName: string;
    if (isWide) {
      displayName = m.id; // No truncation in wide mode
    } else if (isNarrow) {
      displayName = m.id.length > 20 ? truncateEnd(m.id, 20) : m.id; // Truncate at 20 chars in narrow
    } else {
      // Standard mode - truncate if longer than column width allows
      const maxLength = colWidth - 3; // Account for marker and space
      displayName =
        m.id.length > maxLength ? truncateEnd(m.id, maxLength) : m.id;
    }

    return (
      <Box key={m.id} width={colWidth} flexShrink={0}>
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
  const endIndex = Math.min(startIndex + (maxVisibleRows * columns), filteredModels.length);
  const visibleModels = filteredModels.slice(startIndex, endIndex);

  // Create the model grid using single flex row that wraps
  const renderModelGrid = () => (
    <Box flexDirection="row" flexWrap="wrap" width={contentWidth}>
      {visibleModels.map((model, i) => 
        renderItem(model, startIndex + i)
      )}
    </Box>
  );

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
      width={Math.min(width, 120)} // Constrain maximum width to 120 chars
    >
      {renderContent()}
    </Box>
  );
};
