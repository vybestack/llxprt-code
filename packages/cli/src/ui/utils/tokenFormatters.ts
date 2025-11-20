/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P07
 */

/**
 * Format tokens per minute with K/M suffixes for readability
 * @param tpm Tokens per minute value
 * @returns Formatted string with appropriate suffix
 */
export const formatTokensPerMinute = (tpm: number): string => {
  if (tpm < 1000) {
    return tpm.toString();
  } else if (tpm < 1000000) {
    return `${(tpm / 1000).toFixed(1)}K`;
  } else {
    return `${(tpm / 1000000).toFixed(1)}M`;
  }
};

/**
 * Format throttle wait time in milliseconds to seconds or minutes
 * @param ms Wait time in milliseconds
 * @returns Formatted string with appropriate units
 */
export const formatThrottleTime = (ms: number): string => {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    return `${(ms / 60000).toFixed(1)}m`;
  }
};

/**
 * Format session token usage for CLI display
 * @param usage Token usage object with input, output, cache, tool, thought, and total fields
 * @returns Formatted string for CLI display
 */
export function formatSessionTokenUsage(usage: {
  input: number;
  output: number;
  cache: number;
  tool: number;
  thought: number;
  total: number;
}): string {
  return `Session Tokens - Input: ${usage.input.toLocaleString()}, Output: ${usage.output.toLocaleString()}, Cache: ${usage.cache.toLocaleString()}, Tool: ${usage.tool.toLocaleString()}, Thought: ${usage.thought.toLocaleString()}, Total: ${usage.total.toLocaleString()}`;
}
