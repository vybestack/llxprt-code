/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskToolRegistration } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import { createTaskRegistration } from './api/runtimeFactories.js';

export * from './api/index.js';

// CompressionResult: the root barrel must export the CORE low-level
// CompressionResult (from @vybestack/llxprt-code-core/core/compression/types.js)
// for backwards compatibility — NOT the API agent.ts shape. An explicit named
// re-export placed after `export * from './api/index.js'` overrides the star
// re-export of the agent.ts CompressionResult, preserving the #1594-era root
// type identity (with newHistory and metadata) that main shipped.
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
