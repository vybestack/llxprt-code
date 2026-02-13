/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { ToolCallStatus } from '../../types.js';
import { GeminiRespondingSpinner } from '../GeminiRespondingSpinner.js';
import {
  SHELL_COMMAND_NAME,
  SHELL_NAME,
  TOOL_STATUS,
} from '../../constants.js';
import { Colors } from '../../colors.js';

export const STATUS_INDICATOR_WIDTH = 3;

export type TextEmphasis = 'high' | 'medium' | 'low';

type ToolStatusIndicatorProps = {
  status: ToolCallStatus;
  name: string;
};

export const ToolStatusIndicator: React.FC<ToolStatusIndicatorProps> = ({
  status,
  name,
}) => {
  const isShell = name === SHELL_COMMAND_NAME || name === SHELL_NAME;
  const warningColor = isShell ? Colors.Foreground : Colors.AccentYellow;

  return (
    <Box minWidth={STATUS_INDICATOR_WIDTH}>
      {status === ToolCallStatus.Pending && (
        <Text color={Colors.AccentGreen}>{TOOL_STATUS.PENDING}</Text>
      )}
      {status === ToolCallStatus.Executing && (
        <GeminiRespondingSpinner
          spinnerType="toggle"
          nonRespondingDisplay={TOOL_STATUS.EXECUTING}
        />
      )}
      {status === ToolCallStatus.Success && (
        <Text color={Colors.AccentGreen} aria-label={'Success:'}>
          {TOOL_STATUS.SUCCESS}
        </Text>
      )}
      {status === ToolCallStatus.Confirming && (
        <Text color={warningColor} aria-label={'Confirming:'}>
          {TOOL_STATUS.CONFIRMING}
        </Text>
      )}
      {status === ToolCallStatus.Canceled && (
        <Text color={warningColor} aria-label={'Canceled:'} bold>
          {TOOL_STATUS.CANCELED}
        </Text>
      )}
      {status === ToolCallStatus.Error && (
        <Text color={Colors.AccentRed} aria-label={'Error:'} bold>
          {TOOL_STATUS.ERROR}
        </Text>
      )}
    </Box>
  );
};

type ToolInfoProps = {
  name: string;
  description: string;
  status: ToolCallStatus;
  emphasis: TextEmphasis;
  showFullDescription?: boolean;
};

export const ToolInfo: React.FC<ToolInfoProps> = ({
  name,
  description,
  status,
  emphasis,
  showFullDescription = false,
}) => {
  const nameColor = emphasis === 'low' ? Colors.Gray : Colors.Foreground;
  return (
    <Box>
      <Text
        color={Colors.Foreground}
        wrap={showFullDescription ? 'wrap' : 'truncate-end'}
        strikethrough={status === ToolCallStatus.Canceled}
      >
        <Text color={nameColor} bold>
          {name}
        </Text>{' '}
        <Text color={Colors.Gray}>{description}</Text>
      </Text>
    </Box>
  );
};

export const TrailingIndicator: React.FC = () => (
  <Text color={Colors.Foreground} wrap="truncate">
    {' '}
    ←
  </Text>
);
