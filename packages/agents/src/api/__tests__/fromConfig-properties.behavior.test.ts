/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, it } from 'bun:test';
import * as fc from 'fast-check';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/config.js';
import { type Agent, type AgentEvent } from '@vybestack/llxprt-code-agents';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import {
  drain,
  countType,
  ASYNC_PROPERTY_TIMEOUT_MS,
  IDENTITY_PROPERTY_TIMEOUT_MS,
} from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';

/**
 * Property suite for the public `fromConfig` API: the agent is bound to the
 * caller's `Config`, reports the supplied session id as its runtime id, and
 * drives exactly one terminal event per turn, for any non-blank session id.
 */

describe('fromConfig caller properties', () => {
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

  // ─── Property-based tests ───────────────────────────────────────────────

  it(
    'PROP1 for any valid sessionId string, fromConfig identity holds: the agent is bound to the caller Config @requirement:REQ-001 @scenario:property-identity @given:any non-empty sessionId string @when:fromConfig({ config, sessionId }) @then:a change to the caller Config is visible through the agent for every generated sessionId',
    async () => {
      const authority = credentials().authority;
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const built = await openRouteAAgent({
            authority,
            intent: { sessionId },
          });
          try {
            built.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
            return built.agent.getApprovalMode() === ApprovalMode.AUTO_EDIT;
          } finally {
            await built.close();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP2 for any valid sessionId string, the runtime id observable equals the supplied sessionId @requirement:REQ-001 @scenario:property-runtimeId @given:any non-empty sessionId string @when:fromConfig({ config, sessionId }) @then:agent.getRuntimeId() === sessionId for every generated sessionId',
    async () => {
      const authority = credentials().authority;
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const built = await openRouteAAgent({
            authority,
            intent: { sessionId },
          });
          try {
            return built.agent.getRuntimeId() === sessionId;
          } finally {
            await built.close();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP6 for any non-empty sessionId, a single stream turn yields exactly one done event (turn-drive parity) @requirement:REQ-INT-001 @scenario:property-turn-drive @given:any non-empty sessionId @when:agent.stream("hello") is drained @then:exactly one done event is emitted for every generated sessionId',
    async () => {
      const authority = credentials().authority;
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const built = await openRouteAAgent({
            authority,
            intent: { sessionId },
          });
          try {
            const agent: Agent = built.agent;
            const events: AgentEvent[] = await drain(agent.stream('hello'));
            return countType(events, 'done') === 1;
          } finally {
            await built.close();
          }
        }),
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );
});
