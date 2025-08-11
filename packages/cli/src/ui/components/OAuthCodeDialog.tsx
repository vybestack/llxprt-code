/**
 * OAuth Code Input Dialog Component
 *
 * Allows users to paste authorization code from browser
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';

interface OAuthCodeDialogProps {
  provider: string;
  onClose: () => void;
  onSubmit: (code: string) => void;
}

export const OAuthCodeDialog: React.FC<OAuthCodeDialogProps> = ({
  provider,
  onClose,
  onSubmit,
}) => {
  const [code, setCode] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.return) {
      if (code.trim()) {
        // Strip bracketed paste sequences before submitting
        const cleanCode = code
          .replace(/\[200~/g, '')
          .replace(/\[201~/g, '')
          .replace(/~\[200~/g, '')
          .replace(/~\[201~/g, '')
          .trim();

        if (cleanCode) {
          onSubmit(cleanCode);
          onClose();
        }
      }
      return;
    }

    if (key.backspace || key.delete) {
      setCode((prev) => prev.slice(0, -1));
      return;
    }

    // Handle regular input (including paste)
    if (input) {
      // Strip bracketed paste mode indicators
      const cleanInput = input
        .replace(/\[200~/g, '')
        .replace(/\[201~/g, '')
        .replace(/~\[200~/g, '')
        .replace(/~\[201~/g, '');

      setCode((prev) => prev + cleanInput);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentCyan}
      paddingX={2}
      paddingY={1}
      marginX={2}
      marginY={1}
    >
      <Text bold color={Colors.AccentCyan}>
        {provider.charAt(0).toUpperCase() + provider.slice(1)} OAuth
        Authentication
      </Text>
      <Text color={Colors.Foreground}>
        Please check your browser and authorize the application.
      </Text>
      <Text color={Colors.Foreground}>
        After authorizing, paste the authorization code below:
      </Text>
      <Box marginTop={1}>
        <Text color={Colors.AccentCyan}>Code: </Text>
        <Text color={Colors.Foreground}>{code || '(paste code here)'}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to submit or Escape to cancel</Text>
      </Box>
    </Box>
  );
};
