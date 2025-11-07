/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { Colors, SemanticColors } from '../../colors.js';

interface OAuthUrlMessageProps {
  text: string;
  url: string;
}

export const OAuthUrlMessage: React.FC<OAuthUrlMessageProps> = ({
  text,
  url,
}) => {
  const prefix = '[OAUTH] ';
  const prefixWidth = prefix.length;
  const linkText = 'Click here to authorize';

  // Extract provider name from text if available
  const providerMatch = text.match(/authorize with (\w+)/i);
  const provider = providerMatch ? providerMatch[1] : 'the service';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" marginBottom={1}>
        <Box width={prefixWidth}>
          <Text color={Colors.AccentBlue}>{prefix}</Text>
        </Box>
        <Box flexGrow={1}>
          <Text wrap="wrap" color={Colors.AccentBlue}>
            <Text bold>{text}</Text>
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" paddingLeft={prefixWidth + 1}>
        <Box marginBottom={1}>
          <Text color={Colors.AccentCyan}>
            <Text underline>{`${linkText} with ${provider}: `}</Text>
            <Text underline color={SemanticColors.text.link}>
              {url}
            </Text>
          </Text>
        </Box>
        <Box>
          <Text color={Colors.Comment} wrap="wrap">
            URL: {url}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
