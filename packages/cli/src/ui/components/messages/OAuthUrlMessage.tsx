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
          <Text color={Colors.Comment} dimColor wrap="wrap">
            Open this URL to authorize:
          </Text>
        </Box>
        <Box marginBottom={1}>
          <Text color={SemanticColors.text.link} wrap="wrap">
            {url}
          </Text>
        </Box>
        <Box>
          <Text color={Colors.Comment} dimColor wrap="wrap">
            Or copy this URL: {url}
          </Text>
        </Box>
        <Box>
          <Text color={Colors.Comment} dimColor wrap="wrap">
            Tip: run /mouse off to select/copy and click links (then /mouse on
            to re-enable wheel scrolling).
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
