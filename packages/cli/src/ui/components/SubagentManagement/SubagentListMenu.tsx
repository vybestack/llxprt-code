/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type React from 'react';
import { useState, useMemo, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { ListFocusMode, type SubagentInfo } from './types.js';

const isListFocusMode = (mode: ListFocusMode): boolean =>
  mode === ListFocusMode.LIST;

interface SubagentListMenuProps {
  subagents: SubagentInfo[];
  onSelect: (subagent: SubagentInfo) => void;
  onEdit: (subagent: SubagentInfo) => void;
  onAttachProfile: (subagent: SubagentInfo) => void;
  onDelete: (subagent: SubagentInfo) => void;
  onBack: () => void;
  isLoading?: boolean;
  isFocused?: boolean;
}

function useFilteredSubagents(subagents: SubagentInfo[], searchTerm: string) {
  return useMemo(() => {
    if (!searchTerm.trim()) return subagents;
    const term = searchTerm.toLowerCase();
    return subagents.filter(
      (s) =>
        s.name.toLowerCase().includes(term) ||
        s.profile.toLowerCase().includes(term),
    );
  }, [subagents, searchTerm]);
}

function useSafeIndex(selectedIndex: number, filteredLength: number) {
  return useMemo(() => {
    if (filteredLength === 0) return 0;
    return Math.min(selectedIndex, filteredLength - 1);
  }, [selectedIndex, filteredLength]);
}

function SearchBar({
  searchTerm,
  focusMode,
  filteredCount,
  totalCount,
}: {
  searchTerm: string;
  focusMode: ListFocusMode;
  filteredCount: number;
  totalCount: number;
}) {
  return (
    <Box marginBottom={1}>
      <Text color={Colors.Gray}>Search: </Text>
      {focusMode === ListFocusMode.SEARCH ? (
        <Text color={Colors.Foreground}>
          {searchTerm}
          <Text color="#00ff00">|</Text>
        </Text>
      ) : (
        <Text color={Colors.Gray}>{searchTerm || '(press Tab to search)'}</Text>
      )}
      <Text color={Colors.Gray}>
        {' '}
        Found {filteredCount}
        {searchTerm ? ` of ${totalCount}` : ''} subagents
      </Text>
    </Box>
  );
}

function SubagentItemRow({
  subagent,
  isSelected,
}: {
  subagent: SubagentInfo;
  isSelected: boolean;
}) {
  return (
    <Box>
      <Text color={isSelected ? '#00ff00' : Colors.Foreground}>
        {isSelected ? '→ ' : '  '}
        {subagent.name.padEnd(25)}
      </Text>
      <Text color={Colors.Gray}>{subagent.profile}</Text>
    </Box>
  );
}

function SubagentListViewport({
  filteredSubagents,
  safeIndex,
  focusMode,
}: {
  filteredSubagents: SubagentInfo[];
  safeIndex: number;
  focusMode: ListFocusMode;
}) {
  const maxVisible = 10;
  const viewStart = Math.max(0, safeIndex - Math.floor(maxVisible / 2));
  const viewEnd = Math.min(filteredSubagents.length, viewStart + maxVisible);
  const visibleSubagents = filteredSubagents.slice(viewStart, viewEnd);

  if (filteredSubagents.length === 0) {
    return <Text color={Colors.Gray}>No matching subagents</Text>;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {visibleSubagents.map((subagent, idx) => {
        const actualIndex = viewStart + idx;
        const isSelected =
          actualIndex === safeIndex && isListFocusMode(focusMode);
        return (
          <SubagentItemRow
            key={subagent.name}
            subagent={subagent}
            isSelected={isSelected}
          />
        );
      })}
    </Box>
  );
}

function EmptySubagentsMessage() {
  return (
    <Box flexDirection="column">
      <Text color={Colors.Foreground}>
        No subagents found. Use &apos;Create Subagent&apos; to create one.
      </Text>
      <Box marginTop={1}>
        <Text color={Colors.Gray}>[ESC] Back to menu</Text>
      </Box>
    </Box>
  );
}

function useSearchKeys(opts: {
  isFocused: boolean;
  isLoading: boolean;
  focusMode: ListFocusMode;
  handleSearchInput: (char: string) => void;
  handleBackspace: () => void;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  setFocusMode: React.Dispatch<React.SetStateAction<ListFocusMode>>;
}) {
  useKeypress(
    (key) => {
      if (
        !opts.isFocused ||
        opts.isLoading ||
        opts.focusMode !== ListFocusMode.SEARCH
      )
        return;
      if (key.name === 'backspace' || key.name === 'delete') {
        opts.handleBackspace();
        return;
      }
      if (key.name === 'return') {
        opts.setFocusMode(ListFocusMode.LIST);
        return;
      }
      if (key.name === 'escape') {
        opts.setSearchTerm('');
        opts.setFocusMode(ListFocusMode.LIST);
        return;
      }
      const input = key.sequence;
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        opts.handleSearchInput(input);
      }
    },
    {
      isActive:
        opts.isFocused &&
        !opts.isLoading &&
        opts.focusMode === ListFocusMode.SEARCH,
    },
  );
}

function useListNavKeys(opts: {
  focusMode: ListFocusMode;
  filteredSubagents: SubagentInfo[];
  safeIndex: number;
  isFocused: boolean;
  isLoading: boolean;
  moveSelection: (d: number) => void;
  onSelect: (s: SubagentInfo) => void;
  onEdit: (s: SubagentInfo) => void;
  onAttachProfile: (s: SubagentInfo) => void;
  onDelete: (s: SubagentInfo) => void;
  onBack: () => void;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  setFocusMode: React.Dispatch<React.SetStateAction<ListFocusMode>>;
}) {
  useKeypress(
    (key) => {
      const input = key.sequence;
      if (key.name === 'escape' && opts.focusMode === ListFocusMode.LIST) {
        opts.onBack();
        return;
      }
      if (key.name === 'tab') {
        opts.setFocusMode(
          opts.focusMode === ListFocusMode.LIST
            ? ListFocusMode.SEARCH
            : ListFocusMode.LIST,
        );
        return;
      }
      if (!isListFocusMode(opts.focusMode)) return;
      if (key.name === 'up') {
        opts.moveSelection(-1);
        return;
      }
      if (key.name === 'down') {
        opts.moveSelection(1);
        return;
      }
      if (key.name === 'return' && opts.filteredSubagents.length > 0) {
        opts.onSelect(opts.filteredSubagents[opts.safeIndex]);
        return;
      }
      if (input === 'e' && opts.filteredSubagents.length > 0) {
        opts.onEdit(opts.filteredSubagents[opts.safeIndex]);
        return;
      }
      if (input === 'a' && opts.filteredSubagents.length > 0) {
        opts.onAttachProfile(opts.filteredSubagents[opts.safeIndex]);
        return;
      }
      if (input === 'd' && opts.filteredSubagents.length > 0) {
        opts.onDelete(opts.filteredSubagents[opts.safeIndex]);
      }
    },
    { isActive: opts.isFocused && !opts.isLoading },
  );
}

function useListMenuState(subagents: SubagentInfo[], searchTerm: string) {
  const filteredSubagents = useFilteredSubagents(subagents, searchTerm);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const safeIndex = useSafeIndex(selectedIndex, filteredSubagents.length);
  const moveSelection = useCallback(
    (delta: number) => {
      if (filteredSubagents.length === 0) return;
      let newIndex = safeIndex + delta;
      if (newIndex < 0) newIndex = 0;
      if (newIndex >= filteredSubagents.length)
        newIndex = filteredSubagents.length - 1;
      setSelectedIndex(newIndex);
    },
    [safeIndex, filteredSubagents.length],
  );
  return { filteredSubagents, safeIndex, moveSelection };
}

export const SubagentListMenu: React.FC<SubagentListMenuProps> = ({
  subagents,
  onSelect,
  onEdit,
  onAttachProfile,
  onDelete,
  onBack,
  isLoading = false,
  isFocused = true,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [focusMode, setFocusMode] = useState<ListFocusMode>(ListFocusMode.LIST);
  const { filteredSubagents, safeIndex, moveSelection } = useListMenuState(
    subagents,
    searchTerm,
  );

  const handleSearchInput = useCallback((char: string) => {
    setSearchTerm((prev) => prev + char);
  }, []);
  const handleBackspace = useCallback(() => {
    setSearchTerm((prev) => prev.slice(0, -1));
  }, []);

  useSearchKeys({
    isFocused,
    isLoading,

    focusMode,
    handleSearchInput,
    handleBackspace,
    setSearchTerm,
    setFocusMode,
  });
  useListNavKeys({
    focusMode,
    filteredSubagents,
    safeIndex,
    isFocused,
    isLoading,
    moveSelection,
    onSelect,
    onEdit,
    onAttachProfile,
    onDelete,
    onBack,
    setSearchTerm,
    setFocusMode,
  });

  if (isLoading) {
    return (
      <Box flexDirection="column">
        <Text color={Colors.Gray}>Loading subagents...</Text>
      </Box>
    );
  }
  if (subagents.length === 0) {
    return <EmptySubagentsMessage />;
  }

  return (
    <Box flexDirection="column">
      <SearchBar
        searchTerm={searchTerm}
        focusMode={focusMode}
        filteredCount={filteredSubagents.length}
        totalCount={subagents.length}
      />
      <SubagentListViewport
        filteredSubagents={filteredSubagents}
        safeIndex={safeIndex}
        focusMode={focusMode}
      />
      <Box flexDirection="column">
        <Text color={Colors.Gray}>
          Controls: ↑↓ Navigate [Enter] Details [e] Edit
        </Text>
        <Text color={Colors.Gray}> [a] Attach [d] Delete [ESC] Main menu</Text>
      </Box>
    </Box>
  );
};
