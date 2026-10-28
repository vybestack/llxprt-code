/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { HookEventName } from '@vybestack/llxprt-code-core/hooks/types.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { buildPropertyAgent } from './helpers/agentHarness.js';

describe('public shutdown runtime ordering', () => {
  it('fires SessionEnd before retiring the workspace policy', async () => {
    const create = McpRuntimeOwner.create;
    const runtimes: McpRuntimeOwner[] = [];
    const capture = spyOn(McpRuntimeOwner, 'create').mockImplementation(
      async (...inputs) => {
        const runtime = await create(...inputs);
        runtimes.push(runtime);
        return runtime;
      },
    );
    try {
      const built = await buildPropertyAgent('plain-text.jsonl', {
        mcpEnabled: false,
        skillsSupport: false,
        recording: { enabled: false },
        telemetry: { enabled: false },
      });
      const runtime = runtimes[0];
      const observed: unknown[] = [];
      const stop = built.agent.hooks.onHookExecution((request) => {
        if (request.event !== HookEventName.SessionEnd) return;
        try {
          observed.push(runtime.policyInspection.getDefaultDecision());
        } catch (error) {
          observed.push(error);
        }
      });
      try {
        const decision = runtime.policyInspection.getDefaultDecision();
        await built.agent.dispose();
        expect(observed).toStrictEqual([decision]);
        expect(() => runtime.policyInspection.getDefaultDecision()).toThrow(
          'disposed',
        );
      } finally {
        stop();
        await built.cleanup();
      }
    } finally {
      capture.mockRestore();
    }
  });
});
