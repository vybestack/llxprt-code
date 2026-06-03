/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { Key } from '../../hooks/useKeypress.js';
import { useKeypress } from '../../hooks/useKeypress.js';
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

interface HandleKeypressDeps {
  isFocused: boolean;
  value: string;
  cursorPosition: number;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  maxLength?: number;
  setCursorPosition: React.Dispatch<React.SetStateAction<number>>;
}

const handleEditingKeys = (
  key: Key,
  deps: HandleKeypressDeps,
): boolean | undefined => {
  const { value, cursorPosition, onChange, setCursorPosition } = deps;

  if (key.name === 'backspace') {
    if (cursorPosition > 0) {
      onChange(
        value.slice(0, cursorPosition - 1) + value.slice(cursorPosition),
      );
      setCursorPosition(cursorPosition - 1);
    }
    return true;
  }

  if (key.name === 'delete') {
    if (cursorPosition < value.length) {
      onChange(
        value.slice(0, cursorPosition) + value.slice(cursorPosition + 1),
      );
    }
    return true;
  }

  if (key.name === 'left') {
    setCursorPosition(Math.max(0, cursorPosition - 1));
    return true;
  }

  if (key.name === 'right') {
    setCursorPosition(Math.min(value.length, cursorPosition + 1));
    return true;
  }

  if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
    setCursorPosition(0);
    return true;
  }

  if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
    setCursorPosition(value.length);
    return true;
  }

  if (key.ctrl && key.name === 'k') {
    onChange(value.slice(0, cursorPosition));
    return true;
  }

  if (key.ctrl && key.name === 'u') {
    onChange(value.slice(cursorPosition));
    setCursorPosition(0);
    return true;
  }

  return undefined;
};

const TextInputCursor: React.FC<{
  beforeCursor: string;
  atCursor: string;
  afterCursor: string;
  isFocused: boolean;
}> = ({ beforeCursor, atCursor, afterCursor, isFocused }) => (
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
);

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

  useEffect(() => {
    setCursorPosition((currentPosition) =>
      Math.min(currentPosition, value.length),
    );
  }, [value.length]);

  const handleKeypress = useCallback(
    (key: Key) => {
      if (!isFocused) return false;

      if (key.name === 'return' && onSubmit) {
        onSubmit();
        return true;
      }

      const editingResult = handleEditingKeys(key, {
        isFocused,
        value,
        cursorPosition,
        onChange,
        onSubmit,
        maxLength,
        setCursorPosition,
      });
      if (editingResult !== undefined) return editingResult;

      if (key.sequence && !key.ctrl && !key.meta) {
        if (
          maxLength != null &&
          maxLength > 0 &&
          !Number.isNaN(maxLength) &&
          value.length >= maxLength
        ) {
          return true;
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

  const displayValue = mask && value ? '*'.repeat(value.length) : value;
  const showPlaceholder = value === '' && placeholder !== '';
  const beforeCursor = displayValue.slice(0, cursorPosition);
  const atCursor = displayValue[cursorPosition] || ' ';
  const afterCursor = displayValue.slice(cursorPosition + 1);

  return (
    <Box>
      <Text color={Colors.AccentCyan}>&gt; </Text>
      {showPlaceholder ? (
        <Text color={Colors.Gray}>{placeholder}</Text>
      ) : (
        <TextInputCursor
          beforeCursor={beforeCursor}
          atCursor={atCursor}
          afterCursor={afterCursor}
          isFocused={isFocused}
        />
      )}
    </Box>
  );
};
