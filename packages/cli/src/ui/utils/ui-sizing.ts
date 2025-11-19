/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { lerp } from '../../utils/math.js';
import { type LoadedSettings } from '../../config/settings.js';

/**
 * Calculate main area width based on terminal width and settings.
 * This provides consistent width calculations across the UI.
 */
export const calculateMainAreaWidth = (
  terminalWidth: number,
  settings?: LoadedSettings,
): number => {
  const useFullWidth = settings?.merged.useFullWidth ?? true;

  if (useFullWidth) {
    return terminalWidth;
  }

  const getMainAreaWidthInternal = (terminalWidth: number): number => {
    if (terminalWidth <= 80) {
      return Math.round(0.98 * terminalWidth);
    }
    if (terminalWidth >= 132) {
      return Math.round(0.9 * terminalWidth);
    }

    // Linearly interpolate between 80 columns (98%) and 132 columns (90%).
    const t = (terminalWidth - 80) / (132 - 80);
    return Math.round(lerp(0.98, 0.9, t));
  };

  return getMainAreaWidthInternal(terminalWidth);
};
