/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useState } from 'react';
import { Colors } from '../colors.js';
import { theme } from '../semantic-colors.js';
import type { RadioSelectItem } from './shared/RadioButtonSelect.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';
import * as process from 'node:process';
import * as path from 'node:path';
import { ExitCodes } from '@vybestack/llxprt-code-core';

export enum FolderTrustChoice {
  TRUST_FOLDER = 'trust_folder',
  TRUST_PARENT = 'trust_parent',
  DO_NOT_TRUST = 'do_not_trust',
}

interface FolderTrustDialogProps {
  workingDirectory: string;
  onSelect: (choice: FolderTrustChoice) => void;
}

function buildTrustOptions(
  currentFolder: string,
  parentFolder: string,
): Array<RadioSelectItem<FolderTrustChoice>> {
  return [
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
}

const TrustDialogHeader: React.FC = () => (
  <Box flexDirection="column" marginBottom={1}>
    <Text bold color={Colors.Foreground}>
      Do you trust this folder?
    </Text>
    <Text color={Colors.DimComment}>
      Trusting a folder allows llxprt to execute commands it suggests. This is a
      security feature to prevent accidental execution in untrusted directories.
    </Text>
  </Box>
);

interface ExitMessageProps {
  exiting: boolean;
}

const ExitMessage: React.FC<ExitMessageProps> = ({ exiting }) => {
  if (!exiting) {
    return null;
  }
  return (
    <Box marginLeft={1} marginTop={1}>
      <Text color={theme.status.warning}>
        A folder trust level must be selected to continue. Exiting since escape
        was pressed.
      </Text>
    </Box>
  );
};

export const FolderTrustDialog: React.FC<FolderTrustDialogProps> = ({
  workingDirectory,
  onSelect,
}) => {
  const [exiting, setExiting] = useState(false);

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        setExiting(true);
        setTimeout(() => {
          process.exit(ExitCodes.FATAL_CONFIG_ERROR);
        }, 100);
      }
    },
    { isActive: true },
  );

  const currentFolder = path.basename(workingDirectory);
  const parentFolder = path.basename(path.dirname(workingDirectory));
  const options = buildTrustOptions(currentFolder, parentFolder);

  return (
    <Box flexDirection="column" width="100%">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={Colors.AccentYellow}
        padding={1}
        marginLeft={1}
        marginRight={1}
      >
        <TrustDialogHeader />

        <RadioButtonSelect
          items={options}
          onSelect={onSelect}
          isFocused={true}
        />
      </Box>
      <ExitMessage exiting={exiting} />
    </Box>
  );
};
