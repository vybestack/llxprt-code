/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { ListFocusMode, type SubagentInfo } from './types.js';

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
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter subagents based on search term
  const filteredSubagents = useMemo(() => {
    if (!searchTerm.trim()) return subagents;
    const term = searchTerm.toLowerCase();
    return subagents.filter(
      (s) =>
        s.name.toLowerCase().includes(term) ||
        s.profile.toLowerCase().includes(term),
    );
  }, [subagents, searchTerm]);

  // Ensure selected index is valid after filtering
  const safeIndex = useMemo(() => {
    if (filteredSubagents.length === 0) return 0;
    return Math.min(selectedIndex, filteredSubagents.length - 1);
  }, [selectedIndex, filteredSubagents.length]);

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

  const handleSearchInput = useCallback((char: string) => {
    setSearchTerm((prev) => prev + char);
  }, []);

  const handleBackspace = useCallback(() => {
    setSearchTerm((prev) => prev.slice(0, -1));
  }, []);

  useKeypress(
    (key) => {
      const input = key.sequence;

      // ESC handling
      if (key.name === 'escape') {
        if (focusMode === ListFocusMode.SEARCH && searchTerm) {
          // Clear search
          setSearchTerm('');
          setFocusMode(ListFocusMode.LIST);
        } else if (focusMode === ListFocusMode.SEARCH) {
          // Exit search mode
          setFocusMode(ListFocusMode.LIST);
        } else {
          // Back to menu
          onBack();
        }
        return;
      }

      // Tab to activate search
      if (key.name === 'tab' && focusMode === ListFocusMode.LIST) {
        setFocusMode(ListFocusMode.SEARCH);
        return;
      }

      // Tab to switch focus
      if (key.name === 'tab' && focusMode === ListFocusMode.SEARCH) {
        setFocusMode(ListFocusMode.LIST);
        return;
      }

      // Search mode input handling
      if (focusMode === ListFocusMode.SEARCH) {
        if (key.name === 'backspace' || key.name === 'delete') {
          handleBackspace();
          return;
        }
        if (key.name === 'return') {
          setFocusMode(ListFocusMode.LIST);
          return;
        }
        // Type character
        if (input && input.length === 1 && !key.ctrl && !key.meta) {
          handleSearchInput(input);
        }
        return;
      }

      // List navigation mode
      if (focusMode === ListFocusMode.LIST) {
        if (key.name === 'up') {
          moveSelection(-1);
          return;
        }
        if (key.name === 'down') {
          moveSelection(1);
          return;
        }
        if (key.name === 'return' && filteredSubagents.length > 0) {
          onSelect(filteredSubagents[safeIndex]);
          return;
        }
        // Quick actions
        if (input === 'e' && filteredSubagents.length > 0) {
          onEdit(filteredSubagents[safeIndex]);
          return;
        }
        if (input === 'a' && filteredSubagents.length > 0) {
          onAttachProfile(filteredSubagents[safeIndex]);
          return;
        }
        if (input === 'd' && filteredSubagents.length > 0) {
          onDelete(filteredSubagents[safeIndex]);
          return;
        }
      }
    },
    { isActive: isFocused && !isLoading },
  );

  if (isLoading) {
    return (
      <Box flexDirection="column">
        <Text color={Colors.Gray}>Loading subagents...</Text>
      </Box>
    );
  }

  if (subagents.length === 0) {
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

  // Calculate visible items (viewport)
  const maxVisible = 10;
  const startIndex = Math.max(0, safeIndex - Math.floor(maxVisible / 2));
  const endIndex = Math.min(filteredSubagents.length, startIndex + maxVisible);
  const visibleSubagents = filteredSubagents.slice(startIndex, endIndex);

  return (
    <Box flexDirection="column">
      {/* Search bar */}
      <Box marginBottom={1}>
        <Text color={Colors.Gray}>Search: </Text>
        {focusMode === ListFocusMode.SEARCH ? (
          <Text color={Colors.Foreground}>
            {searchTerm}
            <Text color="#00ff00">|</Text>
          </Text>
        ) : (
          <Text color={Colors.Gray}>
            {searchTerm || '(press Tab to search)'}
          </Text>
        )}
        <Text color={Colors.Gray}>
          {' '}
          Found {filteredSubagents.length}
          {searchTerm ? ` of ${subagents.length}` : ''} subagents
        </Text>
      </Box>

      {/* Subagent list */}
      <Box flexDirection="column" marginBottom={1}>
        {filteredSubagents.length === 0 ? (
          <Text color={Colors.Gray}>No matching subagents</Text>
        ) : (
          visibleSubagents.map((subagent, idx) => {
            const actualIndex = startIndex + idx;
            const isSelected =
              actualIndex === safeIndex && focusMode === ListFocusMode.LIST;
            return (
              <Box key={subagent.name}>
                <Text color={isSelected ? '#00ff00' : Colors.Foreground}>
                  {isSelected ? '→ ' : '  '}
                  {subagent.name.padEnd(25)}
                </Text>
                <Text color={Colors.Gray}>{subagent.profile}</Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* Controls */}
      <Box flexDirection="column">
        <Text color={Colors.Gray}>
          Controls: ↑↓ Navigate [Enter] Details [e] Edit
        </Text>
        <Text color={Colors.Gray}> [a] Attach [d] Delete [ESC] Main menu</Text>
      </Box>
    </Box>
  );
};
