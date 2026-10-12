/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { vi } from 'bun:test';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { SubagentOrchestrator } from '../../core/subagentOrchestrator.js';
export function createMockOrchestrator(agentId: string) {
  const dispose = vi.fn().mockResolvedValue(undefined);
  const scope = {
    output: {
      emitted_vars: {},
      terminate_reason: SubagentTerminateMode.GOAL,
    },
    runInteractive: vi.fn().mockResolvedValue(undefined),
    runNonInteractive: vi.fn(),
  };
  const orchestrator = {
    launch: vi.fn().mockResolvedValue({
      agentId,
      scope,
      dispose,
      prompt: {} as unknown,
      profile: {} as unknown,
      config: {} as unknown,
      runtime: {} as unknown,
    }),
  } as unknown as SubagentOrchestrator;
  return { orchestrator, scope };
}
