/**
 * @plan:PLAN-20260617-COREAPI.P07
 * @requirement:REQ-018
 *
 * Non-breaking top-level barrel (additive only; #1595 owns the final trim).
 *
 * Low-level symbols are re-exported from './internals.js' (single source) so
 * the top-level and the `./internals.js` subpath stay in sync. The new public
 * Agent API is re-exported from './api/index.js'. No existing top-level symbol
 * was removed — verified against HEAD.
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskToolRegistration } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import { createTaskRegistration } from './api/runtimeFactories.js';

export * from './internals.js';
export * from './api/index.js';
// Disambiguate names that exist in BOTH barrels with different meanings.
// Explicit named re-exports take precedence over ambiguous `export *` merges,
// preserving the existing low-level top-level definitions (non-breaking).
// ApprovalHandler: low-level (agenticLoop) vs api (config-types callback)
export type {
  AgenticLoopMessage,
  ApprovalHandler,
} from './core/agenticLoop/types.js';
// CompressionResult: low-level (core compression types) vs api (agent.ts)
export type { CompressionResult } from '@vybestack/llxprt-code-core/core/compression/types.js';

/**
 * @plan PLAN-20260610-ISSUE1592.P03
 * @requirement REQ-INV-003
 *
 * Creates the core-owned TaskToolRegistration descriptor without requiring core
 * to import the concrete agents-owned TaskTool class.
 */
export function createTaskToolRegistration(): TaskToolRegistration {
  return createTaskRegistration();
}
