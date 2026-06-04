/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

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

interface ProviderDialogViewProps {
  providers: string[];
  filteredProviders: string[];
  index: number;
  searchTerm: string;
  isSearching: boolean;
  isNarrow: boolean;
  isWide: boolean;
  width: number;
  columns: number;
  colWidth: number;
}

interface ProviderDialogController {
  viewProps: ProviderDialogViewProps;
  onKeypress: (key: {
    name?: string;
    sequence?: string;
    ctrl?: boolean;
    meta?: boolean;
  }) => void;
}

interface ProviderDialogKeypressState {
  filteredProviders: string[];
  index: number;
  searchTerm: string;
  isSearching: boolean;
  isNarrow: boolean;
  columns: number;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>;
  move: (delta: number) => void;
  onSelect: (providerName: string) => void;
  onClose: () => void;
}

function ProviderSearchHeader({
  searchTerm,
  isSearching,
  filteredCount,
  totalCount,
}: {
  searchTerm: string;
  isSearching: boolean;
  filteredCount: number;
  totalCount: number;
}) {
  return (
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
          (Found {filteredCount} of {totalCount} providers)
        </Text>
      )}
    </Box>
  );
}

function ProviderListItem({
  name,
  selected,
  isSearching,
  isNarrow,
  isWide,
  colWidth,
}: {
  name: string;
  selected: boolean;
  isSearching: boolean;
  isNarrow: boolean;
  isWide: boolean;
  colWidth: number;
}) {
  const displayName = isWide
    ? name
    : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      name.length > 20
      ? truncateEnd(name, 20)
      : name;

  return (
    <Box key={name} width={isWide ? undefined : colWidth} marginRight={2}>
      <Text
        color={
          selected
            ? SemanticColors.text.accent
            : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
              isSearching && !isNarrow
              ? SemanticColors.text.secondary
              : SemanticColors.text.primary
        }
      >
        {selected ? '● ' : '○ '}
        {displayName}
      </Text>
    </Box>
  );
}

function ProviderGrid({
  filteredProviders,
  index,
  isSearching,
  isNarrow,
  isWide,
  columns,
  colWidth,
}: Pick<
  ProviderDialogViewProps,
  | 'filteredProviders'
  | 'index'
  | 'isSearching'
  | 'isNarrow'
  | 'isWide'
  | 'columns'
  | 'colWidth'
>) {
  const rows = Math.ceil(filteredProviders.length / columns);
  const grid: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const rowItems = [] as React.ReactNode[];
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (i < filteredProviders.length) {
        rowItems.push(
          <ProviderListItem
            key={filteredProviders[i]}
            name={filteredProviders[i]}
            selected={i === index && (!isSearching || isNarrow)}
            isSearching={isSearching}
            isNarrow={isNarrow}
            isWide={isWide}
            colWidth={colWidth}
          />,
        );
      }
    }
    grid.push(<Box key={r}>{rowItems}</Box>);
  }
  return <>{grid}</>;
}

function ProviderResults({
  filteredProviders,
  searchTerm,
  ...gridProps
}: Pick<ProviderDialogViewProps, 'filteredProviders' | 'searchTerm'> &
  Pick<
    ProviderDialogViewProps,
    'index' | 'isSearching' | 'isNarrow' | 'isWide' | 'columns' | 'colWidth'
  >) {
  if (filteredProviders.length === 0) {
    return (
      <Box marginY={1}>
        <Text color={SemanticColors.text.secondary}>
          No providers match &quot;{searchTerm}&quot;
        </Text>
      </Box>
    );
  }

  return <ProviderGrid filteredProviders={filteredProviders} {...gridProps} />;
}

function NarrowProviderDialogContent(props: ProviderDialogViewProps) {
  const { filteredProviders, searchTerm } = props;
  return (
    <Box flexDirection="column">
      <Text bold color={SemanticColors.text.primary}>
        Select Provider
      </Text>
      <Box marginY={1}>
        <Text color={SemanticColors.text.primary}>
          Search: <Text color={SemanticColors.text.accent}>▌</Text>
        </Text>
        <Text color={SemanticColors.text.primary}>{searchTerm}</Text>
      </Box>
      <Text color={SemanticColors.text.secondary}>
        Type to filter, Enter to select, Esc to cancel
      </Text>
      <Text color={SemanticColors.text.secondary}>
        {filteredProviders.length} providers{searchTerm && ` found`}
      </Text>
      <ProviderResults {...props} />
    </Box>
  );
}

function WideProviderDialogContent(props: ProviderDialogViewProps) {
  const { providers, filteredProviders, index, searchTerm, isSearching } =
    props;
  return (
    <Box flexDirection="column">
      <Text bold color={SemanticColors.text.primary}>
        {isSearching
          ? 'Search Providers'
          : 'Select Provider (←/→/↑/↓, Enter to choose, Esc to cancel)'}
      </Text>
      <ProviderSearchHeader
        searchTerm={searchTerm}
        isSearching={isSearching}
        filteredCount={filteredProviders.length}
        totalCount={providers.length}
      />
      <ProviderResults {...props} />
      {filteredProviders.length > 0 && !isSearching && (
        <Text color={SemanticColors.text.secondary}>
          Selected: {filteredProviders[index]}
        </Text>
      )}
      <Text color={SemanticColors.text.secondary}>Tab to switch modes</Text>
    </Box>
  );
}

function ProviderDialogContent(props: ProviderDialogViewProps) {
  return props.isNarrow ? (
    <NarrowProviderDialogContent {...props} />
  ) : (
    <WideProviderDialogContent {...props} />
  );
}

function ProviderDialogFrame(props: ProviderDialogViewProps) {
  return props.isNarrow ? (
    <Box flexDirection="column" padding={1}>
      <ProviderDialogContent {...props} />
    </Box>
  ) : (
    <Box
      borderStyle="round"
      borderColor={SemanticColors.border.default}
      flexDirection="column"
      padding={1}
      width={Math.min(props.width, 100)}
    >
      <ProviderDialogContent {...props} />
    </Box>
  );
}

function createProviderDialogKeypressHandler({
  filteredProviders,
  index,
  searchTerm,
  isSearching,
  isNarrow,
  columns,
  setSearchTerm,
  setIsSearching,
  move,
  onSelect,
  onClose,
}: ProviderDialogKeypressState) {
  return (key: {
    name?: string;
    sequence?: string;
    ctrl?: boolean;
    meta?: boolean;
  }) => {
    if (key.name === 'escape') {
      if (isSearching && searchTerm.length > 0) setSearchTerm('');
      else onClose();
      return;
    }

    if (isSearching || isNarrow) {
      if (key.name === 'return' && filteredProviders.length > 0) {
        if (isNarrow) {
          onSelect(filteredProviders[index]);
          return;
        }
        setIsSearching(false);
      } else if (key.name === 'tab' && !isNarrow) setIsSearching(false);
      else if (key.name === 'backspace' || key.name === 'delete') {
        setSearchTerm((prev) => prev.slice(0, -1));
      } else if (isPrintableKeypress(key)) {
        setSearchTerm((prev) => prev + key.sequence);
      }
      return;
    }

    if (key.name === 'return' && filteredProviders.length > 0) {
      onSelect(filteredProviders[index]);
      return;
    }
    if (key.name === 'tab') setIsSearching(true);
    if (filteredProviders.length === 0) return;
    if (key.name === 'left') move(-1);
    if (key.name === 'right') move(1);
    if (key.name === 'up') move(-columns);
    if (key.name === 'down') move(columns);
  };
}

function useProviderDialogController({
  providers,
  currentProvider,
  onSelect,
  onClose,
}: ProviderDialogProps): ProviderDialogController {
  const { isNarrow, isWide, width } = useResponsive();
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(isNarrow);

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

  React.useEffect(() => {
    if (searchTerm.length === 0) {
      const currentIndex = providers.findIndex((p) => p === currentProvider);
      setIndex(Math.max(0, currentIndex));
    } else {
      setIndex(0);
    }
  }, [searchTerm, providers, currentProvider]);

  const columns = isNarrow ? 1 : 3;
  const longest = filteredProviders.reduce(
    (len, p) => Math.max(len, p.length),
    0,
  );
  const colWidth = isWide
    ? Math.max(longest + 4, 30)
    : Math.max(longest + 4, 20);

  const move = (delta: number) => {
    let next = index + delta;
    if (next < 0) next = 0;
    if (next >= filteredProviders.length) next = filteredProviders.length - 1;
    setIndex(next);
  };

  const onKeypress = createProviderDialogKeypressHandler({
    filteredProviders,
    index,
    searchTerm,
    isSearching,
    isNarrow,
    columns,
    setSearchTerm,
    setIsSearching,
    move,
    onSelect,
    onClose,
  });

  return {
    onKeypress,
    viewProps: {
      providers,
      filteredProviders,
      index,
      searchTerm,
      isSearching,
      isNarrow,
      isWide,
      width,
      columns,
      colWidth,
    },
  };
}

export const ProviderDialog: React.FC<ProviderDialogProps> = (props) => {
  const { viewProps, onKeypress } = useProviderDialogController(props);
  useKeypress(onKeypress, { isActive: true });

  return <ProviderDialogFrame {...viewProps} />;
};

function isPrintableKeypress(key: {
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
}) {
  if (key.sequence === undefined) return false;
  if (typeof key.sequence !== 'string') return false;
  if (key.ctrl === true || key.meta === true) return false;
  return key.sequence.length === 1;
}
