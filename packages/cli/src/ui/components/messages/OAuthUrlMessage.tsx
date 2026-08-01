/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text, Box } from 'ink';
import { Colors, SemanticColors } from '../../colors.js';
import { createUrlLink } from '../../utils/terminalLinks.js';

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

  const clickHereLabel = `Click here to authorize with ${provider}`;
  const clickHereLink = createUrlLink(url, clickHereLabel) ?? clickHereLabel;
  // The full URL is the PRIMARY click target: both the OSC 8 target and the
  // visible label are the complete URL. This makes the URL copyable and
  // clickable even when OSC 8 metadata is unsupported or stripped, and Ink's
  // wrapping re-emits the hyperlink on every wrapped row. `createUrlLink`
  // returns null for a URL that must not be linkified (non-http(s) scheme or
  // control characters); the raw URL is still displayed so the user can see
  // and copy what the provider returned.
  const urlLink = createUrlLink(url);

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
          <Text color={SemanticColors.text.link}>{clickHereLink}</Text>
        </Box>
        <Box>
          <Text color={Colors.DimComment}>Or copy this URL:</Text>
        </Box>
        <Box>
          <Text color={SemanticColors.text.link} wrap="wrap">
            {urlLink ?? url}
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
