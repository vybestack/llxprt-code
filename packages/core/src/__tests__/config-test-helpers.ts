/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TestMcpRuntime } from '@vybestack/llxprt-code-test-utils/core/config.js';

export {
  makeFakeConfig,
  createTestAgentClient,
} from '@vybestack/llxprt-code-test-utils/core/config.js';

import { initializeTestConfig as initializeConfig } from '@vybestack/llxprt-code-test-utils/core/config.js';

export async function initializeTestConfig(
  ...args: Parameters<typeof initializeConfig>
): Promise<TestMcpRuntime> {
  const runtime = await initializeConfig(...args);
  return runtime;
}
