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
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const num = Number(value);
    if (!Number.isNaN(num)) {
      return num;
    }
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
