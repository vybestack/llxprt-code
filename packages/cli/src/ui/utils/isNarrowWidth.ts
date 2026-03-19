/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Determines if the terminal width is narrow (less than 60 columns).
 * @param width - The terminal width in columns
 * @returns true if width is less than 60
 */
export function isNarrowWidth(width?: number): boolean {
  return (width ?? 80) < 60;
}
