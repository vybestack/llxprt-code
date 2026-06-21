/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helper for TaskTool test files. Extracted from the original
 * monolithic task.test.ts so no file-level max-lines disable is needed.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

/**
 * Creates a minimal mock Config for TaskTool tests.
 * Matches the shape used by the original task.test.ts beforeEach.
 */
export function createTaskToolConfig(): Config {
  return {
    getSessionId: () => 'session-123',
  } as unknown as Config;
}
