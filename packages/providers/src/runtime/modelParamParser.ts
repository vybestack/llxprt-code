/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parse a model parameter value provided via CLI or slash commands.
 * Attempts numeric, boolean, and JSON decoding before falling back to raw string.
 */
export function parseModelParamValue(value: string): unknown {
  // Numeric validation without regex: check if the string represents a valid number
  const trimmed = value.trim();
  const num = Number(trimmed);
  if (trimmed !== '' && Number.isFinite(num)) {
    return num;
  }

  const lower = value.toLowerCase();
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
