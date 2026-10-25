import { useConsumerPromptDirectory } from './helpers/consumer-owner-primitives.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { describe, expect, it } from 'bun:test';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { type Agent, type AgentEvent } from '@vybestack/llxprt-code-agents';
import { drain, countType, buildAgent } from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';
import * as fc from 'fast-check';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P19
 * @requirement:REQ-INT-001
 *
 * Broad parity harness — config-injection surface. Exercises the SAME public
 * entry points the eventual #1595 CLI will use (`fromConfig`, `agent.stream`,
 * `agent.getConfig`, `agent.getRuntimeId`, `agent.getProvider`, `agent.getModel`,
 * `agent.dispose`) against a REAL CLI-style Config + a REAL FakeProvider JSONL
 * fixture. This is a PARITY-EXPANSION / VERIFICATION gate (NOT a RED TDD phase):
 * the seams it characterizes (fromConfig adoption=P09, runtime/getRuntimeId=P18,
 * ownership contrast=P09/P24) are already implemented, so a PASSING suite is the
 * success condition.
 *
 * Scenarios (mirroring pseudocode cli-integration-adapter.md lines 10-34):
 *   T1  — fromConfig adopts the external Config: the agent is bound to the caller's Config,
 *         getRuntimeId() is a non-empty string, and agent.stream('hello') ends
 *         with exactly one terminal done.
 *   T6  — runtime reuse: the adopted Config's active provider/model are reflected
 *         on the agent (getProvider()==='fake', getModel()==='fake-model'),
 *         proving the adopted Config's provider runtime governs — no second
 *         ProviderManager.
 *   T7  — ownership contrast: a fromConfig-supplied Config stays CALLER-owned
 *         (still usable after agent.dispose()), while a createAgent-built agent
 *         DOES dispose its OWN Config.
 */

describe('config-injection parity @plan:PLAN-20260621-COREAPIREMED.P19 @requirement:REQ-INT-001', () => {
  useConsumerPromptDirectory();

  const credentials = useOwnedCredentials();
  const replayFixture = useFakeResponsesReplay('plain-text.jsonl');

  it('T1 fromConfig adopts the external Config: Config identity, non-empty runtimeId, single terminal done (REQ-INT-001)', async () => {
    replayFixture('parity-toolcall.jsonl');
    const built = await openRouteAAgent({
      authority: credentials().authority,
      config: { interactive: true, includeDirectories: [process.cwd()] },
    });
    try {
      const agent: Agent = built.agent;

      // REQ-INT-001: the agent reports a non-empty runtime id.
      const id = agent.getRuntimeId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      // REQ-INT-001: a stream turn ends with exactly one terminal done.
      const events: AgentEvent[] = await drain(agent.stream('hello'));
      expect(countType(events, 'done')).toBe(1);

      // REQ-INT-001: the agent is bound to the SAME Config instance: a change
      // made on the caller's Config is what the agent reports.
      built.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
      expect(agent.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);
    } finally {
      await built.close();
    }
  }, 30000);

  it('T6 runtime reuse: the adopted Config active provider/model are reflected on the agent (no second ProviderManager) (REQ-INT-001.2)', async () => {
    const built = await openRouteAAgent({ authority: credentials().authority });
    try {
      const config = built.config;
      const agent: Agent = built.agent;
      // The agent's provider/model reflect the ADOPTED Config's active runtime.
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model');

      // Parity: the agent values equal the Config's own active values.
      const configuredProvider = config.getProvider();
      if (configuredProvider === undefined)
        throw new Error('Missing configured provider');
      expect(agent.getProvider()).toBe(configuredProvider);
      expect(agent.getModel()).toBe(config.getModel());
    } finally {
      await built.close();
    }
  }, 30000);

  it('T7 ownership contrast (half A): a fromConfig-supplied Config stays CALLER-owned — still usable after agent.dispose() (REQ-INT-001.3)', async () => {
    const built = await openRouteAAgent({ authority: credentials().authority });
    try {
      await built.agent.dispose();

      // The caller-supplied Config is STILL usable: reading ephemeral settings
      // does not throw and returns a real object.
      const settings = built.settings.getAllGlobalSettings();
      expect(typeof settings).toBe('object');
      expect(settings).not.toBeNull();
    } finally {
      await built.close();
    }
  }, 30000);

  it('T7 ownership contrast (half B): a createAgent-built agent disposes its OWN Config — agentClient is torn down on dispose (REQ-INT-001.3)', async () => {
    // buildAgent constructs via the public createAgent over the FakeProvider
    // seam with a real working directory (the createAgent-owned Config path).
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // PRE-dispose sanity: the agent-owned client is not yet torn down.
      await expect(agent.getHistory()).resolves.toStrictEqual([]);
      await agent.dispose();
      // POST-dispose: the createAgent-owned Config IS torn down.
      await expect(agent.getHistory()).rejects.toThrow(/disposed/);
    } finally {
      await cleanup();
    }
  }, 30000);

  // ─── Property-based (>=30% of total) ─────────────────────────────────────

  it('PROP runtime reuse: for any non-empty sessionId, the adopted Config provider/model are reflected on the agent (REQ-INT-001.2)', async () => {
    await expect(
      fc.assert(
        createPROPRuntimeReuseForAnyNonEmptySessionIdTheAdoptedConfigProviderProperty(
          credentials().authority,
        ),
      ),
    ).resolves.toBeUndefined();
  }, 30000);

  function createPROPRuntimeReuseForAnyNonEmptySessionIdTheAdoptedConfigProviderProperty(
    authority: ReturnType<typeof credentials>['authority'],
  ) {
    return fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
      const built = await openRouteAAgent({
        authority,
        intent: {
          sessionId,
          activation: { provider: 'fake', model: 'fake-model' },
        },
      });
      try {
        const agent: Agent = built.agent;
        return (
          agent.getProvider() === 'fake' &&
          agent.getModel() === 'fake-model' &&
          agent.getProvider() === built.config.getProvider() &&
          agent.getModel() === built.config.getModel()
        );
      } finally {
        await built.close();
      }
    });
  }

  it('PROP adoption identity: for any non-empty sessionId, the agent is bound to the caller-supplied Config (REQ-INT-001)', async () => {
    const authority = credentials().authority;
    await fc.assert(
      fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
        const built = await openRouteAAgent({
          authority,
          intent: {
            sessionId,
            activation: { provider: 'fake', model: 'fake-model' },
          },
        });
        try {
          built.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
          return built.agent.getApprovalMode() === ApprovalMode.AUTO_EDIT;
        } finally {
          await built.close();
        }
      }),
    );
  }, 30000);
});
