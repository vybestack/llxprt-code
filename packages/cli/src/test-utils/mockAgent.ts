/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';

/**
 * Minimal fake {@link Agent} satisfying the threaded `agent` prop in UI tests.
 *
 * The interactive component suites mock the streaming hooks wholesale, so the
 * Agent itself is never exercised — it only needs to satisfy the type and prove
 * the component mounts when given one. Centralizing the stub here keeps the
 * ongoing Agent-prop migration (#1595) from turning future contract tweaks into
 * multi-file copy edits.
 */
export function createMockAgent(config: Config): Agent {
  return {
    dispose: vi.fn().mockResolvedValue(undefined),
    getConfig: () => config,
  } as unknown as Agent;
}
