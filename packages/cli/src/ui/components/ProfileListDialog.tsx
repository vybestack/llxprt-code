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

export interface ProfileListItem {
  name: string;
  type: 'standard' | 'loadbalancer';
  provider?: string;
  model?: string;
  isDefault?: boolean;
  isActive?: boolean;
  loadError?: boolean;
}

interface ProfileListDialogProps {
  profiles: ProfileListItem[];
  onSelect: (profileName: string) => void;
  onClose: () => void;
  onViewDetail: (profileName: string) => void;
  isLoading?: boolean;
  defaultProfileName?: string;
  activeProfileName?: string;
}

export const ProfileListDialog: React.FC<ProfileListDialogProps> = ({
  profiles,
  onSelect,
  onClose,
  onViewDetail,
  isLoading = false,
  defaultProfileName,
  activeProfileName,
}) => {
  const { isNarrow, isWide, width } = useResponsive();
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(true); // Start in search mode
  const [index, setIndex] = useState(0);

  // Filter profiles based on search term
  const filteredProfiles = useMemo(
    () =>
      profiles.filter((p) =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [profiles, searchTerm],
  );

  // Reset index when search term changes
  React.useEffect(() => {
    setIndex(0);
  }, [searchTerm]);

  // Clamp index when the underlying list changes.
  React.useEffect(() => {
    setIndex((prev) => {
      if (filteredProfiles.length === 0) return 0;
      return Math.min(prev, filteredProfiles.length - 1);
    });
  }, [filteredProfiles.length]);

  const columns = isNarrow ? 1 : isWide ? 3 : 2;
  const longest = filteredProfiles.reduce(
    (len, p) => Math.max(len, p.name.length + 10), // account for indicators
    0,
  );
  const colWidth = isWide
    ? Math.max(longest + 4, 35)
    : Math.max(longest + 4, 25);
  const rows = Math.ceil(filteredProfiles.length / columns);

  const move = (delta: number) => {
    if (filteredProfiles.length === 0) {
      setIndex(0);
      return;
    }
    let next = index + delta;
    if (next < 0) next = 0;
    if (next >= filteredProfiles.length) next = filteredProfiles.length - 1;
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
          if (filteredProfiles.length > 0) {
            if (isNarrow) {
              return onViewDetail(filteredProfiles[index].name);
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
        // Navigation mode
        if (key.name === 'return' && filteredProfiles.length > 0) {
          return onViewDetail(filteredProfiles[index].name);
        }
        if (key.name === 'tab') {
          setIsSearching(true);
        }
        if (filteredProfiles.length === 0) {
          return;
        }
        // Quick actions
        if (key.sequence === 'l' && filteredProfiles.length > 0) {
          return onSelect(filteredProfiles[index].name);
        }
        // Navigation
        if (key.name === 'left') move(-1);
        if (key.name === 'right') move(1);
        if (key.name === 'up') move(-columns);
        if (key.name === 'down') move(columns);
        // Vim-style navigation
        if (key.sequence === 'j') move(columns);
        if (key.sequence === 'k') move(-columns);
        if (key.sequence === 'h') move(-1);
      }
    },
    { isActive: !isLoading },
  );

  const renderItem = (profile: ProfileListItem, i: number) => {
    const selected = i === index && (!isSearching || isNarrow);
    const isActiveProfile = profile.name === activeProfileName;
    const isDefaultProfile = profile.name === defaultProfileName;

    // Build indicators
    let indicators = '';
    if (isActiveProfile) indicators += '*';
    if (isDefaultProfile) indicators += 'D';
    if (profile.type === 'loadbalancer') indicators += 'LB';

    const indicatorText = indicators ? ` [${indicators}]` : '';

    // Truncate name if needed
    const maxNameLen = colWidth - 6 - indicatorText.length;
    const displayName = isWide
      ? profile.name
      : profile.name.length > maxNameLen
        ? truncateEnd(profile.name, maxNameLen)
        : profile.name;

    return (
      <Box
        key={profile.name}
        width={isWide ? undefined : colWidth}
        marginRight={2}
      >
        <Text
          color={
            selected
              ? SemanticColors.text.accent
              : isSearching && !isNarrow
                ? SemanticColors.text.secondary
                : isActiveProfile
                  ? SemanticColors.status.success
                  : SemanticColors.text.primary
          }
        >
          {selected ? '● ' : '○ '}
          {displayName}
          {indicatorText && (
            <Text color={SemanticColors.text.secondary}>{indicatorText}</Text>
          )}
        </Text>
      </Box>
    );
  };

  const grid: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const rowItems: React.ReactNode[] = [];
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (i < filteredProfiles.length) {
        rowItems.push(renderItem(filteredProfiles[i], i));
      }
    }
    grid.push(<Box key={r}>{rowItems}</Box>);
  }

  if (isLoading) {
    return (
      <Box
        borderStyle="round"
        borderColor={SemanticColors.border.default}
        flexDirection="column"
        padding={1}
      >
        <Text color={SemanticColors.text.primary}>Loading profiles...</Text>
      </Box>
    );
  }

  if (profiles.length === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor={SemanticColors.border.default}
        flexDirection="column"
        padding={1}
      >
        <Text color={SemanticColors.text.primary}>
          No saved profiles found. Use /profile save model &lt;name&gt; to
          create one.
        </Text>
        <Text color={SemanticColors.text.secondary}>Press Esc to close</Text>
      </Box>
    );
  }

  const renderContent = () => {
    if (isNarrow) {
      return (
        <Box flexDirection="column">
          <Text bold color={SemanticColors.text.primary}>
            Profiles
          </Text>

          {/* Search input */}
          <Box marginY={1}>
            <Text color={SemanticColors.text.primary}>
              Search: <Text color={SemanticColors.text.accent}>▌</Text>
            </Text>
            <Text color={SemanticColors.text.primary}>{searchTerm}</Text>
          </Box>

          <Text color={SemanticColors.text.secondary}>
            Type to filter, Enter for details, Esc to cancel
          </Text>

          {/* Profile count */}
          <Text color={SemanticColors.text.secondary}>
            {filteredProfiles.length} profiles{searchTerm && ' found'}
          </Text>

          {/* Results */}
          {filteredProfiles.length > 0 ? (
            grid
          ) : (
            <Box marginY={1}>
              <Text color={SemanticColors.text.secondary}>
                No profiles match &quot;{searchTerm}&quot;
              </Text>
            </Box>
          )}
        </Box>
      );
    }

    return (
      <Box flexDirection="column">
        {/* Title */}
        <Text bold color={SemanticColors.text.primary}>
          Profile List
        </Text>

        {/* Search */}
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
          <Text color={SemanticColors.text.secondary}>
            {' '}
            (press Tab to {isSearching ? 'navigate' : 'search'}) Found{' '}
            {filteredProfiles.length} profiles
          </Text>
        </Box>

        {/* Body - Grid results */}
        {filteredProfiles.length > 0 ? (
          grid
        ) : (
          <Box marginY={1}>
            <Text color={SemanticColors.text.secondary}>
              No profiles match &quot;{searchTerm}&quot;
            </Text>
          </Box>
        )}

        {/* Current selection */}
        {filteredProfiles.length > 0 && !isSearching && (
          <Box marginTop={1}>
            <Text color={SemanticColors.text.secondary}>
              Selected: {filteredProfiles[index].name}
              {filteredProfiles[index].provider && (
                <Text color={SemanticColors.text.secondary}>
                  {' '}
                  ({filteredProfiles[index].provider}
                  {filteredProfiles[index].model &&
                    ` / ${filteredProfiles[index].model}`}
                  )
                </Text>
              )}
            </Text>
          </Box>
        )}

        {/* Legend */}
        <Box marginTop={1}>
          <Text color={SemanticColors.text.secondary}>
            Legend: * = active, D = default, LB = load balancer
          </Text>
        </Box>

        {/* Space */}
        <Box marginTop={1} />

        {/* Controls */}
        <Text color={SemanticColors.text.secondary}>
          Controls: ↑↓←→ Navigate [Enter] Details [l] Load [Esc] Close
        </Text>
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
      width={Math.min(width, 100)}
    >
      {renderContent()}
    </Box>
  );
};
