/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useKeypress, Key } from '../../hooks/useKeypress.js';
import { Colors } from '../../colors.js';

export interface TextInputProps {
  value?: string;
  placeholder?: string;
  mask?: boolean; // Show ******* instead of actual text
  onChange: (value: string) => void;
  onSubmit?: () => void;
  isFocused: boolean;
  maxLength?: number;
}

/**
 * Simple text input component for wizard forms.
 * Supports basic text editing, masking for passwords, and keyboard navigation.
 */
export const TextInput: React.FC<TextInputProps> = ({
  value = '',
  placeholder = '',
  mask = false,
  onChange,
  onSubmit,
  isFocused,
  maxLength,
}) => {
  const [cursorPosition, setCursorPosition] = useState(value.length);

  // Keep cursor at end when value changes externally
  useEffect(() => {
    setCursorPosition(value.length);
  }, [value]);

  const handleKeypress = useCallback(
    (key: Key) => {
      if (!isFocused) return false;

      // Enter - submit
      if (key.name === 'return' && onSubmit) {
        onSubmit();
        return true;
      }

      // Backspace - delete character before cursor
      if (key.name === 'backspace') {
        if (cursorPosition > 0) {
          const newValue =
            value.slice(0, cursorPosition - 1) + value.slice(cursorPosition);
          onChange(newValue);
          setCursorPosition(cursorPosition - 1);
        }
        return true;
      }

      // Delete - delete character after cursor
      if (key.name === 'delete') {
        if (cursorPosition < value.length) {
          const newValue =
            value.slice(0, cursorPosition) + value.slice(cursorPosition + 1);
          onChange(newValue);
        }
        return true;
      }

      // Left arrow - move cursor left
      if (key.name === 'left') {
        setCursorPosition(Math.max(0, cursorPosition - 1));
        return true;
      }

      // Right arrow - move cursor right
      if (key.name === 'right') {
        setCursorPosition(Math.min(value.length, cursorPosition + 1));
        return true;
      }

      // Home - move to start
      if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
        setCursorPosition(0);
        return true;
      }

      // End - move to end
      if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
        setCursorPosition(value.length);
        return true;
      }

      // Ctrl+K - delete from cursor to end
      if (key.ctrl && key.name === 'k') {
        const newValue = value.slice(0, cursorPosition);
        onChange(newValue);
        return true;
      }

      // Ctrl+U - delete from cursor to start
      if (key.ctrl && key.name === 'u') {
        const newValue = value.slice(cursorPosition);
        onChange(newValue);
        setCursorPosition(0);
        return true;
      }

      // Regular character input - use key.sequence for actual character
      // key.sequence contains the actual character typed, including special chars
      // Only block ctrl/meta combinations (except paste which terminals handle)
      if (key.sequence && !key.ctrl && !key.meta) {
        // Allow paste (Ctrl+V sends the pasted content as sequence)
        if (maxLength && value.length >= maxLength) {
          return true; // Block input if at max length
        }

        const newValue =
          value.slice(0, cursorPosition) +
          key.sequence +
          value.slice(cursorPosition);
        onChange(newValue);
        setCursorPosition(cursorPosition + key.sequence.length);
        return true;
      }

      return false;
    },
    [isFocused, value, cursorPosition, onChange, onSubmit, maxLength],
  );

  useKeypress(handleKeypress, { isActive: isFocused });

  // Display value (masked or plain)
  const displayValue = mask && value ? '*'.repeat(value.length) : value;

  // Show placeholder if empty
  const showPlaceholder = !value && placeholder;

  // Build display text with cursor
  const beforeCursor = displayValue.slice(0, cursorPosition);
  const atCursor = displayValue[cursorPosition] || ' ';
  const afterCursor = displayValue.slice(cursorPosition + 1);

  return (
    <Box>
      <Text color={Colors.AccentCyan}>&gt; </Text>
      {showPlaceholder ? (
        <Text color={Colors.Gray}>{placeholder}</Text>
      ) : (
        <>
          <Text color={Colors.Foreground}>{beforeCursor}</Text>
          {isFocused ? (
            <Text backgroundColor={Colors.AccentCyan} color={Colors.Background}>
              {atCursor}
            </Text>
          ) : (
            <Text color={Colors.Foreground}>{atCursor}</Text>
          )}
          <Text color={Colors.Foreground}>{afterCursor}</Text>
        </>
      )}
    </Box>
  );
};
