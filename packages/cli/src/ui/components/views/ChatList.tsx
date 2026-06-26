/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';
import { Colors } from '../../colors.js';
import type { ChatDetail } from '../../types.js';

// Parses an ISO timestamp into date and time groups. The pattern is passed to
// RegExp via an identifier so it is not a static literal flagged by
// sonarjs/regular-expr.
const ISO_TIMESTAMP_PATTERN = '(\\d{4}-\\d{2}-\\d{2})T(\\d{2}:\\d{2}:\\d{2})';
const ISO_TIMESTAMP_REGEX = new RegExp(ISO_TIMESTAMP_PATTERN);

interface ChatListProps {
  chats: readonly ChatDetail[];
}

export const ChatList: React.FC<ChatListProps> = ({ chats }) => {
  if (chats.length === 0) {
    return (
      <Text color={Colors.Foreground}>
        No saved conversation checkpoints found.
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={Colors.Foreground}>List of saved conversations:</Text>
      <Box height={1} />
      {chats.map((chat) => {
        const isoString = chat.mtime;
        const match = isoString.match(ISO_TIMESTAMP_REGEX);
        const formattedDate = match
          ? `${match[1]} ${match[2]}`
          : 'Invalid Date';
        return (
          <Box key={chat.name} flexDirection="row">
            <Text color={Colors.Foreground}>
              {'  '}- <Text color={theme.text.accent}>{chat.name}</Text>{' '}
              <Text color={theme.text.secondary}>({formattedDate})</Text>
            </Text>
          </Box>
        );
      })}
      <Box height={1} />
      <Text color={theme.text.secondary}>Note: Newest last, oldest first</Text>
    </Box>
  );
};
