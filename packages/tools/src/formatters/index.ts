/**
 * @plan:PLAN-20260608-ISSUE1585.P05
 * @requirement:REQ-API-001
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Barrel export for package-local formatter utilities.
 *
 * All formatters are self-contained with zero core/cli/providers imports.
 */

// --- Interfaces ---
export type {
  IToolFormatter,
  ToolFormat,
  OpenAIFunction,
  OpenAITool,
  ResponsesTool,
  FormatterTool,
  ToolCallBlock,
} from './IToolFormatter.js';

// --- Implementation ---
export { ToolFormatter } from './ToolFormatter.js';

// --- Tool ID Strategy ---
export type {
  ToolIdStrategy,
  ToolIdMapper,
  ContentBlock as StrategyContentBlock,
} from './ToolIdStrategy.js';
export {
  getToolIdStrategy,
  kimiStrategy,
  standardStrategy,
  mistralStrategy,
  isKimiModel,
  isDeepSeekReasonerModel,
  isMistralModel,
} from './ToolIdStrategy.js';

// --- Utilities ---
export {
  shouldUseDoubleEscapeHandling,
  detectDoubleEscaping,
  detectDoubleEscapingInChunk,
  processToolParameters,
  logDoubleEscapingInChunk,
} from './doubleEscapeUtils.js';

export {
  normalizeToolName,
  toSnakeCase,
  isValidToolName,
  findMatchingTool,
} from './toolNameUtils.js';

export {
  normalizeToOpenAIToolId,
  normalizeToHistoryToolId,
  normalizeToAnthropicToolId,
} from './toolIdNormalization.js';
