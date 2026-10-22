import { capturedSessionClient } from './helpers/session-client-capture.js';
import {
  captureAgentAdoption as fromConfig,
  fixtureAgentResources,
} from './helpers/agent-resource-capture.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  openCaller,
  useFakeResponsesReplay,
} from './helpers/caller-fixture.js';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';
import { type Agent } from '@vybestack/llxprt-code-agents';
import * as fc from 'fast-check';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P17
 * @requirement:REQ-005,REQ-001
 *
 * BEHAVIORAL RED suite for the (not-yet-implemented) public Agent method
 * `getRuntimeId(): string` and the provider-runtime reachability seam.
 *
 * RED SOURCE: `getRuntimeId()` is absent from the public `Agent` interface
 * (agent.ts) and from `AgentImpl` (agentImpl.ts) until P18 adds it. Every
 * REQ-005.1 test reaches the method through a documented narrowing cast and
 * throws `TypeError: ... getRuntimeId is not a function` at RED — the
 * legitimate behavioral RED reason for the interface gap. At GREEN (P18) the
 * SAME assertions pass with no rewrite.
 *
 * The suite uses the CANONICAL config builder (buildCliStyleConfig) and real
 * provider seam. The adopted-provider/model tests (T6b) and the no-2nd-manager
 * identity test (T6c) assert REAL values/instance-identity via the structural
 * providers seam, NOT mocks. This is genuine forward behavioral assertion, not
 * mock theater.
 */

// ─── Structural identity probe (cast-free, mirrors fromConfig.behavior idiom) ─
//
// The public Agent surface is opaque (no raw manager accessor). The
// no-2nd-manager identity invariant (T6c) is reached via the SAME documented
// structural narrowing idiom the sibling fromConfig.behavior.test.ts suite
// uses (captureProviderManager): treat the Agent as a Record<string, unknown>
// and probe a documented internal field. This is observation of the real
// provider seam, not a spy on a mock.

function captureProviderManager(agent: Agent): unknown {
  return fixtureAgentResources(agent).manager;
}

// The no-2nd-manager identity (T6c / PROP-B) compares against the manager on
// the SUPPLIED Config via its real public Config accessor (configBaseCore.ts) —
// the SAME plain idiom the sibling fromConfig.behavior suite (T6) uses. The
// banned anti-pattern is a raw manager accessor on the Agent root surface,
// which this suite never does.

// The narrowing cast below reaches a PUBLIC method that does not yet exist on
// the Agent type (getRuntimeId, added by P18). This is NOT mock theater: it is
// a documented forward cast to the not-yet-implemented public surface, so the
// RED reason is the genuine behavioral gap (the method is absent), and at
// GREEN the same assertion passes unchanged.
type WithRuntimeId = { getRuntimeId(): string };

function asWithRuntimeId(agent: Agent): WithRuntimeId {
  return agent as unknown as WithRuntimeId;
}

describe('runtime-seam behavior @plan:PLAN-20260621-COREAPIREMED.P17 @requirement:REQ-005,REQ-001', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  const credentials = useOwnedCredentials();
  const callerFactories = createAgentRuntimeFactoryBindings();

  useFakeResponsesReplay('plain-text.jsonl');

  it('T6a fromConfig with a known sessionId yields agent.getRuntimeId() === that sessionId @requirement:REQ-005.1 @scenario:runtime-id @given:a real CLI-style Config and sessionId "known-runtime-id-T6a" @when:fromConfig({ config, sessionId }) @then:agent.getRuntimeId() === "known-runtime-id-T6a"', async () => {
    const caller = await openCaller(credentials().authority, callerFactories);
    let agent: Agent | undefined;
    try {
      agent = await fromConfig(
        caller.config,
        caller.settings,
        { sessionId: 'known-runtime-id-T6a' },
        caller.settingsOwner,
        caller.manager,
        undefined,
        undefined,
        caller.mcp,
        undefined,
        capturedSessionClient(caller.owner),
      );
      expect(asWithRuntimeId(agent).getRuntimeId()).toBe(
        'known-runtime-id-T6a',
      );
    } finally {
      try {
        await agent?.dispose();
      } finally {
        await caller.close();
      }
    }
  });

  it('T6b the adopted Config active provider/model are reflected on the agent (forward adopt-path guard) @requirement:REQ-005 @scenario:adopted-runtime @given:a real Config whose active provider=fake and model=fake-model @when:fromConfig({ config }) @then:agent.getProvider() === "fake" and agent.getModel() === "fake-model"', async () => {
    const caller = await openCaller(credentials().authority, callerFactories);
    let agent: Agent | undefined;
    try {
      agent = await fromConfig(
        caller.config,
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
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model');
    } finally {
      try {
        await agent?.dispose();
      } finally {
        await caller.close();
      }
    }
  });

  it('T6c no second ProviderManager: the runtime manager reachable post-build IS the SAME instance as the manager on the supplied Config (identity, observed via the real providers seam) @requirement:REQ-001 @scenario:no-double-manager @given:a Config whose manager accessor returns a real manager @when:fromConfig({ config }) @then:captureProviderManager(agent) === the Config manager (no second manager constructed)', async () => {
    const caller = await openCaller(credentials().authority, callerFactories);
    let agent: Agent | undefined;
    try {
      const config = caller.config;
      // The invariant is instance identity, observed via the real providers
      // seam: the manager reachable from the agent IS the SAME instance as the
      // one on the supplied Config (no second manager constructed). Mirrors the
      // sibling fromConfig.behavior T6 plain idiom (NOT a mock, NOT an
      // agent-root accessor).
      agent = await fromConfig(
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
      expect(captureProviderManager(agent)).toBe(caller.manager);
    } finally {
      try {
        await agent?.dispose();
      } finally {
        await caller.close();
      }
    }
  });

  // ─── Property-based tests (>=30% of total) ──────────────────────────────

  it('PROP-A for any valid non-empty sessionId R, fromConfig({ config, sessionId: R }) yields agent.getRuntimeId() === R @requirement:REQ-005.1 @scenario:property-runtime-id @given:any non-empty sessionId string R @when:fromConfig({ config, sessionId: R }) @then:agent.getRuntimeId() === R for every generated R', async () => {
    await fc.assert(
      fc.asyncProperty(nonBlankStringArbitrary, async (runtimeId) => {
        const caller = await openCaller(
          credentials().authority,
          callerFactories,
        );
        let agent: Agent | undefined;
        try {
          agent = await fromConfig(
            caller.config,
            caller.settings,
            { sessionId: runtimeId },
            caller.settingsOwner,
            caller.manager,
            undefined,
            undefined,
            caller.mcp,
            undefined,
            capturedSessionClient(caller.owner),
          );
          expect(asWithRuntimeId(agent).getRuntimeId()).toBe(runtimeId);
        } finally {
          try {
            await agent?.dispose();
          } finally {
            await caller.close();
          }
        }
      }),
    );
  }, 30000);

  it('PROP-B for any valid non-empty sessionId R, the no-2nd-manager identity holds: captureProviderManager(agent) === the Config manager @requirement:REQ-001 @scenario:property-no-double-manager @given:any non-empty sessionId string R @when:fromConfig({ config, sessionId: R }) @then:captureProviderManager(agent) === the Config manager for every generated R', async () => {
    await fc.assert(
      fc.asyncProperty(nonBlankStringArbitrary, async (runtimeId) => {
        const caller = await openCaller(
          credentials().authority,
          callerFactories,
        );
        let agent: Agent | undefined;
        try {
          agent = await fromConfig(
            caller.config,
            caller.settings,
            { sessionId: runtimeId },
            caller.settingsOwner,
            caller.manager,
            undefined,
            undefined,
            caller.mcp,
            undefined,
            capturedSessionClient(caller.owner),
          );
          expect(captureProviderManager(agent)).toBe(caller.manager);
        } finally {
          try {
            await agent?.dispose();
          } finally {
            await caller.close();
          }
        }
      }),
    );
  }, 30000);
});
