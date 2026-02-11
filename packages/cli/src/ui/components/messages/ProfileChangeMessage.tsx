/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';

interface ProfileChangeMessageProps {
  profileName: string;
}

export const ProfileChangeMessage: React.FC<ProfileChangeMessageProps> = ({
  profileName,
}) => (
  <Box marginLeft={2} marginTop={1}>
    <Text color={theme.ui.comment}>
      {`Switched to profile: ${profileName}`}
    </Text>
  </Box>
);
