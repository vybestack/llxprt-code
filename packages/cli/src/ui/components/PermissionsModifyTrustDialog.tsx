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
import type { CliUiRuntime } from '../cliUiRuntime.js';

interface PermissionsModifyTrustDialogProps {
  onExit: () => void;
  addItem: UseHistoryManagerReturn['addItem'];
  config?: CliUiRuntime;
}

function getLocalTrustLevelDisplay(level: TrustLevel | undefined): string {
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

export function getTrustLevelDisplay(
  level: TrustLevel | undefined,
  isIdeTrusted: boolean | undefined,
  isParentTrusted: boolean | undefined,
): string {
  if (isIdeTrusted !== undefined) {
    return isIdeTrusted ? 'Trusted (via IDE)' : 'Not trusted (via IDE)';
  }
  const localDisplay = getLocalTrustLevelDisplay(level);
  return isParentTrusted === true && level !== undefined
    ? `${localDisplay} (via parent folder)`
    : localDisplay;
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

export function getWarningMessage(
  isIdeTrusted: boolean | undefined,
  isParentTrusted: boolean | undefined,
  currentTrustLevel: TrustLevel | undefined,
): string | null {
  if (isIdeTrusted !== undefined) {
    const status = isIdeTrusted ? 'trusted' : 'not trusted';
    return `This folder is ${status} via your IDE settings. Changes here save a local fallback for use without the IDE.`;
  }
  if (isParentTrusted === true) {
    const status =
      currentTrustLevel === TrustLevel.DO_NOT_TRUST ? 'not trusted' : 'trusted';
    return `This folder is ${status} via a parent folder setting. You can override it with a more specific rule.`;
  }
  return null;
}

export function getTrustUpdateDisplay(
  committedTrustLevel: TrustLevel | undefined,
  effectiveTrust: boolean | undefined,
  isIdeTrusted: boolean | undefined,
): { savedLocalFallback: string; effectiveNow: string } {
  let effectiveTrustLevel: TrustLevel | undefined;
  if (effectiveTrust !== undefined) {
    effectiveTrustLevel = effectiveTrust
      ? TrustLevel.TRUST_FOLDER
      : TrustLevel.DO_NOT_TRUST;
  }
  return {
    savedLocalFallback: getLocalTrustLevelDisplay(committedTrustLevel),
    effectiveNow: getTrustLevelDisplay(
      effectiveTrustLevel,
      isIdeTrusted,
      false,
    ),
  };
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
      <Text color={Colors.Comment}>Press any key to continue.</Text>
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

function useTrustFormOptions(
  workingDirectory: string,
  parentFolderName: string,
  currentTrustLevel: TrustLevel | undefined,
): { options: Array<RadioSelectItem<TrustLevel>>; initialIndex: number } {
  const folderName = path.basename(workingDirectory);
  const options = useMemo(
    () => buildOptions(folderName, parentFolderName),
    [parentFolderName, folderName],
  );
  const initialIndex = useMemo(() => {
    const index = options.findIndex(
      (option) => option.value === currentTrustLevel,
    );
    return index >= 0 ? index : 0;
  }, [currentTrustLevel, options]);
  return { options, initialIndex };
}

function recordTrustSelection(
  addItem: UseHistoryManagerReturn['addItem'],
  workingDirectory: string,
  level: TrustLevel,
  currentTrustLevel: TrustLevel | undefined,
  displayText: string,
): boolean {
  const changed = level !== currentTrustLevel;
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

export function getTrustCommitErrorMessage(
  phase: 'persistence' | 'live',
  error: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  return phase === 'live'
    ? `Trust settings were saved but could not be applied live: ${detail}`
    : `Failed to save trust settings: ${detail}`;
}

function useTrustDialogState(
  onExit: () => void,
  addItem: UseHistoryManagerReturn['addItem'],
  config?: CliUiRuntime,
) {
  const {
    currentTrustLevel,
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
  const getDisplayText = useCallback(
    (level: TrustLevel | undefined): string =>
      getTrustLevelDisplay(level, isIdeTrusted, isParentTrusted),
    [isIdeTrusted, isParentTrusted],
  );
  const { options, initialIndex } = useTrustFormOptions(
    workingDirectory,
    parentFolderName,
    currentTrustLevel,
  );
  const handleSelect = useCallback(
    (level: TrustLevel) => {
      const result = commitTrustLevel(level);
      if (!result.success) {
        addItem(
          {
            type: MessageType.ERROR,
            text: getTrustCommitErrorMessage(result.phase, result.error),
          } as HistoryItemWithoutId,
          Date.now(),
        );
        return;
      }
      const changed = recordTrustSelection(
        addItem,
        workingDirectory,
        level,
        currentTrustLevel,
        getLocalTrustLevelDisplay(level),
      );
      if (changed) {
        setShowUpdatedPrompt(true);
      } else {
        onExit();
      }
    },
    [commitTrustLevel, currentTrustLevel, addItem, workingDirectory, onExit],
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
    currentTrustLevel,
    effectiveLocalTrustLevel,
    committedTrustLevel,
    effectiveTrustDisplay: trustUpdateDisplay.effectiveNow,
    showUpdatedPrompt,
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
      if (state.showUpdatedPrompt || key.name === 'escape') {
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
    />
  );
};
