/**
 * OAuth Code Input Dialog Component
 *
 * Prompts users to continue OAuth flow in the auth command
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';

interface OAuthCodeDialogProps {
  provider: string;
  onClose: () => void;
}

export const OAuthCodeDialog: React.FC<OAuthCodeDialogProps> = ({
  provider,
  onClose,
}) => {
  useInput((_, key) => {
    if (key.escape || key.return) {
      onClose();
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
        Please check your browser to complete the authorization.
      </Text>
      <Text color={Colors.Foreground}>
        After authorizing, you&apos;ll need to paste the code in the next step.
      </Text>
      <Box marginTop={1}>
        <Text dimColor>Press Enter or Escape to continue</Text>
      </Box>
    </Box>
  );
};
