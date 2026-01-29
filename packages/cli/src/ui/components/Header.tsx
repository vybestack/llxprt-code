/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors, SemanticColors } from '../colors.js';
import { shortAsciiLogo, longAsciiLogo } from './AsciiArt.js';
import { getAsciiArtWidth } from '../utils/textUtils.js';
import { ThemedGradient } from './ThemedGradient.js';

interface HeaderProps {
  customAsciiArt?: string; // For user-defined ASCII art
  terminalWidth: number; // For responsive logo
  version: string;
  nightly: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  customAsciiArt,
  terminalWidth,
  version,
  nightly,
}) => {
  let displayTitle;
  const widthOfLongLogo = getAsciiArtWidth(longAsciiLogo);

  if (customAsciiArt) {
    displayTitle = customAsciiArt;
  } else {
    displayTitle =
      terminalWidth >= widthOfLongLogo ? longAsciiLogo : shortAsciiLogo;
  }

  const artWidth = getAsciiArtWidth(displayTitle);

  return (
    <Box
      alignItems="flex-start"
      width={artWidth}
      flexShrink={0}
      flexDirection="column"
    >
      {Colors.GradientColors ? (
        <ThemedGradient colors={Colors.GradientColors}>
          <Text color={Colors.Foreground}>{displayTitle}</Text>
        </ThemedGradient>
      ) : (
        <Text color={SemanticColors.text.accent}>{displayTitle}</Text>
      )}
      {nightly && (
        <Box width="100%" flexDirection="row" justifyContent="flex-end">
          <ThemedGradient colors={Colors.GradientColors}>
            <Text color={Colors.Foreground}>v{version}</Text>
          </ThemedGradient>
        </Box>
      )}
    </Box>
  );
};
