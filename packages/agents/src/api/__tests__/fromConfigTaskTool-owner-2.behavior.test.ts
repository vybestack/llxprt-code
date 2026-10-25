import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { beforeAll, afterAll, describe, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { type Agent } from '@vybestack/llxprt-code-agents';
import { ASYNC_PROPERTY_TIMEOUT_MS } from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import * as fc from 'fast-check';

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
 * These tests adopt a Config the caller built via fromConfig and observe the
 * returned Agent's runtime. Caller-supplied registrations and
 * excludeTools governance must never be overridden by the reconcile.
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

  it(
    'T3a-PROP for any non-empty sessionId, a caller-initialized Config without a task-tool registration gains the shipped task tool on adoption @requirement:REQ-3222-AC2 @scenario:property-reconcile @given:any non-empty sessionId @when:fromConfig({ config, sessionId, messageBus }) @then:the agent runtime lists the "task" tool for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const route = await openRouteAAgent({
            authority: credentials().authority,
            intent: { sessionId },
          });
          try {
            return agentToolNames(route.agent).includes('task');
          } finally {
            await route.close();
          }
        }),
        { numRuns: 5 },
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );
});
