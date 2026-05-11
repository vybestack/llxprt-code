/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Box, Text } from 'ink';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { Colors } from '../colors.js';

const logger = new DebugLogger('llxprt:ui:secure-key-input');

export interface SecureKeyInputProps {
  onSubmit: (value: string) => void;
  onCancel: () => void;
  providerName: string;
}

const isEioError = (err: unknown): boolean => {
  if (err == null || typeof err !== 'object') {
    return false;
  }

  const nodeError = err as NodeJS.ErrnoException;
  return (
    nodeError.code === 'EIO' ||
    nodeError.errno === -5 ||
    (typeof nodeError.message === 'string' && nodeError.message.includes('EIO'))
  );
};

const KeyInputInstructions: React.FC = () => (
  <Box flexDirection="column">
    <Text color={Colors.Gray}>Press Enter to submit</Text>
    <Text color={Colors.Gray}>Press Ctrl+V to toggle visibility</Text>
    <Text color={Colors.Gray}>Press Escape to cancel</Text>
  </Box>
);

function updateKeyValue(
  char: string,
  key: { name?: string; ctrl?: boolean },
  setKeyValue: React.Dispatch<React.SetStateAction<string>>,
): boolean {
  if (key.name === 'backspace') {
    setKeyValue((prev) => prev.slice(0, -1));
    return true;
  }

  if (char.length > 0 && char.length === 1 && key.ctrl !== true) {
    setKeyValue((prev) => prev + char);
    return true;
  }

  return false;
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
      if (key.name === 'escape' || (key.ctrl === true && key.name === 'c')) {
        onCancel();
        return;
      }

      if (key.name === 'return') {
        onSubmit(keyValue);
        return;
      }

      if (key.ctrl === true && key.name === 'v') {
        setShowKey((prev) => !prev);
        return;
      }

      updateKeyValue(char, key, setKeyValue);
    },
    [keyValue, onSubmit, onCancel],
  );

  useEffect(() => {
    let rawModeEnabled = false;
    const handleInput = (chunk: Buffer, key: unknown) => {
      const keyInfo = key as { name?: string; ctrl?: boolean };
      const char = chunk.toString();
      handleKeyPress(char, keyInfo);
    };

    const handleError = (err: Error) => {
      if (!isEioError(err)) {
        logger.error('Stdin error in SecureKeyInput:', err);
      }
    };

    process.stdin.on('data', handleInput);
    process.stdin.on('error', handleError);
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
        rawModeEnabled = true;
      } catch (error) {
        logger.debug('Failed to enable raw mode for SecureKeyInput', error);
      }
    }
    process.stdin.resume();

    return () => {
      process.stdin.off('data', handleInput);
      process.stdin.off('error', handleError);
      if (rawModeEnabled && process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {
          // Issue #1020: Ignore cleanup errors
        }
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
      <KeyInputInstructions />
    </Box>
  );
};
