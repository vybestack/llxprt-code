/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type React from 'react';
import { useState, useMemo, useCallback, useEffect } from 'react';
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

const ProfileItem: React.FC<{
  profile: ProfileListItem;
  index: number;
  selectedIndex: number;
  isSearching: boolean;
  isNarrow: boolean;
  isWide: boolean;
  activeProfileName?: string;
  defaultProfileName?: string;
  colWidth: number;
}> = ({
  profile,
  index,
  selectedIndex,
  isSearching,
  isNarrow,
  isWide,
  activeProfileName,
  defaultProfileName,
  colWidth,
}) => {
  const selected = index === selectedIndex && (!isSearching || isNarrow);
  const isActiveProfile = profile.name === activeProfileName;
  const isDefaultProfile = profile.name === defaultProfileName;

  let indicators = '';
  if (isActiveProfile) indicators += '*';
  if (isDefaultProfile) indicators += 'D';
  if (profile.type === 'loadbalancer') indicators += 'LB';

  const indicatorText = indicators ? ` [${indicators}]` : '';

  const maxNameLen = colWidth - 6 - indicatorText.length;
  const displayName = isWide
    ? profile.name
    : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      profile.name.length > maxNameLen
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
          // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          selected
            ? SemanticColors.text.accent
            : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
              isSearching && !isNarrow
              ? SemanticColors.text.secondary
              : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
                isActiveProfile
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

function handleSearchModeKeys(
  key: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean },
  isNarrow: boolean,
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>,
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>,
  onViewDetail: (name: string) => void,
  selectedIndex: number,
  filteredProfiles: ProfileListItem[],
): void {
  if (key.name === 'return') {
    if (filteredProfiles.length > 0) {
      if (isNarrow) {
        onViewDetail(filteredProfiles[selectedIndex].name);
        return;
      }
      setIsSearching(false);
    }
    return;
  }
  if (key.name === 'tab' && !isNarrow) {
    setIsSearching(false);
    return;
  }
  if (key.name === 'backspace' || key.name === 'delete') {
    setSearchTerm((prev) => prev.slice(0, -1));
    return;
  }
  if (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    key.sequence != null &&
    typeof key.sequence === 'string' &&
    key.ctrl !== true &&
    key.meta !== true &&
    key.sequence.length === 1
  ) {
    setSearchTerm((prev) => prev + key.sequence);
  }
}

function handleNavModeKeys(
  key: { name?: string; sequence?: string },
  filteredProfiles: ProfileListItem[],
  index: number,
  move: (delta: number) => void,
  onViewDetail: (name: string) => void,
  onSelect: (name: string) => void,
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>,
  columns: number,
): void {
  if (key.name === 'return' && filteredProfiles.length > 0) {
    onViewDetail(filteredProfiles[index].name);
    return;
  }
  if (key.name === 'tab') {
    setIsSearching(true);
    return;
  }
  if (filteredProfiles.length === 0) return;
  if (key.sequence === 'l' && filteredProfiles.length > 0) {
    onSelect(filteredProfiles[index].name);
    return;
  }
  if (key.name === 'left') move(-1);
  else if (key.name === 'right') move(1);
  else if (key.name === 'up') move(-columns);
  else if (key.name === 'down') move(columns);
  else if (key.sequence === 'j') move(columns);
  else if (key.sequence === 'k') move(-columns);
  else if (key.sequence === 'h') move(-1);
}

const NarrowContent: React.FC<{
  searchTerm: string;
  filteredProfiles: ProfileListItem[];
  grid: React.ReactNode[];
}> = ({ searchTerm, filteredProfiles, grid }) => (
  <Box flexDirection="column">
    <Text bold color={SemanticColors.text.primary}>
      Profiles
    </Text>

    <Box marginY={1}>
      <Text color={SemanticColors.text.primary}>
        Search: <Text color={SemanticColors.text.accent}>▌</Text>
      </Text>
      <Text color={SemanticColors.text.primary}>{searchTerm}</Text>
    </Box>

    <Text color={SemanticColors.text.secondary}>
      Type to filter, Enter for details, Esc to cancel
    </Text>

    <Text color={SemanticColors.text.secondary}>
      {filteredProfiles.length} profiles{searchTerm && ' found'}
    </Text>

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

const WideSearchBar: React.FC<{
  isSearching: boolean;
  searchTerm: string;
  filteredProfiles: ProfileListItem[];
}> = ({ isSearching, searchTerm, filteredProfiles }) => (
  <Box marginY={1}>
    <Text
      color={
        isSearching
          ? SemanticColors.text.primary
          : SemanticColors.text.secondary
      }
    >
      Search: {isSearching && <Text color={SemanticColors.text.accent}>▌</Text>}
    </Text>
    <Text color={SemanticColors.text.primary}>{searchTerm}</Text>
    <Text color={SemanticColors.text.secondary}>
      {' '}
      (press Tab to {isSearching ? 'navigate' : 'search'}) Found{' '}
      {filteredProfiles.length} profiles
    </Text>
  </Box>
);

const WideSelectionDetail: React.FC<{
  filteredProfiles: ProfileListItem[];
  index: number;
  isSearching: boolean;
}> = ({ filteredProfiles, index, isSearching }) => {
  if (filteredProfiles.length === 0 || isSearching) return null;

  return (
    <Box marginTop={1}>
      <Text color={SemanticColors.text.secondary}>
        Selected: {filteredProfiles[index].name}
        {filteredProfiles[index].provider != null && (
          <Text color={SemanticColors.text.secondary}>
            {' '}
            ({filteredProfiles[index].provider}
            {filteredProfiles[index].model != null &&
              ` / ${filteredProfiles[index].model}`}
            )
          </Text>
        )}
      </Text>
    </Box>
  );
};

const WideContent: React.FC<{
  isSearching: boolean;
  searchTerm: string;
  filteredProfiles: ProfileListItem[];
  index: number;
  grid: React.ReactNode[];
}> = ({ isSearching, searchTerm, filteredProfiles, index, grid }) => (
  <Box flexDirection="column">
    <Text bold color={SemanticColors.text.primary}>
      Profile List
    </Text>

    <WideSearchBar
      isSearching={isSearching}
      searchTerm={searchTerm}
      filteredProfiles={filteredProfiles}
    />

    {filteredProfiles.length > 0 ? (
      grid
    ) : (
      <Box marginY={1}>
        <Text color={SemanticColors.text.secondary}>
          No profiles match &quot;{searchTerm}&quot;
        </Text>
      </Box>
    )}

    <WideSelectionDetail
      filteredProfiles={filteredProfiles}
      index={index}
      isSearching={isSearching}
    />

    <Box marginTop={1}>
      <Text color={SemanticColors.text.secondary}>
        Legend: * = active, D = default, LB = load balancer
      </Text>
    </Box>

    <Box marginTop={1} />

    <Text color={SemanticColors.text.secondary}>
      Controls: ↑↓←→ Navigate [Enter] Details [l] Load [Esc] Close
    </Text>
  </Box>
);

function buildGrid(
  filteredProfiles: ProfileListItem[],
  rows: number,
  columns: number,
  index: number,
  isSearching: boolean,
  isNarrow: boolean,
  isWide: boolean,
  activeProfileName: string | undefined,
  defaultProfileName: string | undefined,
  colWidth: number,
): React.ReactNode[] {
  const grid: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const rowItems: React.ReactNode[] = [];
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      if (i < filteredProfiles.length) {
        rowItems.push(
          <ProfileItem
            key={filteredProfiles[i].name}
            profile={filteredProfiles[i]}
            index={i}
            selectedIndex={index}
            isSearching={isSearching}
            isNarrow={isNarrow}
            isWide={isWide}
            activeProfileName={activeProfileName}
            defaultProfileName={defaultProfileName}
            colWidth={colWidth}
          />,
        );
      }
    }
    grid.push(<Box key={r}>{rowItems}</Box>);
  }
  return grid;
}

const LoadingState: React.FC = () => (
  <Box
    borderStyle="round"
    borderColor={SemanticColors.border.default}
    flexDirection="column"
    padding={1}
  >
    <Text color={SemanticColors.text.primary}>Loading profiles...</Text>
  </Box>
);

const EmptyState: React.FC = () => (
  <Box
    borderStyle="round"
    borderColor={SemanticColors.border.default}
    flexDirection="column"
    padding={1}
  >
    <Text color={SemanticColors.text.primary}>
      No saved profiles found. Use /profile save model &lt;name&gt; to create
      one.
    </Text>
    <Text color={SemanticColors.text.secondary}>Press Esc to close</Text>
  </Box>
);

function useListKeypress(
  isSearching: boolean,
  isNarrow: boolean,
  searchTerm: string,
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>,
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>,
  onViewDetail: (name: string) => void,
  index: number,
  filteredProfiles: ProfileListItem[],
  move: (delta: number) => void,
  onSelect: (name: string) => void,
  columns: number,
  onClose: () => void,
  isLoading: boolean,
) {
  const handleKeypress = useCallback(
    (key: Parameters<Parameters<typeof useKeypress>[0]>[0]) => {
      if (key.name === 'escape') {
        if (isSearching && searchTerm.length > 0) {
          setSearchTerm('');
        } else {
          onClose();
        }
        return;
      }
      if (isSearching || isNarrow) {
        handleSearchModeKeys(
          key,
          isNarrow,
          setSearchTerm,
          setIsSearching,
          onViewDetail,
          index,
          filteredProfiles,
        );
      } else {
        handleNavModeKeys(
          key,
          filteredProfiles,
          index,
          move,
          onViewDetail,
          onSelect,
          setIsSearching,
          columns,
        );
      }
    },
    [
      isSearching,
      searchTerm,
      setSearchTerm,
      onClose,
      isNarrow,
      setIsSearching,
      onViewDetail,
      index,
      filteredProfiles,
      move,
      onSelect,
      columns,
    ],
  );

  useKeypress(handleKeypress, { isActive: !isLoading });
}

function useListLayout(
  isNarrow: boolean,
  isWide: boolean,
  filteredProfiles: ProfileListItem[],
) {
  // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
  const columns = isNarrow ? 1 : isWide ? 3 : 2;
  const longest = filteredProfiles.reduce(
    (len, p) => Math.max(len, p.name.length + 10),
    0,
  );
  const colWidth = isWide
    ? Math.max(longest + 4, 35)
    : Math.max(longest + 4, 25);
  const rows = Math.ceil(filteredProfiles.length / columns);
  return { columns, colWidth, rows };
}

function useProfileListIndexBounds(
  searchTerm: string,
  filteredProfiles: ProfileListItem[],
  setIndex: React.Dispatch<React.SetStateAction<number>>,
): void {
  useEffect(() => {
    setIndex(0);
  }, [searchTerm, setIndex]);

  useEffect(() => {
    setIndex((current) => {
      if (filteredProfiles.length === 0) return 0;
      return Math.min(current, filteredProfiles.length - 1);
    });
  }, [filteredProfiles.length, setIndex]);
}

const ProfileListBody: React.FC<{
  isNarrow: boolean;
  width: number;
  isSearching: boolean;
  searchTerm: string;
  filteredProfiles: ProfileListItem[];
  index: number;
  grid: React.ReactNode[];
}> = ({
  isNarrow,
  width,
  isSearching,
  searchTerm,
  filteredProfiles,
  index,
  grid,
}) => {
  if (isNarrow) {
    return (
      <Box flexDirection="column" padding={1}>
        <NarrowContent
          searchTerm={searchTerm}
          filteredProfiles={filteredProfiles}
          grid={grid}
        />
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={SemanticColors.border.default}
      flexDirection="column"
      padding={1}
      width={Math.min(width, 100)}
    >
      <WideContent
        isSearching={isSearching}
        searchTerm={searchTerm}
        filteredProfiles={filteredProfiles}
        index={index}
        grid={grid}
      />
    </Box>
  );
};

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
  const [isSearching, setIsSearching] = useState(true);
  const [index, setIndex] = useState(0);

  const filteredProfiles = useMemo(
    () =>
      profiles.filter((p) =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [profiles, searchTerm],
  );

  const { columns, colWidth, rows } = useListLayout(
    isNarrow,
    isWide,
    filteredProfiles,
  );

  useProfileListIndexBounds(searchTerm, filteredProfiles, setIndex);

  const move = useCallback(
    (delta: number) => {
      if (filteredProfiles.length === 0) {
        setIndex(0);
        return;
      }
      let next = index + delta;
      if (next < 0) next = 0;
      if (next >= filteredProfiles.length) next = filteredProfiles.length - 1;
      setIndex(next);
    },
    [index, filteredProfiles.length],
  );

  useListKeypress(
    isSearching,
    isNarrow,
    searchTerm,
    setSearchTerm,
    setIsSearching,
    onViewDetail,
    index,
    filteredProfiles,
    move,
    onSelect,
    columns,
    onClose,
    isLoading,
  );

  const grid = buildGrid(
    filteredProfiles,
    rows,
    columns,
    index,
    isSearching,
    isNarrow,
    isWide,
    activeProfileName,
    defaultProfileName,
    colWidth,
  );

  if (isLoading) return <LoadingState />;
  if (profiles.length === 0) return <EmptyState />;

  return (
    <ProfileListBody
      isNarrow={isNarrow}
      width={width}
      isSearching={isSearching}
      searchTerm={searchTerm}
      filteredProfiles={filteredProfiles}
      index={index}
      grid={grid}
    />
  );
};
