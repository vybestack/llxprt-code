/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Determines if the terminal width is considered narrow.
 * Narrow terminals need special layout adaptations.
 */
export const isNarrowWidth = (terminalWidth: number): boolean =>
  terminalWidth <= 80;
