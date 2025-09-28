/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-core';
import { Box, Text } from 'ink';
import React, { useCallback } from 'react';
import { Colors } from '../colors.js';
import { RenderInline } from '../utils/InlineMarkdownRenderer.js';
import {
  RadioButtonSelect,
  RadioSelectItem,
} from './shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { truncateEnd } from '../utils/responsive.js';

export interface ShellConfirmationRequest {
  commands: string[];
  onConfirm: (
    outcome: ToolConfirmationOutcome,
    approvedCommands?: string[],
  ) => void;
}

export interface ShellConfirmationDialogProps {
  request: ShellConfirmationRequest;
}

export const ShellConfirmationDialog: React.FC<
  ShellConfirmationDialogProps
> = ({ request }) => {
  const { commands, onConfirm } = request;
  const { rows } = useTerminalSize();

  // Calculate max number of commands to show based on terminal height
  // Reserve space for header text, radio buttons, and padding
  const maxCommandsToShow = Math.max(1, rows - 8);

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onConfirm(ToolConfirmationOutcome.Cancel);
      }
    },
    { isActive: true },
  );

  const handleSelect = useCallback(
    (item: ToolConfirmationOutcome) => {
      if (item === ToolConfirmationOutcome.Cancel) {
        onConfirm(item);
      } else {
        // For both ProceedOnce and ProceedAlways, we approve all the
        // commands that were requested.
        onConfirm(item, commands);
      }
    },
    [onConfirm, commands],
  );

  const options: Array<RadioSelectItem<ToolConfirmationOutcome>> = [
    {
      label: 'Yes, allow once',
      value: ToolConfirmationOutcome.ProceedOnce,
      key: 'Yes, allow once',
    },
    {
      label: 'Yes, allow always for this session',
      value: ToolConfirmationOutcome.ProceedAlways,
      key: 'Yes, allow always for this session',
    },
    {
      label: 'No (esc)',
      value: ToolConfirmationOutcome.Cancel,
      key: 'No (esc)',
    },
  ];

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentYellow}
      padding={1}
      width="100%"
      marginLeft={1}
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Shell Command Execution</Text>
        <Text>A custom command wants to run the following shell commands:</Text>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={Colors.Gray}
          paddingX={1}
          marginTop={1}
        >
          {commands.slice(0, maxCommandsToShow).map((cmd) => (
            <Text key={cmd} color={Colors.AccentCyan}>
              <RenderInline text={truncateEnd(cmd, 80)} />
            </Text>
          ))}
          {commands.length > maxCommandsToShow && (
            <Text color={Colors.Gray}>
              ...{commands.length - maxCommandsToShow} more commands...
            </Text>
          )}
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text>Do you want to proceed?</Text>
      </Box>

      <RadioButtonSelect items={options} onSelect={handleSelect} isFocused />
    </Box>
  );
};
