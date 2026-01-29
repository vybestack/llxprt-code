/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { Colors, SemanticColors } from '../../colors.js';
import { createOsc8Link } from '../../utils/terminalLinks.js';

interface OAuthUrlMessageProps {
  text: string;
  url: string;
}

export const OAuthUrlMessage: React.FC<OAuthUrlMessageProps> = ({
  text,
  url,
}) => {
  const prefixText = '[OAUTH] ';
  const prefixWidth = prefixText.length;

  // Extract provider name from text if available
  const providerMatch = text.match(/authorize with ([^\n:]+)/i);
  const provider = providerMatch ? providerMatch[1] : 'the service';

  const osc8Link = createOsc8Link(
    `Click here to authorize with ${provider}`,
    url,
  );

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" marginBottom={1}>
        <Box width={prefixWidth}>
          <Text color={Colors.AccentBlue}>{prefixText}</Text>
        </Box>
        <Box flexGrow={1}>
          <Text bold color={Colors.AccentBlue}>
            OAuth Authentication Required for {provider}
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" paddingLeft={prefixWidth + 1}>
        <Box marginBottom={1}>
          <Text color={SemanticColors.text.link}>{osc8Link}</Text>
        </Box>
        <Box>
          <Text color={Colors.DimComment} wrap="wrap">
            Or copy this URL: {url}
          </Text>
        </Box>
        <Box>
          <Text color={Colors.DimComment} wrap="wrap">
            Tip: when mouse scrolling is enabled, drag to select and it will be
            copied to your clipboard. For terminal selection, run /mouse off
            (Ctrl+\).
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
