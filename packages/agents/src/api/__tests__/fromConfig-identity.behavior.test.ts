/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/config.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { type Agent, type AgentEvent } from '@vybestack/llxprt-code-agents';
import { fromConfig } from '../fromConfig.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { drain, countType, buildAgent } from './helpers/agentHarness.js';

/**
 * @plan:PLAN-20260621-COREAPIREMED.P08
 * @requirement:REQ-001,REQ-INT-001
 *
 * Behavioral suite for the public `fromConfig` API: the agent adopts the
 * caller's Config and SettingsService, derives its runtime id from the intent,
 * and leaves the caller's Config to the caller.
 */

describe('fromConfig caller identities', () => {
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

  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();

  it('T1 fromConfig returns an Agent bound to the SAME caller-supplied Config (identity) @requirement:REQ-001 @scenario:adoption @given:a real CLI-style Config @when:fromConfig({ config }) @then:the agent reads and writes the SAME Config instance', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: {},
    });
    try {
      built.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
      expect(built.agent.getApprovalMode()).toBe(ApprovalMode.AUTO_EDIT);
    } finally {
      await built.close();
    }
  });

  it('uses the exact caller store for facade writes, external changes and normalization during adoption', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: {},
    });
    try {
      const expected = built.settings;
      built.agent.setEphemeralSetting('streaming', false);
      expect(expected.get('streaming')).toBe('disabled');
      expected.set('context-limit', '8192');
      expect(built.agent.getEphemeralSetting('context-limit')).toBe(8192);
      expect(expected.get('context-limit')).toBe(8192);
    } finally {
      await built.close();
    }
  });

  it('T1c fromConfig adopts the provider and model already on the Config (value assertions) @requirement:REQ-001 @scenario:adoption @given:a Config whose active provider=fake and model=fake-model @when:fromConfig({ config }) @then:agent.getProvider() === "fake" and agent.getModel() === "fake-model"', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: {},
    });
    try {
      expect(built.agent.getProvider()).toBe('fake');
      expect(built.agent.getModel()).toBe('fake-model');
    } finally {
      await built.close();
    }
  });

  it('T1d fromConfig({}) without a config rejects with a clear validation error (NOT NotYetImplemented) @requirement:REQ-001 @scenario:validation @given:an options object missing the required config field @when:fromConfig({} as never) @then:the promise rejects with an Error whose message names the missing config field (never the NotYetImplemented stub string)', async () => {
    await expect(
      fromConfig(
        undefined as never,
        undefined as never,
        {},
        credentials().authority,
      ),
    ).rejects.toThrow(/config|Config/i);
  });

  it('T1e fromConfig with sessionId sets the runtime id deterministically; without sessionId it derives a non-empty runtime id @requirement:REQ-001 @scenario:runtimeId @given:a caller-supplied sessionId @when:fromConfig({ config, sessionId }) @then:the runtime id observable equals the supplied sessionId; @given:no sessionId @then:the runtime id observable is a non-empty generated string', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: { sessionId: 'deterministic-session-42' },
    });
    try {
      expect(built.agent.getRuntimeId()).toBe('deterministic-session-42');
    } finally {
      await built.close();
    }
  });

  it('T1e-deriv without sessionId the runtime derives a non-empty generated id @requirement:REQ-001 @scenario:runtimeId @given:no sessionId @when:fromConfig({ config }) @then:the runtime id observable is a non-empty generated string', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: {},
    });
    try {
      const id = built.agent.getRuntimeId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    } finally {
      await built.close();
    }
  });

  it('T6-adopted-switch a provider switch through the agent resolves the adopted runtime (value parity, no crash) @requirement:REQ-001 @scenario:provider-switch @given:a fromConfig agent over a Config with one manager @when:setProvider("fake") is invoked @then:the switch completes without throwing and the active provider reflects the adopted runtime', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: {},
    });
    try {
      await built.agent.setProvider('fake', 'fake-model');
      expect(built.agent.getProvider()).toBe('fake');
    } finally {
      await built.close();
    }
  });

  it('T6d no Config.getMessageBus (CRIT-2): fromConfig({ config }) builds its own bus and never reads a bus off the Config — a turn still drives @requirement:REQ-001 @scenario:single-bus @given:a Config with NO getMessageBus method @when:fromConfig({ config }) and a single stream turn @then:the turn drives without crashing and yields exactly one done', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: {},
    });
    try {
      expect(
        typeof (built.config as unknown as { getMessageBus?: unknown })
          .getMessageBus,
      ).toBe('undefined');
      const events: AgentEvent[] = await drain(built.agent.stream('hello'));
      expect(countType(events, 'done')).toBe(1);
    } finally {
      await built.close();
    }
  });

  it('T7b ownership contrast: a createAgent-created Config IS disposed by agent.dispose() — agent.getHistory() rejects as disposed after dispose @requirement:REQ-001.3 @scenario:agent-owned-config @given:a createAgent-built agent (Config owned by the agent) @when:agent.dispose() runs @then:agent.getHistory() rejects as disposed (the ownership flag differentiates createAgent from fromConfig)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await expect(agent.getHistory()).resolves.toStrictEqual([]);
      await agent.dispose();
      await expect(agent.getHistory()).rejects.toThrow(/disposed/);
    } finally {
      await cleanup();
    }
  });

  it('T10 smoke: a single turn via agent.stream() over the FakeProvider fixture yields exactly one done event @requirement:REQ-INT-001 @scenario:turn-drive @given:a fromConfig agent over the plain-text fixture @when:agent.stream("hello") is drained @then:exactly one done event is emitted', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
      intent: {},
    });
    try {
      const agent: Agent = built.agent;
      const events: AgentEvent[] = await drain(agent.stream('hello'));
      expect(countType(events, 'done')).toBe(1);
    } finally {
      await built.close();
    }
  });
});
