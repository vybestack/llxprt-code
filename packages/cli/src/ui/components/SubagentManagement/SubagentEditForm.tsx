/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { EditField, type SubagentInfo } from './types.js';

interface SubagentEditFormProps {
  subagent: SubagentInfo;
  profiles: string[];
  pendingProfile?: string; // Profile selected from wizard, not yet saved
  onSave: (systemPrompt: string, profile: string) => Promise<void>;
  onCancel: () => void;
  onSelectProfile: () => void;
  isFocused?: boolean;
}

export const SubagentEditForm: React.FC<SubagentEditFormProps> = ({
  subagent,
  profiles: _profiles,
  pendingProfile,
  onSave,
  onCancel,
  onSelectProfile,
  isFocused = true,
}) => {
  const [systemPrompt, setSystemPrompt] = useState(subagent.systemPrompt);
  // Use pendingProfile from parent (set after profile wizard) or fall back to original
  const selectedProfile = pendingProfile ?? subagent.profile;
  const [focusedField, setFocusedField] = useState<EditField>(
    EditField.SYSTEM_PROMPT,
  );
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChanges =
    systemPrompt !== subagent.systemPrompt ||
    selectedProfile !== subagent.profile;

  const handleSave = useCallback(async () => {
    if (!hasChanges) {
      onCancel();
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(systemPrompt, selectedProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setIsSaving(false);
    }
  }, [hasChanges, systemPrompt, selectedProfile, onSave, onCancel]);

  const handleInput = useCallback((char: string) => {
    if (char === '\n') {
      setSystemPrompt((prev) => prev + '\n');
    } else {
      setSystemPrompt((prev) => prev + char);
    }
  }, []);

  const handleBackspace = useCallback(() => {
    setSystemPrompt((prev) => prev.slice(0, -1));
  }, []);

  useKeypress(
    (key) => {
      const input = key.sequence;
      if (isSaving) return;

      // Editing mode - capture text
      if (isEditing && focusedField === EditField.SYSTEM_PROMPT) {
        if (key.name === 'escape') {
          setIsEditing(false);
          return;
        }
        if (key.name === 'backspace' || key.name === 'delete') {
          handleBackspace();
          return;
        }
        if (key.name === 'return') {
          handleInput('\n');
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          handleInput(input);
        }
        return;
      }

      // Navigation mode
      if (key.name === 'escape') {
        onCancel();
        return;
      }

      if (key.name === 'up' || key.name === 'down') {
        setFocusedField((prev) =>
          prev === EditField.SYSTEM_PROMPT
            ? EditField.PROFILE
            : EditField.SYSTEM_PROMPT,
        );
        return;
      }

      if (key.name === 'return') {
        if (focusedField === EditField.SYSTEM_PROMPT) {
          setIsEditing(true);
        } else if (focusedField === EditField.PROFILE) {
          onSelectProfile();
        }
        return;
      }

      // Quick save with 's'
      if (input === 's') {
        handleSave();
        return;
      }

      // Cancel with 'c'
      if (input === 'c') {
        onCancel();
        return;
      }
    },
    { isActive: isFocused && !isSaving },
  );

  // Display prompt preview
  const promptLines = systemPrompt.split('\n');
  const maxLines = 5;
  const displayLines = promptLines.slice(0, maxLines);
  const truncated = `[${systemPrompt.slice(0, 45)}...]`;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={Colors.Foreground}>
          Edit Configuration
        </Text>
      </Box>
      <Text color={Colors.Gray}>
        ──────────────────────────────────────────────────────
      </Text>

      {error && (
        <Box marginBottom={1}>
          <Text color="#ff0000">{error}</Text>
        </Box>
      )}

      {/* System Prompt Field */}
      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text
            color={
              focusedField === EditField.SYSTEM_PROMPT
                ? '#00ff00'
                : Colors.Foreground
            }
          >
            {focusedField === EditField.SYSTEM_PROMPT ? '→ ' : '  '}1 System
            Prompt
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color={Colors.Gray}>Current: </Text>
          <Text color={Colors.Foreground}>{truncated}</Text>
        </Box>
        {isEditing && focusedField === EditField.SYSTEM_PROMPT && (
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor="#00ff00"
            marginLeft={4}
            paddingX={1}
          >
            {displayLines.map((line, idx) => (
              <Text key={idx} color={Colors.Foreground}>
                {line || ' '}
              </Text>
            ))}
            {promptLines.length > maxLines && (
              <Text color={Colors.Gray}>
                ... ({promptLines.length - maxLines} more lines)
              </Text>
            )}
            <Text color="#00ff00">|</Text>
            <Text color={Colors.Gray}>[ESC] Done Editing</Text>
          </Box>
        )}
        {!isEditing && focusedField === EditField.SYSTEM_PROMPT && (
          <Box marginLeft={4}>
            <Text color={Colors.Gray}>[Enter] Edit Full Prompt</Text>
          </Box>
        )}
      </Box>

      {/* Profile Field */}
      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text
            color={
              focusedField === EditField.PROFILE ? '#00ff00' : Colors.Foreground
            }
          >
            {focusedField === EditField.PROFILE ? '→ ' : '  '}2 Profile
            Assignment
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color={Colors.Gray}>Current: </Text>
          <Text color={Colors.Foreground}>{selectedProfile}</Text>
          {selectedProfile !== subagent.profile && (
            <Text color="#ffff00"> (changed)</Text>
          )}
        </Box>
        {focusedField === EditField.PROFILE && (
          <Box marginLeft={4}>
            <Text color={Colors.Gray}>[Enter] Change Profile</Text>
          </Box>
        )}
      </Box>

      {/* Controls */}
      <Box flexDirection="column" marginTop={1}>
        <Text color={Colors.Gray}>
          Controls: ↑↓ Navigate Fields [Enter] Toggle Edit
        </Text>
        <Text color={Colors.Gray}> [s] Save [c] Cancel [ESC] Back to list</Text>
        {hasChanges && <Text color="#ffff00">* Unsaved changes</Text>}
      </Box>

      {isSaving && (
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Saving...</Text>
        </Box>
      )}
    </Box>
  );
};
