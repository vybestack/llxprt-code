/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box } from 'ink';
// import { Colors } from '../colors.js';

export interface StickyHeaderProps {
  children: React.ReactNode;
  width: number;
  isFirst: boolean;
  borderColor: string;
  borderDimColor: boolean;
}

export const StickyHeader: React.FC<StickyHeaderProps> = ({
  children,
  width,
  isFirst,
  borderColor,
  borderDimColor,
}) => (
  <Box
    // sticky // sticky prop might not be available in all versions, checking compatibility
    minHeight={1}
    flexShrink={0}
    width={width}
    // stickyChildren={...} // stickyChildren prop might not be available in all versions, checking compatibility
  >
    <Box
      borderStyle="round"
      width={width}
      borderColor={borderColor}
      borderDimColor={borderDimColor}
      borderBottom={false}
      borderTop={isFirst}
      borderLeft={true}
      borderRight={true}
      paddingX={1}
      paddingBottom={1}
      paddingTop={isFirst ? 0 : 1}
    >
      {children}
    </Box>
  </Box>
);
