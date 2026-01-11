/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import type { SubagentInfo } from './types.js';

interface SubagentShowViewProps {
  subagent: SubagentInfo;
  onEdit: () => void;
  onBack: () => void;
  isFocused?: boolean;
}

export const SubagentShowView: React.FC<SubagentShowViewProps> = ({
  subagent,
  onEdit,
  onBack,
  isFocused = true,
}) => {
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onBack();
        return;
      }
      if (key.sequence === 'e') {
        onEdit();
        return;
      }
    },
    { isActive: isFocused },
  );

  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  // Split system prompt into lines for display (show all lines)
  const promptLines = subagent.systemPrompt.split('\n');

  return (
    <Box flexDirection="column">
      {/* Basic Information Section */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.Foreground}>
          Basic Information
        </Text>
        <Text color={Colors.Gray}>
          ──────────────────────────────────────────────────────
        </Text>
        <Box>
          <Text color={Colors.Gray}>Name: </Text>
          <Text color={Colors.Foreground}>{subagent.name}</Text>
        </Box>
        <Box>
          <Text color={Colors.Gray}>Status: </Text>
          <Text color={Colors.AccentGreen}>Active</Text>
        </Box>
        <Box>
          <Text color={Colors.Gray}>Created: </Text>
          <Text color={Colors.Foreground}>
            {formatDate(subagent.createdAt)}
          </Text>
        </Box>
        <Box>
          <Text color={Colors.Gray}>Updated: </Text>
          <Text color={Colors.Foreground}>
            {formatDate(subagent.updatedAt)}
          </Text>
        </Box>
      </Box>

      {/* Configuration Section */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.Foreground}>
          Configuration
        </Text>
        <Text color={Colors.Gray}>
          ──────────────────────────────────────────────────────
        </Text>
        <Text color={Colors.Gray}>System Prompt:</Text>
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={Colors.Gray}
          paddingX={1}
        >
          {promptLines.map((line, idx) => (
            <Text key={idx} color={Colors.Foreground} wrap="wrap">
              {line || ' '}
            </Text>
          ))}
        </Box>
      </Box>

      {/* Profile Attachment Section */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.Foreground}>
          Profile Attachment
        </Text>
        <Text color={Colors.Gray}>
          ──────────────────────────────────────────────────────
        </Text>
        <Box>
          <Text color={Colors.Gray}>Profile: </Text>
          <Text color={Colors.Foreground}>{subagent.profile}</Text>
        </Box>
        {subagent.profileInfo && (
          <>
            {subagent.profileInfo.model && (
              <Box>
                <Text color={Colors.Gray}>Model: </Text>
                <Text color={Colors.Foreground}>
                  {subagent.profileInfo.model}
                  {subagent.profileInfo.provider &&
                    ` (via ${subagent.profileInfo.provider})`}
                </Text>
              </Box>
            )}
            {subagent.profileInfo.temperature !== undefined && (
              <Box>
                <Text color={Colors.Gray}>Temperature: </Text>
                <Text color={Colors.Foreground}>
                  {subagent.profileInfo.temperature}
                </Text>
              </Box>
            )}
            {subagent.profileInfo.maxTokens !== undefined && (
              <Box>
                <Text color={Colors.Gray}>Max Tokens: </Text>
                <Text color={Colors.Foreground}>
                  {subagent.profileInfo.maxTokens}
                </Text>
              </Box>
            )}
          </>
        )}
      </Box>

      {/* Controls */}
      <Box marginTop={1}>
        <Text color={Colors.Gray}>Press [ESC] to go back [e] to edit</Text>
      </Box>
    </Box>
  );
};
