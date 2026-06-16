/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Engine-owned multi-turn agentic loop.
 */

export { AgenticLoop } from './AgenticLoop.js';
export type {
  AgenticLoopEvent,
  AgenticLoopOptions,
  AgenticLoopMessage,
  ApprovalHandler,
  ApprovalResult,
} from './types.js';
export {
  splitPartsByRole,
  classifyCompletedTools,
  buildToolResponses,
  recordCancelledToolHistory,
} from './loopHelpers.js';
