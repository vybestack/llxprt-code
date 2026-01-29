/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { truncateEnd } from '../utils/responsive.js';
import { useKeypress } from '../hooks/useKeypress.js';

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
  const { isNarrow, isWide, width } = useResponsive();
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(isNarrow);

  // Filter providers based on search term
  const filteredProviders = useMemo(
    () =>
      providers.filter((p) =>
        p.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [providers, searchTerm],
  );

  const [index, setIndex] = useState(() => {
    const currentIndex = providers.findIndex((p) => p === currentProvider);
    return Math.max(0, currentIndex);
  });

  // Reset index when search term changes
  React.useEffect(() => {
    if (searchTerm.length === 0) {
      const currentIndex = providers.findIndex((p) => p === currentProvider);
      setIndex(Math.max(0, currentIndex));
    } else {
      setIndex(0);
    }
  }, [searchTerm, providers, currentProvider]);

  // Responsive layout calculations
  const columns = isNarrow ? 1 : 3;
  const longest = filteredProviders.reduce(
    (len, p) => Math.max(len, p.length),
    0,
  );
  const colWidth = isWide
    ? Math.max(longest + 4, 30)
    : Math.max(longest + 4, 20);
  const rows = Math.ceil(filteredProviders.length / columns);

  const move = (delta: number) => {
    let next = index + delta;
    if (next < 0) next = 0;
    if (next >= filteredProviders.length) next = filteredProviders.length - 1;
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

      if (isSearching || isNarrow) {
        if (key.name === 'return') {
          if (filteredProviders.length > 0) {
            if (isNarrow) {
              return onSelect(filteredProviders[index]);
            }
            setIsSearching(false);
          }
        } else if (key.name === 'tab' && !isNarrow) {
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
        if (key.name === 'return' && filteredProviders.length > 0) {
          return onSelect(filteredProviders[index]);
        }
        if (key.name === 'tab') {
          setIsSearching(true);
        }
        if (filteredProviders.length === 0) {
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

  const renderItem = (name: string, i: number) => {
    const selected = i === index && (!isSearching || isNarrow);
    // In wide mode, don't truncate. In standard/narrow, truncate reasonably
    const displayName = isWide
      ? name
      : name.length > 20
        ? truncateEnd(name, 20)
        : name;

    return (
      <Box key={name} width={isWide ? undefined : colWidth} marginRight={2}>
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

  const grid: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const rowItems = [] as React.ReactNode[];
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (i < filteredProviders.length)
        rowItems.push(renderItem(filteredProviders[i], i));
    }
    grid.push(<Box key={r}>{rowItems}</Box>);
  }

  const renderContent = () => {
    if (isNarrow) {
      return (
        <Box flexDirection="column">
          <Text bold color={SemanticColors.text.primary}>
            Select Provider
          </Text>

          {/* Search input */}
          <Box marginY={1}>
            <Text color={SemanticColors.text.primary}>
              Search: <Text color={SemanticColors.text.accent}>▌</Text>
            </Text>
            <Text color={SemanticColors.text.primary}>{searchTerm}</Text>
          </Box>

          <Text color={SemanticColors.text.secondary}>
            Type to filter, Enter to select, Esc to cancel
          </Text>

          {/* Provider count for narrow */}
          <Text color={SemanticColors.text.secondary}>
            {filteredProviders.length} providers{searchTerm && ` found`}
          </Text>

          {/* Results */}
          {filteredProviders.length > 0 ? (
            grid
          ) : (
            <Box marginY={1}>
              <Text color={SemanticColors.text.secondary}>
                No providers match &quot;{searchTerm}&quot;
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
            ? 'Search Providers'
            : 'Select Provider (←/→/↑/↓, Enter to choose, Esc to cancel)'}
        </Text>

        {/* Search input for standard/wide */}
        {!isNarrow && (
          <Box marginY={1}>
            <Text
              color={
                isSearching
                  ? SemanticColors.text.primary
                  : SemanticColors.text.secondary
              }
            >
              Search:{' '}
              {isSearching && <Text color={SemanticColors.text.accent}>▌</Text>}
            </Text>
            <Text color={SemanticColors.text.primary}>{searchTerm}</Text>
            {searchTerm && (
              <Text color={SemanticColors.text.secondary}>
                {' '}
                (Found {filteredProviders.length} of {providers.length}{' '}
                providers)
              </Text>
            )}
          </Box>
        )}

        {/* Grid results */}
        {filteredProviders.length > 0 ? (
          grid
        ) : (
          <Box marginY={1}>
            <Text color={SemanticColors.text.secondary}>
              No providers match &quot;{searchTerm}&quot;
            </Text>
          </Box>
        )}

        {/* Current selection for non-searching */}
        {filteredProviders.length > 0 && !isSearching && (
          <Text color={SemanticColors.text.secondary}>
            Selected: {filteredProviders[index]}
          </Text>
        )}

        {!isNarrow && (
          <Text color={SemanticColors.text.secondary}>Tab to switch modes</Text>
        )}
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
      width={Math.min(width, 100)} // Constrain maximum width to 100 chars for provider dialog
    >
      {renderContent()}
    </Box>
  );
};
