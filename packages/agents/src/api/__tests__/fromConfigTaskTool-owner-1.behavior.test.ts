import { beforeAll, afterAll, afterEach, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type Agent } from '@vybestack/llxprt-code-agents';
import type { ProviderActivationIntent } from '../config-types.js';
import { AgentProfilePreflight } from '../profile-preflight.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC2
 *
 * BEHAVIORAL suite for fromConfig's task-tool reconciliation on Configs the
 * CALLER initialized before adoption (review finding on #3222):
 * ensureAgentRuntimeFactories installs the shipped task-tool registration as
 * a field default, but the registration is consumed only at tool-registry
 * construction and ensureInitialized is a no-op for an already-initialized
 * Config — so the registry the caller built stays without the task tool
 * unless adoption carries the late-installed default into the LIVE registry.
 * These tests adopt a Config the caller built and observe the returned
 * Agent's runtime. excludeTools governance must never be overridden by the
 * reconcile.
 */

/** The agent runtime's projected tool-name surface. */
function agentToolNames(agent: Agent): readonly string[] {
  return agent.tools.list().map((tool) => tool.name);
}

describe('fromConfig task-tool reconcile @plan:ISSUE-3222 @requirement:REQ-3222-AC2', () => {
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
  useFakeResponsesReplay('plain-text.jsonl');

  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('T3c excludeTools governance is never overridden: a caller-excluded task tool stays absent after the reconcile @requirement:REQ-3222-AC2 @scenario:exclusion-respected @given:a caller-initialized Config with excludeTools ["task"] and NO taskToolRegistration @when:fromConfig({ config, sessionId, messageBus }) @then:the shipped task tool is still NOT registered (the deny-list wins over the reconcile)', async () => {
    const route = await openRouteAAgent({
      authority: credentials().authority,
      config: { excludeTools: ['task'] },
      intent: { sessionId: 'issue3222-fromconfig-tasktool-excluded' },
    });
    cleanups.push(() => route.close());

    expect(route.agent.tools.get('task')).toBeUndefined();
    expect(agentToolNames(route.agent)).not.toContain('task');
  });

  it('T3d a preflight-installed default registration still reaches the LIVE registry: preflightAgentActivation between caller initialization and fromConfig adoption must not suppress the reconcile @requirement:REQ-3222-AC2 @scenario:preflight-then-adopt @given:a caller-initialized CLI-style Config (agent-client factory present, NO taskToolRegistration, registry built without the task tool) on which preflightAgentActivation then installed the DEFAULT registration as a field @when:fromConfig({ config, sessionId, messageBus, activation, activationPreflightToken }) adopts the SAME Config consuming the preflight token @then:the LIVE registry has the shipped task tool and the agent runtime lists "task" (a registration FIELD installed by an earlier agent entrypoint is not caller provenance)', async () => {
    const route = await openRouteBPreflight({
      authority: credentials().authority,
      runtimeId: 'issue3222-fromconfig-tasktool-preflight',
    });
    cleanups.push(() => route.close());
    await route.prepare();

    const intent: ProviderActivationIntent = {
      provider: 'fake',
      cliOverrides: { key: 'sk-test-key' },
      authMode: 'auto',
    };
    const preflight = await route.preflight.preflight(intent);
    expect(preflight.authFailed).toBe(false);
    const token = preflight.token;
    expect(token).toBeDefined();
    if (!token)
      throw new Error('Preflight did not produce an activation token');

    const agent: Agent = await AgentProfilePreflight.createForegroundAgent(
      route.preflight,
      token,
      intent,
      {},
    );
    cleanups.push(() => agent.dispose());

    // The default registration preflight installed must reach the LIVE
    // registry: "a registration exists" is not "the caller supplied it".
    expect(agent.tools.get('task')).toBeDefined();
    expect(agentToolNames(agent)).toContain('task');
  });
});
