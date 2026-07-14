/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Colors } from '../colors.js';
import { theme } from '../semantic-colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';
import * as process from 'node:process';
import * as path from 'node:path';
import { DebugLogger, ExitCodes } from '@vybestack/llxprt-code-core';
import { FolderTrustChoice, buildTrustOptions } from '../trustDialogHelpers.js';

const debug = DebugLogger.getLogger('llxprt:ui:folder-trust-dialog');

function isFolderTrustChoice(value: unknown): value is FolderTrustChoice {
  return (
    typeof value === 'string' &&
    Object.values(FolderTrustChoice).includes(value as FolderTrustChoice)
  );
}

export { FolderTrustChoice };

interface FolderTrustDialogProps {
  workingDirectory: string;
  onSelect: (choice: FolderTrustChoice) => void | Promise<void>;
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
  const [isCommitting, setIsCommitting] = useState(false);
  const committingRef = useRef(false);
  const exitingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useKeypress(
    (key) => {
      if (committingRef.current || exitingRef.current) {
        return;
      }
      if (key.name === 'escape') {
        exitingRef.current = true;
        setExiting(true);
        setTimeout(() => {
          process.exit(ExitCodes.FATAL_CONFIG_ERROR);
        }, 100);
      }
    },
    { isActive: true },
  );

  const handleSelect = useCallback(
    (choice: FolderTrustChoice) => {
      if (!isFolderTrustChoice(choice) || committingRef.current) {
        return;
      }
      committingRef.current = true;
      setIsCommitting(true);
      void Promise.resolve(onSelect(choice))
        .catch((error) => {
          debug.error('Folder trust selection failed', error);
        })
        .finally(() => {
          committingRef.current = false;
          if (mountedRef.current) {
            setIsCommitting(false);
          }
        });
    },
    [onSelect],
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
          onSelect={handleSelect}
          isFocused={!isCommitting}
        />
      </Box>
      <ExitMessage exiting={exiting} />
    </Box>
  );
};
