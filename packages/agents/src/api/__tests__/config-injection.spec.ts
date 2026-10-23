import { capturedSessionClient } from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { useConsumerPromptDirectory } from './helpers/consumer-owner-primitives.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  openCaller,
  useFakeResponsesReplay,
} from './helpers/caller-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { describe, expect, it } from 'bun:test';
import { type Agent, type AgentEvent } from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  drain,
  countType,
  buildAgent,
  internalConfig,
} from './helpers/agentHarness.js';
import { captureProbe, agentClientDisposed } from './helpers/disposalProbe.js';
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
 *   T1  — fromConfig adopts the external Config: internalConfig(agent) === config identity,
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
  const callerFactories = createAgentRuntimeFactoryBindings();
  const replayFixture = useFakeResponsesReplay('plain-text.jsonl');

  it('T1 fromConfig adopts the external Config: internalConfig() identity, non-empty runtimeId, single terminal done (REQ-INT-001)', async () => {
    replayFixture('parity-toolcall.jsonl');
    const caller = await openCaller(credentials().authority, callerFactories);
    try {
      const config = caller.config;
      // onApproval mirrors Path B's ProceedOnce so the tool's confirmation
      // request is answered (the established headless-approval pattern).
      const agent: Agent = await fromConfig(
        config,
        caller.settings,
        {},
        caller.settingsOwner,
        caller.manager,
        undefined,
        undefined,
        caller.mcp,
        undefined,
        capturedSessionClient(caller.owner),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        () => ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        // REQ-INT-001: the adopted Config is the SAME instance.
        expect(internalConfig(agent)).toBe(config);

        // REQ-INT-001: the agent reports a non-empty runtime id.
        const id = agent.getRuntimeId();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);

        // REQ-INT-001: a stream turn ends with exactly one terminal done.
        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
      } finally {
        await agent.dispose();
      }
    } finally {
      await caller.close();
    }
  }, 30000);

  it('T6 runtime reuse: the adopted Config active provider/model are reflected on the agent (no second ProviderManager) (REQ-INT-001.2)', async () => {
    const caller = await openCaller(credentials().authority, callerFactories);
    try {
      const config = caller.config;
      const agent: Agent = await fromConfig(
        config,
        caller.settings,
        {},
        caller.settingsOwner,
        caller.manager,
        undefined,
        undefined,
        caller.mcp,
        undefined,
        capturedSessionClient(caller.owner),
      );
      try {
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
        await agent.dispose();
      }
    } finally {
      await caller.close();
    }
  }, 30000);

  it('T7 ownership contrast (half A): a fromConfig-supplied Config stays CALLER-owned — still usable after agent.dispose() (REQ-INT-001.3)', async () => {
    const caller = await openCaller(credentials().authority, callerFactories);
    try {
      const config = caller.config;
      const agent: Agent = await fromConfig(
        config,
        caller.settings,
        {},
        caller.settingsOwner,
        caller.manager,
        undefined,
        undefined,
        caller.mcp,
        undefined,
        capturedSessionClient(caller.owner),
      );
      await agent.dispose();

      // The caller-supplied Config is STILL usable: reading ephemeral settings
      // does not throw and returns a real object.
      const settings = caller.settings.getAllGlobalSettings();
      expect(typeof settings).toBe('object');
      expect(settings).not.toBeNull();
    } finally {
      await caller.close();
    }
  }, 30000);

  it('T7 ownership contrast (half B): a createAgent-built agent disposes its OWN Config — agentClient is torn down on dispose (REQ-INT-001.3)', async () => {
    // buildAgent constructs via the public createAgent over the FakeProvider
    // seam with a real working directory (the createAgent-owned Config path).
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const probe = captureProbe(agent);
      // PRE-dispose sanity: the agent-owned client is not yet torn down.
      expect(agentClientDisposed(probe)).toBe(false);
      await agent.dispose();
      // POST-dispose: the createAgent-owned Config IS torn down.
      expect(agentClientDisposed(probe)).toBe(true);
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
      const caller = await openCaller(authority, callerFactories);
      try {
        const agent: Agent = await fromConfig(
          caller.config,
          caller.settings,
          { sessionId },
          caller.settingsOwner,
          caller.manager,
          undefined,
          undefined,
          caller.mcp,
          undefined,
          capturedSessionClient(caller.owner),
        );
        try {
          return (
            agent.getProvider() === 'fake' &&
            agent.getModel() === 'fake-model' &&
            agent.getProvider() === caller.config.getProvider() &&
            agent.getModel() === caller.config.getModel()
          );
        } finally {
          await agent.dispose();
        }
      } finally {
        await caller.close();
      }
    });
  }

  it('PROP adoption identity: for any non-empty sessionId, internalConfig(agent) === the caller-supplied Config (REQ-INT-001)', async () => {
    const authority = credentials().authority;
    await fc.assert(
      fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
        const caller = await openCaller(authority, callerFactories);
        try {
          const agent: Agent = await fromConfig(
            caller.config,
            caller.settings,
            { sessionId },
            caller.settingsOwner,
            caller.manager,
            undefined,
            undefined,
            caller.mcp,
            undefined,
            capturedSessionClient(caller.owner),
          );
          try {
            return internalConfig(agent) === caller.config;
          } finally {
            await agent.dispose();
          }
        } finally {
          await caller.close();
        }
      }),
    );
  }, 30000);
});
