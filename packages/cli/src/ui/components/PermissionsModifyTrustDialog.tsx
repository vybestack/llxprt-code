/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import * as path from 'node:path';
import { Colors } from '../colors.js';
import {
  RadioButtonSelect,
  RadioSelectItem,
} from './shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { usePermissionsModifyTrust } from '../hooks/usePermissionsModifyTrust.js';
import { TrustLevel } from '../../config/trustedFolders.js';
import { HistoryItemWithoutId, MessageType } from '../types.js';
import { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';

interface PermissionsModifyTrustDialogProps {
  onExit: () => void;
  addItem: UseHistoryManagerReturn['addItem'];
  onRestart?: () => void;
}

export const PermissionsModifyTrustDialog: React.FC<
  PermissionsModifyTrustDialogProps
> = ({ onExit, addItem, onRestart }) => {
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

  // Determine the display trust level text
  const getTrustLevelDisplay = useCallback(
    (level: TrustLevel | undefined): string => {
      if (isIdeTrusted) {
        return 'Trusted (via IDE)';
      }
      if (isParentTrusted && !level) {
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
    },
    [isIdeTrusted, isParentTrusted],
  );

  const folderName = path.basename(workingDirectory);

  const options: Array<RadioSelectItem<TrustLevel>> = useMemo(
    () => [
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
    ],
    [parentFolderName, folderName],
  );

  // Find initial index based on current trust level
  const initialIndex = useMemo(() => {
    if (!currentTrustLevel) return 0;
    const index = options.findIndex((o) => o.value === currentTrustLevel);
    return index >= 0 ? index : 0;
  }, [currentTrustLevel, options]);

  const handleSelect = useCallback(
    (level: TrustLevel) => {
      commitTrustLevel(level);

      // Check if we need to show restart prompt
      if (level !== currentTrustLevel) {
        addItem(
          {
            type: MessageType.INFO,
            text: `Trust level for ${workingDirectory} set to ${getTrustLevelDisplay(level)}.`,
          } as HistoryItemWithoutId,
          Date.now(),
        );
        setShowRestartPrompt(true);
      } else {
        // No change needed, just exit
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
      getTrustLevelDisplay,
    ],
  );

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (showRestartPrompt) {
          onExit();
        } else {
          onExit();
        }
      }
      if (key.name === 'r' && showRestartPrompt) {
        onRestart?.();
      }
    },
    { isActive: true },
  );

  // Generate warning message for inherited trust
  const warningMessage = useMemo(() => {
    if (isIdeTrusted) {
      return 'This folder is trusted via your IDE settings. Changes here will only take effect when not using the IDE.';
    }
    if (isParentTrusted) {
      return 'This folder is trusted via a parent folder setting. You can override it with a more specific rule.';
    }
    return null;
  }, [isIdeTrusted, isParentTrusted]);

  if (showRestartPrompt) {
    return (
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
              {getTrustLevelDisplay(pendingTrustLevel)}
            </Text>
          </Text>
        </Box>
        <Box marginLeft={1} marginTop={1}>
          <Text color={Colors.AccentYellow}>
            To see changes, llxprt must be restarted. Press &apos;r&apos; to
            exit and apply changes now, or Esc to continue without restart.
          </Text>
        </Box>
      </Box>
    );
  }

  return (
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
              Current: {getTrustLevelDisplay(currentTrustLevel)}
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
            onSelect={handleSelect}
            isFocused={true}
          />
        </Box>
      </Box>
      <Box marginLeft={1} marginTop={1}>
        <Text color={Colors.Gray}>(Use Enter to select, Escape to cancel)</Text>
      </Box>
    </Box>
  );
};
