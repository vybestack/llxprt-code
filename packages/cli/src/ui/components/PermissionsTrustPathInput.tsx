/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { TextInput } from './ProfileCreateWizard/TextInput.js';
import { getBorderStyle } from '../contexts/UnicodeRenderingContext.js';

interface PermissionsTrustPathInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  errorMessage: string | null;
  workingDirectory: string;
}

/**
 * Free-text entry for an arbitrary folder path. Relative input is resolved
 * against the working directory and `~` is expanded, both by the shared
 * normalization helper the caller applies on submit.
 */
export const PermissionsTrustPathInput: React.FC<
  PermissionsTrustPathInputProps
> = ({ value, onChange, onSubmit, errorMessage, workingDirectory }) => (
  <Box flexDirection="column">
    <Box
      flexDirection="column"
      borderStyle={getBorderStyle('round')}
      borderColor={Colors.Gray}
      padding={1}
      width="100%"
      marginLeft={1}
    >
      <Text color={Colors.Foreground} bold>
        Enter a folder path
      </Text>
      <Box marginTop={1}>
        <Text color={Colors.Comment}>
          Absolute, relative to{' '}
          <Text color={Colors.AccentBlue}>{workingDirectory}</Text>, or starting
          with ~
        </Text>
      </Box>
      <Box marginTop={1}>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          isFocused={true}
          placeholder="/path/to/folder"
        />
      </Box>
      {errorMessage && (
        <Box marginTop={1}>
          <Text color={Colors.AccentYellow}>{errorMessage}</Text>
        </Box>
      )}
    </Box>
    <Box marginLeft={1} marginTop={1}>
      <Text color={Colors.Gray}>(Enter to continue, Escape to go back)</Text>
    </Box>
  </Box>
);
