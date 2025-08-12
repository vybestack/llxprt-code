/**
 * OAuth Code Input Dialog Component
 *
 * Allows users to paste authorization code from browser
 */

import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { useKeypress, Key } from '../hooks/useKeypress.js';

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

  const handleInput = useCallback(
    (key: Key) => {
      // Handle escape to close
      if (key.name === 'escape') {
        onClose();
        return;
      }

      // Handle enter to submit
      if (key.name === 'return') {
        if (code.trim()) {
          onSubmit(code.trim());
          onClose();
        }
        return;
      }

      // Handle backspace
      if (key.name === 'backspace') {
        setCode((prev) => prev.slice(0, -1));
        return;
      }

      // Handle paste - the useKeypress hook properly handles bracketed paste
      if (key.paste && key.sequence) {
        // The sequence already has the paste content without escape codes
        // Just filter to only allow valid OAuth code characters
        const cleanInput = key.sequence.replace(/[^a-zA-Z0-9\-_#]/g, '');
        if (cleanInput) {
          setCode((prev) => prev + cleanInput);
        }
        return;
      }

      // Handle regular character input
      if (key.sequence && !key.ctrl && !key.meta) {
        // Only allow valid OAuth code characters
        const cleanInput = key.sequence.replace(/[^a-zA-Z0-9\-_#]/g, '');
        if (cleanInput) {
          setCode((prev) => prev + cleanInput);
        }
      }
    },
    [code, onClose, onSubmit],
  );

  useKeypress(handleInput, { isActive: true });

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
