/**
 * OAuth Code Input Dialog Component
 *
 * Allows users to paste authorization code from browser
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';
import TextInput from 'ink-text-input';

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

  useInput((_, key) => {
    if (key.escape) {
      onClose();
    }
  });

  const handleSubmit = () => {
    if (code.trim()) {
      onSubmit(code.trim());
      onClose();
    }
  };

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
        <TextInput
          value={code}
          onChange={setCode}
          onSubmit={handleSubmit}
          placeholder="Paste authorization code here..."
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to submit or Escape to cancel</Text>
      </Box>
    </Box>
  );
};
