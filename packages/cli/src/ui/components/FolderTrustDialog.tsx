/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import React, { useState } from 'react';
import { Colors } from '../colors.js';
import { theme } from '../semantic-colors.js';
import {
  RadioButtonSelect,
  RadioSelectItem,
} from './shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';
import * as process from 'node:process';
import * as path from 'node:path';

export enum FolderTrustChoice {
  TRUST_FOLDER = 'trust_folder',
  TRUST_PARENT = 'trust_parent',
  DO_NOT_TRUST = 'do_not_trust',
}

interface FolderTrustDialogProps {
  onSelect: (choice: FolderTrustChoice) => void;
  isRestarting?: boolean;
}

export const FolderTrustDialog: React.FC<FolderTrustDialogProps> = ({
  onSelect,
  isRestarting,
}) => {
  const [exiting, setExiting] = useState(false);

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        setExiting(true);
        setTimeout(() => {
          process.exit(1);
        }, 100);
      }
    },
    { isActive: !isRestarting },
  );

  useKeypress(
    (key) => {
      if (key.name === 'r') {
        process.exit(0);
      }
    },
    { isActive: !!isRestarting },
  );

  const currentFolder = path.basename(process.cwd());
  const parentFolder = path.basename(path.dirname(process.cwd()));

  const options: Array<RadioSelectItem<FolderTrustChoice>> = [
    {
      label: 'Trust folder',
      value: FolderTrustChoice.TRUST_FOLDER,
      key: `Trust folder (${currentFolder})`,
    },
    {
      label: `Trust parent folder (${parentFolder})`,
      value: FolderTrustChoice.TRUST_PARENT,
      key: `Trust parent folder (${parentFolder})`,
    },
    {
      label: "Don't trust",
      value: FolderTrustChoice.DO_NOT_TRUST,
      key: "Don't trust",
    },
  ];

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
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Do you trust this folder?</Text>
          <Text>
            Trusting a folder allows llxprt to execute commands it suggests.
            This is a security feature to prevent accidental execution in
            untrusted directories.
          </Text>
        </Box>

        <RadioButtonSelect
          items={options}
          onSelect={onSelect}
          isFocused={!isRestarting}
        />
      </Box>
      {isRestarting && (
        <Box marginLeft={1} marginTop={1}>
          <Text color={Colors.AccentYellow}>
            To see changes, llxprt must be restarted. Press r to exit and apply
            changes now.
          </Text>
        </Box>
      )}
      {exiting && (
        <Box marginLeft={1} marginTop={1}>
          <Text color={theme.status.warning}>
            A folder trust level must be selected to continue. Exiting since
            escape was pressed.
          </Text>
        </Box>
      )}
    </Box>
  );
};
