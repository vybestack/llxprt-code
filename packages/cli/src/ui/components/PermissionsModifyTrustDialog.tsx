/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import type { RadioSelectItem } from './shared/RadioButtonSelect.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';
import type { TrustLevel } from '../../config/trustedFolders.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { PermissionsTrustRuntime } from '../hooks/usePermissionsModifyTrust.js';
import { usePermissionsTrustDialogFlow } from '../hooks/usePermissionsTrustDialogFlow.js';
import {
  getLocalTrustLevelDisplay,
  shouldDismissTrustDialog,
  type TrustFormChoice,
} from '../trustDialogHelpers.js';
import { PermissionsTrustPathInput } from './PermissionsTrustPathInput.js';
import { PermissionsTrustRulesList } from './PermissionsTrustRulesList.js';
import { getBorderStyle } from '../contexts/UnicodeRenderingContext.js';

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
      borderStyle={getBorderStyle('round')}
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
  targetPath: string;
  isTargetCwd: boolean;
  currentTrustLevel: TrustLevel | undefined;
  getDisplayText: (level: TrustLevel | undefined) => string;
  warningMessage: string | null;
  options: Array<RadioSelectItem<TrustFormChoice>>;
  initialIndex: number;
  onSelect: (choice: TrustFormChoice) => void | Promise<void>;
  isCommitting: boolean;
}

const TrustForm: React.FC<TrustFormProps> = ({
  targetPath,
  isTargetCwd,
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
      borderStyle={getBorderStyle('round')}
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
            Folder: <Text color={Colors.AccentBlue}>{targetPath}</Text>
          </Text>
        </Box>
        {!isTargetCwd && (
          <Box>
            <Text color={Colors.Gray}>(not the current folder)</Text>
          </Box>
        )}
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
        <RadioButtonSelect<TrustFormChoice>
          items={options}
          initialIndex={initialIndex}
          onSelect={(choice) => {
            if (!isCommitting) {
              void onSelect(choice);
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

export const PermissionsModifyTrustDialog: React.FC<
  PermissionsModifyTrustDialogProps
> = ({ onExit, addItem, config }) => {
  const flow = usePermissionsTrustDialogFlow(onExit, addItem, config);

  useKeypress(
    (key) => {
      if (flow.isCommitPending()) {
        return;
      }
      if (flow.view === 'updated') {
        if (shouldDismissTrustDialog(true, key.name)) {
          onExit();
        }
        return;
      }
      if (key.name === 'escape') {
        flow.handleEscape();
      }
    },
    { isActive: true },
  );

  if (flow.view === 'updated') {
    return (
      <UpdatedPrompt
        committedTrustLevel={flow.committedTrustLevel}
        effectiveTrustDisplay={flow.effectiveTrustDisplay}
      />
    );
  }

  if (flow.view === 'path-entry') {
    return (
      <PermissionsTrustPathInput
        value={flow.pathDraft}
        onChange={flow.setPathDraft}
        onSubmit={flow.submitPath}
        errorMessage={flow.pathError}
        workingDirectory={flow.workingDirectory}
      />
    );
  }

  if (flow.view === 'rules') {
    return (
      <PermissionsTrustRulesList
        rules={flow.trustRules}
        onSelect={flow.selectRule}
      />
    );
  }

  return (
    <TrustForm
      targetPath={flow.targetPath}
      isTargetCwd={flow.isTargetCwd}
      currentTrustLevel={flow.currentTrustLevel}
      getDisplayText={flow.getDisplayText}
      warningMessage={flow.warningMessage}
      options={flow.options}
      initialIndex={flow.initialIndex}
      onSelect={flow.selectChoice}
      isCommitting={flow.isCommitting}
    />
  );
};
