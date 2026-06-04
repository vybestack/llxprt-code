/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import * as path from 'node:path';
import { Colors } from '../colors.js';
import type { RadioSelectItem } from './shared/RadioButtonSelect.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { usePermissionsModifyTrust } from '../hooks/usePermissionsModifyTrust.js';
import { TrustLevel } from '../../config/trustedFolders.js';
import type { HistoryItemWithoutId } from '../types.js';
import { MessageType } from '../types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';

interface PermissionsModifyTrustDialogProps {
  onExit: () => void;
  addItem: UseHistoryManagerReturn['addItem'];
  onRestart?: () => void;
}

function getTrustLevelDisplay(
  level: TrustLevel | undefined,
  isIdeTrusted: boolean | undefined,
  isParentTrusted: boolean | undefined,
): string {
  if (isIdeTrusted === true) {
    return 'Trusted (via IDE)';
  }
  if (isParentTrusted === true && level == null) {
    return 'Trusted (via parent folder)';
  }
  switch (level) {
    case TrustLevel.TRUST_FOLDER:
      return 'Trusted';
    case TrustLevel.TRUST_PARENT:
      return 'Trust parent';
    case TrustLevel.DO_NOT_TRUST:
      return 'Not trusted';
    default:
      return 'Not set';
  }
}

function buildOptions(
  folderName: string,
  parentFolderName: string,
): Array<RadioSelectItem<TrustLevel>> {
  return [
    {
      label: `Trust this folder (${folderName})`,
      value: TrustLevel.TRUST_FOLDER,
      key: TrustLevel.TRUST_FOLDER,
    },
    {
      label: `Trust parent folder (${parentFolderName})`,
      value: TrustLevel.TRUST_PARENT,
      key: TrustLevel.TRUST_PARENT,
    },
    {
      label: "Don't trust",
      value: TrustLevel.DO_NOT_TRUST,
      key: TrustLevel.DO_NOT_TRUST,
    },
  ];
}

function getWarningMessage(
  isIdeTrusted: boolean | undefined,
  isParentTrusted: boolean | undefined,
): string | null {
  if (isIdeTrusted === true) {
    return 'This folder is trusted via your IDE settings. Changes here will only take effect when not using the IDE.';
  }
  if (isParentTrusted === true) {
    return 'This folder is trusted via a parent folder setting. You can override it with a more specific rule.';
  }
  return null;
}

interface RestartPromptProps {
  getDisplayText: (level: TrustLevel | undefined) => string;
  pendingTrustLevel: TrustLevel | undefined;
  onRestart?: () => void;
}

const RestartPrompt: React.FC<RestartPromptProps> = ({
  getDisplayText,
  pendingTrustLevel,
  onRestart: _onRestart,
}) => (
  <Box flexDirection="column">
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentYellow}
      padding={1}
      width="100%"
      marginLeft={1}
    >
      <Text color={Colors.Foreground} bold>
        Trust level updated
      </Text>
      <Text color={Colors.Comment}>
        Trust level has been set to:{' '}
        <Text color={Colors.AccentGreen}>
          {getDisplayText(pendingTrustLevel)}
        </Text>
      </Text>
    </Box>
    <Box marginLeft={1} marginTop={1}>
      <Text color={Colors.AccentYellow}>
        To see changes, llxprt must be restarted. Press &apos;r&apos; to exit
        and apply changes now, or Esc to continue without restart.
      </Text>
    </Box>
  </Box>
);

interface TrustFormProps {
  workingDirectory: string;
  currentTrustLevel: TrustLevel | undefined;
  getDisplayText: (level: TrustLevel | undefined) => string;
  warningMessage: string | null;
  options: Array<RadioSelectItem<TrustLevel>>;
  initialIndex: number;
  onSelect: (level: TrustLevel) => void;
}

const TrustForm: React.FC<TrustFormProps> = ({
  workingDirectory,
  currentTrustLevel,
  getDisplayText,
  warningMessage,
  options,
  initialIndex,
  onSelect,
}) => (
  <Box flexDirection="column">
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.Gray}
      padding={1}
      width="100%"
      marginLeft={1}
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text color={Colors.Foreground} bold>
          Modify Trust Settings
        </Text>
        <Box marginTop={1}>
          <Text color={Colors.Comment}>
            Folder: <Text color={Colors.AccentBlue}>{workingDirectory}</Text>
          </Text>
        </Box>
        <Box>
          <Text color={Colors.Comment}>
            Current: {getDisplayText(currentTrustLevel)}
          </Text>
        </Box>
      </Box>
      {warningMessage && (
        <Box marginBottom={1}>
          <Text color={Colors.AccentYellow}>{warningMessage}</Text>
        </Box>
      )}
      <Box flexDirection="column">
        <Text color={Colors.Foreground}>Select trust level:</Text>
        <RadioButtonSelect
          items={options}
          initialIndex={initialIndex}
          onSelect={onSelect}
          isFocused={true}
        />
      </Box>
    </Box>
    <Box marginLeft={1} marginTop={1}>
      <Text color={Colors.Gray}>(Use Enter to select, Escape to cancel)</Text>
    </Box>
  </Box>
);

function useTrustDialogState(
  onExit: () => void,
  addItem: UseHistoryManagerReturn['addItem'],
) {
  const {
    currentTrustLevel,
    pendingTrustLevel,
    commitTrustLevel,
    isIdeTrusted,
    isParentTrusted,
    requiresRestart: _requiresRestart,
    workingDirectory,
    parentFolderName,
  } = usePermissionsModifyTrust();

  const [showRestartPrompt, setShowRestartPrompt] = useState(false);

  const getDisplayText = useCallback(
    (level: TrustLevel | undefined): string =>
      getTrustLevelDisplay(level, isIdeTrusted, isParentTrusted),
    [isIdeTrusted, isParentTrusted],
  );

  const folderName = path.basename(workingDirectory);
  const options = useMemo(
    () => buildOptions(folderName, parentFolderName),
    [parentFolderName, folderName],
  );

  const initialIndex = useMemo(() => {
    if (currentTrustLevel == null) return 0;
    const index = options.findIndex((o) => o.value === currentTrustLevel);
    return index >= 0 ? index : 0;
  }, [currentTrustLevel, options]);

  const handleSelect = useCallback(
    (level: TrustLevel) => {
      commitTrustLevel(level);
      if (level !== currentTrustLevel) {
        addItem(
          {
            type: MessageType.INFO,
            text: `Trust level for ${workingDirectory} set to ${getDisplayText(level)}.`,
          } as HistoryItemWithoutId,
          Date.now(),
        );
        setShowRestartPrompt(true);
      } else {
        addItem(
          {
            type: MessageType.INFO,
            text: `Trust level unchanged for ${workingDirectory}`,
          } as HistoryItemWithoutId,
          Date.now(),
        );
        onExit();
      }
    },
    [
      commitTrustLevel,
      currentTrustLevel,
      addItem,
      workingDirectory,
      onExit,
      getDisplayText,
    ],
  );

  const warningMessage = useMemo(
    () => getWarningMessage(isIdeTrusted, isParentTrusted),
    [isIdeTrusted, isParentTrusted],
  );

  return {
    currentTrustLevel,
    pendingTrustLevel,
    showRestartPrompt,
    getDisplayText,
    options,
    initialIndex,
    handleSelect,
    warningMessage,
    workingDirectory,
  };
}

export const PermissionsModifyTrustDialog: React.FC<
  PermissionsModifyTrustDialogProps
> = ({ onExit, addItem, onRestart: _onRestartParam }) => {
  const state = useTrustDialogState(onExit, addItem);

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onExit();
      }
      if (key.name === 'r' && state.showRestartPrompt) {
        _onRestartParam?.();
      }
    },
    { isActive: true },
  );

  if (state.showRestartPrompt) {
    return (
      <RestartPrompt
        getDisplayText={state.getDisplayText}
        pendingTrustLevel={state.pendingTrustLevel}
        onRestart={_onRestartParam}
      />
    );
  }

  return (
    <TrustForm
      workingDirectory={state.workingDirectory}
      currentTrustLevel={state.currentTrustLevel}
      getDisplayText={state.getDisplayText}
      warningMessage={state.warningMessage}
      options={state.options}
      initialIndex={state.initialIndex}
      onSelect={state.handleSelect}
    />
  );
};
