/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useState, useMemo, useRef } from 'react';
import { Box, Text } from 'ink';
import * as path from 'node:path';
import { Colors } from '../colors.js';
import type { RadioSelectItem } from './shared/RadioButtonSelect.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { usePermissionsModifyTrust } from '../hooks/usePermissionsModifyTrust.js';
import { isTrustLevel, type TrustLevel } from '../../config/trustedFolders.js';
import type { HistoryItemWithoutId } from '../types.js';
import { MessageType } from '../types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { PermissionsTrustRuntime } from '../hooks/usePermissionsModifyTrust.js';
import {
  getLocalTrustLevelDisplay,
  getTrustLevelDisplay,
  getWarningMessage,
  getTrustUpdateDisplay,
  getTrustCommitErrorMessage,
  shouldDismissTrustDialog,
  buildTrustLevelOptions,
  findInitialTrustOptionIndex,
} from '../trustDialogHelpers.js';

interface PermissionsModifyTrustDialogProps {
  onExit: () => void;
  addItem: UseHistoryManagerReturn['addItem'];
  config?: PermissionsTrustRuntime;
}

interface UpdatedPromptProps {
  committedTrustLevel: TrustLevel | undefined;
  effectiveTrustDisplay: string;
}

const UpdatedPrompt: React.FC<UpdatedPromptProps> = ({
  committedTrustLevel,
  effectiveTrustDisplay,
}) => (
  <Box flexDirection="column">
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentGreen}
      padding={1}
      width="100%"
      marginLeft={1}
    >
      <Text color={Colors.Foreground} bold>
        Trust level updated
      </Text>
      <Text color={Colors.Comment}>
        Saved local fallback:{' '}
        <Text color={Colors.AccentGreen}>
          {getLocalTrustLevelDisplay(committedTrustLevel)}
        </Text>
      </Text>
      <Text color={Colors.Comment}>
        Effective now:{' '}
        <Text color={Colors.AccentGreen}>{effectiveTrustDisplay}</Text>
      </Text>
      <Text color={Colors.Comment}>Press Enter to continue.</Text>
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
  onSelect: (level: TrustLevel) => void | Promise<void>;
  isCommitting: boolean;
}

const TrustForm: React.FC<TrustFormProps> = ({
  workingDirectory,
  currentTrustLevel,
  getDisplayText,
  warningMessage,
  options,
  initialIndex,
  onSelect,
  isCommitting,
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
          onSelect={(level) => {
            if (isTrustLevel(level) && !isCommitting) {
              void onSelect(level);
            }
          }}
          isFocused={!isCommitting}
        />
      </Box>
    </Box>
    <Box marginLeft={1} marginTop={1}>
      <Text color={Colors.Gray}>(Use Enter to select, Escape to cancel)</Text>
    </Box>
  </Box>
);

function useTrustFormOptions(
  workingDirectory: string,
  parentFolderName: string,
  currentTrustLevel: TrustLevel | undefined,
): { options: Array<RadioSelectItem<TrustLevel>>; initialIndex: number } {
  const folderName = path.basename(workingDirectory);
  const options = useMemo(
    () => buildTrustLevelOptions(folderName, parentFolderName),
    [parentFolderName, folderName],
  );
  const initialIndex = useMemo(
    () => findInitialTrustOptionIndex(options, currentTrustLevel),
    [currentTrustLevel, options],
  );
  return { options, initialIndex };
}

function recordTrustSelection(
  addItem: UseHistoryManagerReturn['addItem'],
  workingDirectory: string,
  level: TrustLevel,
  previousTrustLevel: TrustLevel | undefined,
  displayText: string,
): boolean {
  const changed = level !== previousTrustLevel;
  addItem(
    {
      type: MessageType.INFO,
      text: changed
        ? `Trust level for ${workingDirectory} set to ${displayText}.`
        : `Trust level unchanged for ${workingDirectory}`,
    } as HistoryItemWithoutId,
    Date.now(),
  );
  return changed;
}

function useTrustDialogState(
  onExit: () => void,
  addItem: UseHistoryManagerReturn['addItem'],
  config?: PermissionsTrustRuntime,
) {
  const {
    pendingTrustLevel,
    effectiveLocalTrustLevel,
    commitTrustLevel,
    isIdeTrusted,
    isParentTrusted,
    committedTrustLevel,
    effectiveTrust,
    workingDirectory,
    parentFolderName,
  } = usePermissionsModifyTrust(config);

  const [showUpdatedPrompt, setShowUpdatedPrompt] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const committingRef = useRef(false);
  const getDisplayText = useCallback(
    (level: TrustLevel | undefined): string =>
      getTrustLevelDisplay(level, isIdeTrusted, isParentTrusted),
    [isIdeTrusted, isParentTrusted],
  );
  const { options, initialIndex } = useTrustFormOptions(
    workingDirectory,
    parentFolderName,
    pendingTrustLevel ?? effectiveLocalTrustLevel,
  );
  const handleSelect = useCallback(
    async (level: TrustLevel) => {
      if (committingRef.current) {
        return;
      }
      committingRef.current = true;
      setIsCommitting(true);
      try {
        const result = await commitTrustLevel(level);
        if (!result.success) {
          addItem(
            {
              type: MessageType.ERROR,
              text: getTrustCommitErrorMessage(
                result.phase,
                result.error,
                result.rollbackSucceeded,
              ),
            } as HistoryItemWithoutId,
            Date.now(),
          );
          return;
        }
        const changed = recordTrustSelection(
          addItem,
          workingDirectory,
          level,
          pendingTrustLevel,
          getLocalTrustLevelDisplay(level),
        );
        if (changed) {
          setShowUpdatedPrompt(true);
        } else {
          onExit();
        }
      } finally {
        committingRef.current = false;
        setIsCommitting(false);
      }
    },
    [commitTrustLevel, pendingTrustLevel, addItem, workingDirectory, onExit],
  );

  const warningMessage = getWarningMessage(
    isIdeTrusted,
    isParentTrusted,
    effectiveLocalTrustLevel,
  );
  const trustUpdateDisplay = getTrustUpdateDisplay(
    committedTrustLevel,
    effectiveTrust,
    isIdeTrusted,
  );

  return {
    effectiveLocalTrustLevel,
    committedTrustLevel,
    effectiveTrustDisplay: trustUpdateDisplay.effectiveNow,
    showUpdatedPrompt,
    isCommitting,
    isCommitPending: () => committingRef.current,
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
> = ({ onExit, addItem, config }) => {
  const state = useTrustDialogState(onExit, addItem, config);

  useKeypress(
    (key) => {
      if (state.isCommitPending()) {
        return;
      }
      if (shouldDismissTrustDialog(state.showUpdatedPrompt, key.name)) {
        onExit();
      }
    },
    { isActive: true },
  );

  if (state.showUpdatedPrompt) {
    return (
      <UpdatedPrompt
        committedTrustLevel={state.committedTrustLevel}
        effectiveTrustDisplay={state.effectiveTrustDisplay}
      />
    );
  }

  return (
    <TrustForm
      workingDirectory={state.workingDirectory}
      currentTrustLevel={state.effectiveLocalTrustLevel}
      getDisplayText={state.getDisplayText}
      warningMessage={state.warningMessage}
      options={state.options}
      initialIndex={state.initialIndex}
      onSelect={state.handleSelect}
      isCommitting={state.isCommitting}
    />
  );
};
