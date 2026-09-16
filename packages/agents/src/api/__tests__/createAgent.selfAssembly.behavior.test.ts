/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC1
 *
 * Behavioral suite for issue #3222: createAgent must be the self-contained,
 * agent-owned runtime assembly path. This test process never imports any CLI
 * module and never registers anything globally, so every shipped-tool and
 * cleanup behavior asserted here must be provided by createAgent itself.
 *
 * RED basis (main @ 5bedbd238): createAgent supplies agentClientFactory and
 * toolSchedulerFactory itself but NOT taskToolRegistration — TaskTool
 * availability silently depends on the CLI having registered factories into
 * the providers package-global seam first. In this process that seam is empty,
 * so the shipped task tool is absent from the agent's tool surface and a
 * failed activation leaks the isolated runtime handle.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { getAgentRuntimeStateSubscriptionCount } from '@vybestack/llxprt-code-core';
import {
  disposeCliRuntime,
  getCliRuntimeServices,
  runWithRuntimeScope,
} from '@vybestack/llxprt-code-providers/runtime.js';
import {
  buildAgent,
  ASYNC_PROPERTY_TIMEOUT_MS,
} from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';

/** Forces a deterministic fatal activation failure AFTER the isolated runtime exists. */
const failingActivation = {
  provider: 'definitely-not-a-registered-provider',
  providerSwitchPolicy: 'strict',
} as const;

describe('createAgent self-contained assembly @plan:ISSUE-3222 @requirement:REQ-3222-AC1', () => {
  it('T1 registers the shipped task tool observable through the public tool surface without any CLI composition root @requirement:REQ-3222-AC1 @scenario:no-cli-import @given:createAgent driven in a process that never imported a CLI module or registered factories globally @when:the agent is constructed @then:agent.tools.list() contains an entry named "task" whose handle resolves through agent.tools.get("task")', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const names = agent.tools.list().map((tool) => tool.name);
      expect(names).toContain('task');
      expect(agent.tools.get('task')).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it(
    'T1-PROP for any sessionId the shipped task tool is present and enabled @requirement:REQ-3222-AC1 @scenario:no-cli-import @given:an arbitrary non-blank sessionId @when:createAgent runs @then:the tool surface lists "task" as enabled',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
            sessionId,
          });
          try {
            const taskEntry = agent.tools
              .list()
              .find((tool) => tool.name === 'task');
            expect(taskEntry).toBeDefined();
            expect(taskEntry?.enabled).toBe(true);
          } finally {
            await cleanup();
          }
        }),
        { numRuns: 3 },
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );

  it('T5 a post-assembly activation failure cleans up the isolated runtime handle and surfaces the original error @requirement:REQ-3222-AC5 @scenario:activation-failure @given:createAgent with a strict activation intent naming a provider that is not registered (fails AFTER the isolated runtime exists) @when:createAgent rejects @then:the error names the activation failure and the runtime registry no longer resolves services for that runtimeId', async () => {
    const runtimeId = 'issue3222-createagent-failure-cleanup';
    try {
      await expect(
        buildAgent('plain-text.jsonl', {
          sessionId: runtimeId,
          activation: failingActivation,
        }),
      ).rejects.toThrow(/createAgent activation failed/);

      expect(() =>
        runWithRuntimeScope({ runtimeId, metadata: {} }, () =>
          getCliRuntimeServices(),
        ),
      ).toThrow(/runtime registration|runtime.*not/i);
    } finally {
      await disposeCliRuntime(runtimeId);
    }
  });

  it('T5-surface the original activation error is surfaced verbatim (never a bare cleanup error) @requirement:REQ-3222-AC5 @scenario:cleanup-also-fails @given:a createAgent activation failure @when:the rejection is observed @then:the rejection names the activation failure and its underlying provider-not-found cause', async () => {
    const runtimeId = 'issue3222-createagent-failure-surface';
    try {
      await expect(
        buildAgent('plain-text.jsonl', {
          sessionId: runtimeId,
          activation: failingActivation,
        }),
      ).rejects.toThrow(
        /createAgent activation failed.*definitely-not-a-registered-provider/,
      );
    } finally {
      await disposeCliRuntime(runtimeId);
    }
  });

  // The AgentClient constructed during config.initialize() is the ONLY
  // production subscriber to the module-global agent runtime-state registry,
  // and it unsubscribes only from AgentClient.dispose() — which runs solely
  // inside Config.dispose(). The subscription count for the runtimeId is
  // therefore a behavioral observable of agent-owned Config disposal that
  // needs no mock: 0 before bootstrap, and back to 0 after the failed
  // createAgent only if the failure path disposed the Config (a leak leaves
  // it at 1). The AggregateError-when-cleanup-also-fails branch of the shared
  // helper is not triggered here: forcing handle.cleanup() to fail requires
  // swapping the process-global isolated-runtime bindings mid-suite, which
  // would poison every sibling test's runtime teardown.
  it('T6 a post-initialize activation failure disposes the agent-owned Config and still surfaces the original error @requirement:REQ-3222-AC5 @scenario:activation-failure-config-dispose @given:createAgent with a strict activation intent that fails AFTER config.initialize() subscribed the AgentClient to the runtime-state registry @when:createAgent rejects @then:the runtime-state subscription count for the runtimeId is back to 0 (the agent-owned Config was disposed) and the rejection names the activation failure', async () => {
    const runtimeId = 'issue3222-createagent-failure-config-dispose';
    expect(getAgentRuntimeStateSubscriptionCount(runtimeId)).toBe(0);
    try {
      await expect(
        buildAgent('plain-text.jsonl', {
          sessionId: runtimeId,
          activation: failingActivation,
        }),
      ).rejects.toThrow(
        /createAgent activation failed.*definitely-not-a-registered-provider/,
      );

      expect(getAgentRuntimeStateSubscriptionCount(runtimeId)).toBe(0);
    } finally {
      await disposeCliRuntime(runtimeId);
    }
  });
});
