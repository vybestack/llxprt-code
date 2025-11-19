/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Linear interpolation between two values.
 * @param start - The start value
 * @param end - The end value
 * @param t - The interpolation factor (0-1)
 * @returns The interpolated value
 */
export const lerp = (start: number, end: number, t: number): number =>
  start + (end - start) * Math.max(0, Math.min(1, t));
