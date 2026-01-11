/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import type { SubagentInfo } from './types.js';

interface SubagentDeleteDialogProps {
  subagent: SubagentInfo;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  isFocused?: boolean;
}

export const SubagentDeleteDialog: React.FC<SubagentDeleteDialogProps> = ({
  subagent,
  onConfirm,
  onCancel,
  isFocused = true,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setIsDeleting(false);
    }
  }, [onConfirm]);

  useKeypress(
    (key) => {
      if (isDeleting) return;

      if (key.name === 'escape') {
        onCancel();
        return;
      }

      if (key.name === 'return') {
        handleConfirm();
        return;
      }
    },
    { isActive: isFocused && !isDeleting },
  );

  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="#ff0000">
          WARNING: This action cannot be undone
        </Text>
      </Box>
      <Text color={Colors.Gray}>
        ───────────────────────────────────────────────────────
      </Text>

      {error && (
        <Box marginY={1}>
          <Text color="#ff0000">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text color={Colors.Gray}>Subagent: </Text>
          <Text color={Colors.Foreground}>{subagent.name}</Text>
        </Box>
        <Box>
          <Text color={Colors.Gray}>Profile: </Text>
          <Text color={Colors.Foreground}>{subagent.profile}</Text>
        </Box>
        <Box>
          <Text color={Colors.Gray}>Created: </Text>
          <Text color={Colors.Foreground}>
            {formatDate(subagent.createdAt)}
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginY={1}>
        <Text color={Colors.Foreground}>
          This will permanently delete the subagent and all
        </Text>
        <Text color={Colors.Foreground}>
          configuration data. The profile will NOT be affected.
        </Text>
      </Box>

      <Box marginY={1}>
        <Text bold color="#ffff00">
          WARNING: All subagent settings and prompts will be lost!
        </Text>
      </Box>

      {/* Controls */}
      <Box marginTop={1}>
        <Text color={Colors.Gray}>[Enter] Confirm Delete [ESC] Cancel</Text>
      </Box>

      {isDeleting && (
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Deleting...</Text>
        </Box>
      )}
    </Box>
  );
};
