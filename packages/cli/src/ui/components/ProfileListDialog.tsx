/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import { SemanticColors } from '../colors.js';
import { useResponsive } from '../hooks/useResponsive.js';
import { truncateEnd } from '../utils/responsive.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { getBorderStyle } from '../contexts/UnicodeRenderingContext.js';

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
  onDelete: (profileName: string) => void;
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
  const needsTruncation = !isWide && profile.name.length > maxNameLen;
  const displayName = needsTruncation
    ? truncateEnd(profile.name, maxNameLen)
    : profile.name;

  const getNameColor = (): string => {
    if (selected) {
      return SemanticColors.text.accent;
    }
    if (isSearching && !isNarrow) {
      return SemanticColors.text.secondary;
    }
    if (isActiveProfile) {
      return SemanticColors.status.success;
    }
    return SemanticColors.text.primary;
  };

  return (
    <Box
      key={profile.name}
      width={isWide ? undefined : colWidth}
      marginRight={2}
    >
      <Text color={getNameColor()}>
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
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>,
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>,
  onViewDetail: (name: string) => void,
  selectedIndex: number,
  filteredProfiles: ProfileListItem[],
): void {
  if (key.name === 'return') {
    if (filteredProfiles.length > 0) {
      onViewDetail(filteredProfiles[selectedIndex].name);
    }
    return;
  }
  if (key.name === 'tab') {
    setIsSearching(false);
    return;
  }
  if (key.name === 'backspace' || key.name === 'delete') {
    setSearchTerm((prev) => prev.slice(0, -1));
    return;
  }
  if (isSingleCharacterInput(key)) {
    setSearchTerm((prev) => prev + key.sequence);
  }
}

function isSingleCharacterInput(key: {
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
}): key is { sequence: string } {
  if (key.ctrl === true || key.meta === true) {
    return false;
  }
  return typeof key.sequence === 'string' && key.sequence.length === 1;
}

function handleNavModeKeys(
  key: { name?: string; sequence?: string },
  filteredProfiles: ProfileListItem[],
  index: number,
  move: (delta: number) => void,
  onViewDetail: (name: string) => void,
  onSelect: (name: string) => void,
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>,
  requestDelete: (name: string) => void,
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
  if (key.sequence === 'l') {
    onSelect(filteredProfiles[index].name);
    return;
  }
  if (key.sequence === 'd') {
    requestDelete(filteredProfiles[index].name);
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

const DeleteConfirmationBanner: React.FC<{
  confirmDeleteName: string | null;
  activeProfileName?: string;
  defaultProfileName?: string;
}> = ({ confirmDeleteName, activeProfileName, defaultProfileName }) => {
  if (!confirmDeleteName) {
    return null;
  }

  const isActive = confirmDeleteName === activeProfileName;
  const isDefault = confirmDeleteName === defaultProfileName;
  const qualifiers = [
    isActive ? 'active' : null,
    isDefault ? 'default' : null,
  ].filter(Boolean);
  const qualifierText =
    qualifiers.length > 0 ? ` (${qualifiers.join(', ')})` : '';

  return (
    <Box marginTop={1}>
      <Text color={SemanticColors.status.warning}>
        Delete profile &apos;{confirmDeleteName}&apos;{qualifierText}? Press y
        to confirm, n or Esc to cancel.
      </Text>
    </Box>
  );
};

const NarrowContent: React.FC<{
  searchTerm: string;
  filteredProfiles: ProfileListItem[];
  grid: React.ReactNode[];
  confirmDeleteName: string | null;
  activeProfileName?: string;
  defaultProfileName?: string;
}> = ({
  searchTerm,
  filteredProfiles,
  grid,
  confirmDeleteName,
  activeProfileName,
  defaultProfileName,
}) => (
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
      Type to filter, Tab to navigate ([d] Delete), Enter for details, Esc to
      cancel
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

    <DeleteConfirmationBanner
      confirmDeleteName={confirmDeleteName}
      activeProfileName={activeProfileName}
      defaultProfileName={defaultProfileName}
    />
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
  if (isSearching || index < 0 || index >= filteredProfiles.length) {
    return null;
  }
  const selected = filteredProfiles[index];

  return (
    <Box marginTop={1}>
      <Text color={SemanticColors.text.secondary}>
        Selected: {selected.name}
        {selected.provider != null && (
          <Text color={SemanticColors.text.secondary}>
            {' '}
            ({selected.provider}
            {selected.model != null && ` / ${selected.model}`})
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
  confirmDeleteName: string | null;
  activeProfileName?: string;
  defaultProfileName?: string;
}> = ({
  isSearching,
  searchTerm,
  filteredProfiles,
  index,
  grid,
  confirmDeleteName,
  activeProfileName,
  defaultProfileName,
}) => (
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

    <DeleteConfirmationBanner
      confirmDeleteName={confirmDeleteName}
      activeProfileName={activeProfileName}
      defaultProfileName={defaultProfileName}
    />

    <Box marginTop={1} />

    <Text color={SemanticColors.text.secondary}>
      Controls: ↑↓←→ Navigate [Enter] Details [l] Load [d] Delete [Esc] Close
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
    borderStyle={getBorderStyle('round')}
    borderColor={SemanticColors.border.default}
    flexDirection="column"
    padding={1}
  >
    <Text color={SemanticColors.text.primary}>Loading profiles...</Text>
  </Box>
);

const EmptyState: React.FC = () => (
  <Box
    borderStyle={getBorderStyle('round')}
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

function handleDeleteConfirmKeys(
  key: { name?: string; sequence?: string },
  confirmDeleteName: string,
  setConfirmDeleteName: React.Dispatch<React.SetStateAction<string | null>>,
  onDelete: (name: string) => void,
): void {
  if (key.name === 'escape') {
    setConfirmDeleteName(null);
    return;
  }
  if (key.sequence === 'y' || key.sequence === 'Y') {
    setConfirmDeleteName(null);
    onDelete(confirmDeleteName);
    return;
  }
  if (key.sequence === 'n' || key.sequence === 'N') {
    setConfirmDeleteName(null);
  }
}

function useListKeypress(
  isSearching: boolean,
  searchTerm: string,
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>,
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>,
  onViewDetail: (name: string) => void,
  index: number,
  filteredProfiles: ProfileListItem[],
  move: (delta: number) => void,
  onSelect: (name: string) => void,
  onDelete: (name: string) => void,
  columns: number,
  onClose: () => void,
  isLoading: boolean,
  confirmDeleteName: string | null,
  setConfirmDeleteName: React.Dispatch<React.SetStateAction<string | null>>,
) {
  const handleKeypress = useCallback(
    (key: Parameters<Parameters<typeof useKeypress>[0]>[0]) => {
      if (confirmDeleteName !== null) {
        handleDeleteConfirmKeys(
          key,
          confirmDeleteName,
          setConfirmDeleteName,
          onDelete,
        );
        return;
      }

      if (key.name === 'escape') {
        if (isSearching && searchTerm.length > 0) {
          setSearchTerm('');
        } else {
          onClose();
        }
        return;
      }
      if (isSearching) {
        handleSearchModeKeys(
          key,
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
          setConfirmDeleteName,
          columns,
        );
      }
    },
    [
      confirmDeleteName,
      setConfirmDeleteName,
      onDelete,
      isSearching,
      searchTerm,
      setSearchTerm,
      onClose,
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
  const getColumnCount = (): number => {
    if (isNarrow) {
      return 1;
    }
    return isWide ? 3 : 2;
  };
  const columns = getColumnCount();
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
  confirmDeleteName: string | null;
  activeProfileName?: string;
  defaultProfileName?: string;
}> = ({
  isNarrow,
  width,
  isSearching,
  searchTerm,
  filteredProfiles,
  index,
  grid,
  confirmDeleteName,
  activeProfileName,
  defaultProfileName,
}) => {
  if (isNarrow) {
    return (
      <Box flexDirection="column" padding={1}>
        <NarrowContent
          searchTerm={searchTerm}
          filteredProfiles={filteredProfiles}
          grid={grid}
          confirmDeleteName={confirmDeleteName}
          activeProfileName={activeProfileName}
          defaultProfileName={defaultProfileName}
        />
      </Box>
    );
  }

  return (
    <Box
      borderStyle={getBorderStyle('round')}
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
        confirmDeleteName={confirmDeleteName}
        activeProfileName={activeProfileName}
        defaultProfileName={defaultProfileName}
      />
    </Box>
  );
};

function useConfirmDeleteClear(
  confirmDeleteName: string | null,
  filteredProfiles: ProfileListItem[],
  setConfirmDeleteName: React.Dispatch<React.SetStateAction<string | null>>,
): void {
  useEffect(() => {
    if (
      confirmDeleteName !== null &&
      !filteredProfiles.some((profile) => profile.name === confirmDeleteName)
    ) {
      setConfirmDeleteName(null);
    }
  }, [confirmDeleteName, filteredProfiles, setConfirmDeleteName]);
}

function useProfileListMove(
  index: number,
  filteredLength: number,
  setIndex: React.Dispatch<React.SetStateAction<number>>,
) {
  return useCallback(
    (delta: number) => {
      if (filteredLength === 0) {
        setIndex(0);
        return;
      }
      let next = index + delta;
      if (next < 0) next = 0;
      if (next >= filteredLength) next = filteredLength - 1;
      setIndex(next);
    },
    [index, filteredLength, setIndex],
  );
}

function useProfileListController(opts: {
  profiles: ProfileListItem[];
  onSelect: (profileName: string) => void;
  onClose: () => void;
  onViewDetail: (profileName: string) => void;
  onDelete: (profileName: string) => void;
  isLoading: boolean;
  activeProfileName?: string;
  defaultProfileName?: string;
}) {
  const { isNarrow, isWide, width } = useResponsive();
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(true);
  const [index, setIndex] = useState(0);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(
    null,
  );

  const filteredProfiles = useMemo(
    () =>
      opts.profiles.filter((p) =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    [opts.profiles, searchTerm],
  );

  const { columns, colWidth, rows } = useListLayout(
    isNarrow,
    isWide,
    filteredProfiles,
  );

  useProfileListIndexBounds(searchTerm, filteredProfiles, setIndex);
  useConfirmDeleteClear(
    confirmDeleteName,
    filteredProfiles,
    setConfirmDeleteName,
  );

  const move = useProfileListMove(index, filteredProfiles.length, setIndex);

  useListKeypress(
    isSearching,
    searchTerm,
    setSearchTerm,
    setIsSearching,
    opts.onViewDetail,
    index,
    filteredProfiles,
    move,
    opts.onSelect,
    opts.onDelete,
    columns,
    opts.onClose,
    opts.isLoading,
    confirmDeleteName,
    setConfirmDeleteName,
  );

  return {
    isNarrow,
    width,
    isSearching,
    searchTerm,
    filteredProfiles,
    index,
    confirmDeleteName,
    grid: buildGrid(
      filteredProfiles,
      rows,
      columns,
      index,
      isSearching,
      isNarrow,
      isWide,
      opts.activeProfileName,
      opts.defaultProfileName,
      colWidth,
    ),
  };
}

export const ProfileListDialog: React.FC<ProfileListDialogProps> = (props) => {
  const controller = useProfileListController({
    profiles: props.profiles,
    onSelect: props.onSelect,
    onClose: props.onClose,
    onViewDetail: props.onViewDetail,
    onDelete: props.onDelete,
    isLoading: props.isLoading === true,
    activeProfileName: props.activeProfileName,
    defaultProfileName: props.defaultProfileName,
  });

  if (props.isLoading === true) return <LoadingState />;
  if (props.profiles.length === 0) return <EmptyState />;

  return (
    <ProfileListBody
      isNarrow={controller.isNarrow}
      width={controller.width}
      isSearching={controller.isSearching}
      searchTerm={controller.searchTerm}
      filteredProfiles={controller.filteredProfiles}
      index={controller.index}
      grid={controller.grid}
      confirmDeleteName={controller.confirmDeleteName}
      activeProfileName={props.activeProfileName}
      defaultProfileName={props.defaultProfileName}
    />
  );
};
