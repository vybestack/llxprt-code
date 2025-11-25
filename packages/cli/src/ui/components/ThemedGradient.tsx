/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import Gradient from 'ink-gradient';
import { Colors } from '../colors.js';

/**
 * Props for the ThemedGradient component.
 */
interface ThemedGradientProps {
  /** The content to be wrapped in the gradient. */
  children: React.ReactNode;
}

/**
 * Wraps content in a gradient using the application's theme colors.
 * This ensures consistent branding across the CLI.
 */
export const ThemedGradient: React.FC<ThemedGradientProps> = ({ children }) => (
  <Gradient colors={Colors.GradientColors}>{children}</Gradient>
);
