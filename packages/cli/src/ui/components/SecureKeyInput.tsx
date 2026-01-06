/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';

export interface SecureKeyInputProps {
  onSubmit: (value: string) => void;
  onCancel: () => void;
  providerName: string;
}

/**
 * Component for secure API key input with masking
 */
export const SecureKeyInput: React.FC<SecureKeyInputProps> = ({
  onSubmit,
  onCancel,
  providerName,
}) => {
  const [keyValue, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);

  const handleKeyPress = useCallback(
    (char: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        onCancel();
        return;
      }

      if (key.name === 'return') {
        onSubmit(keyValue);
        return;
      }

      if (key.name === 'backspace') {
        setKeyValue((prev) => prev.slice(0, -1));
        return;
      }

      // Toggle visibility with Ctrl+V
      if (key.ctrl && key.name === 'v') {
        setShowKey((prev) => !prev);
        return;
      }

      // Only accept printable characters
      if (char && char.length === 1 && !key.ctrl) {
        setKeyValue((prev) => prev + char);
      }
    },
    [keyValue, onSubmit, onCancel],
  );

  // Set up key press handler
  useEffect(() => {
    const handleInput = (chunk: Buffer, key: unknown) => {
      const keyInfo = key as { name?: string; ctrl?: boolean };
      const char = chunk.toString();
      handleKeyPress(char, keyInfo);
    };

    // Issue #1020: Add error handler to prevent EIO crashes
    const handleError = (err: Error) => {
      // Ignore transient I/O errors
      const isEioError =
        err instanceof Error &&
        ((err as any).code === 'EIO' ||
          (err as any).errno === -5 ||
          err.message.includes('EIO'));
      if (!isEioError) {
        console.error('Stdin error in SecureKeyInput:', err);
      }
    };

    process.stdin.on('data', handleInput);
    process.stdin.on('error', handleError);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    return () => {
      process.stdin.off('data', handleInput);
      process.stdin.off('error', handleError);
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Issue #1020: Ignore cleanup errors
      }
      process.stdin.pause();
    };
  }, [handleKeyPress]);

  const maskedValue = showKey ? keyValue : '•'.repeat(keyValue.length);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={Colors.AccentBlue}>Enter API key for {providerName}:</Text>
      </Box>
      <Box marginBottom={1}>
        <Text color={Colors.Foreground}>{maskedValue}</Text>
        {keyValue.length > 0 && (
          <Text color={Colors.Gray}> ({keyValue.length} characters)</Text>
        )}
      </Box>
      <Box flexDirection="column">
        <Text color={Colors.Gray}>Press Enter to submit</Text>
        <Text color={Colors.Gray}>Press Ctrl+V to toggle visibility</Text>
        <Text color={Colors.Gray}>Press Escape to cancel</Text>
      </Box>
    </Box>
  );
};
