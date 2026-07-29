/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { getBorderStyle } from '../contexts/UnicodeRenderingContext.js';

interface UpdateNotificationProps {
  message: string;
}

export const UpdateNotification = ({ message }: UpdateNotificationProps) => (
  <Box
    borderStyle={getBorderStyle('round')}
    borderColor={Colors.AccentYellow}
    paddingX={1}
    marginY={1}
  >
    <Text color={Colors.AccentYellow}>{message}</Text>
  </Box>
);
