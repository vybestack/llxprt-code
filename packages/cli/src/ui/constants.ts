/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const EstimatedArtWidth = 59;
const BoxBorderWidth = 1;
export const BOX_PADDING_X = 1;

// Calculate width based on art, padding, and border
export const UI_WIDTH =
  EstimatedArtWidth + BOX_PADDING_X * 2 + BoxBorderWidth * 2; // ~63

export const STREAM_DEBOUNCE_MS = 100;

export const SHELL_COMMAND_NAME = 'Shell Command';

export const SHELL_NAME = 'Shell';

// Tool status symbols used in ToolMessage component
export const TOOL_STATUS = {
  SUCCESS: '[OK]',
  PENDING: 'o',
  EXECUTING: '⊷',
  CONFIRMING: '?',
  CANCELED: '-',
  ERROR: 'x',
} as const;

export const SHELL_FOCUS_HINT_DELAY_MS = 5000;

// Maximum number of MCP resources to display per server before truncating
export const MAX_MCP_RESOURCES_TO_SHOW = 10;

export const WARNING_PROMPT_DURATION_MS = 1000;
export const QUEUE_ERROR_DISPLAY_DURATION_MS = 3000;
export const SHELL_ACTION_REQUIRED_TITLE_DELAY_MS = 30000;
export const LRU_BUFFER_PERF_CACHE_LIMIT = 20000;
