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

  // Extract provider name from text if available
  const providerMatch = text.match(/authorize with ([^\n:]+)/i);
  const provider = providerMatch ? providerMatch[1] : 'the service';

  // Create OSC 8 hyperlink with friendly short text that won't wrap
  const osc8Link = `\u001b]8;;${url}\u001b\\Click here to authorize with ${provider}\u001b]8;;\u001b\\`;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" marginBottom={1}>
        <Box width={prefixWidth}>
          <Text color={Colors.AccentBlue}>{prefix}</Text>
        </Box>
        <Box flexGrow={1}>
          <Text color={Colors.AccentBlue}>
            <Text bold>OAuth Authentication Required for {provider}</Text>
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" paddingLeft={prefixWidth + 1}>
        <Box marginBottom={1}>
          <Text color={SemanticColors.text.link}>{osc8Link}</Text>
        </Box>
        <Box>
          <Text color={Colors.Comment} dimColor wrap="wrap">
            Or copy this URL: {url}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
