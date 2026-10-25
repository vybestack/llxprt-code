import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';
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
 * Behavioral suite for the public Agent method `getRuntimeId(): string` and
 * the adopted Config's active provider and model, built through the
 * production `fromConfig` entry point with a caller-owned Config.
 */

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

  useFakeResponsesReplay('plain-text.jsonl');

  it('T6a fromConfig with a known sessionId yields agent.getRuntimeId() === that sessionId @requirement:REQ-005.1 @scenario:runtime-id @given:a real CLI-style Config and sessionId "known-runtime-id-T6a" @when:fromConfig({ config, sessionId }) @then:agent.getRuntimeId() === "known-runtime-id-T6a"', async () => {
    const route = await openRouteAAgent({
      intent: { sessionId: 'known-runtime-id-T6a' },
      authority: credentials().authority,
    });
    try {
      expect(route.agent.getRuntimeId()).toBe('known-runtime-id-T6a');
    } finally {
      await route.close();
    }
  });

  it('T6b the adopted Config active provider/model are reflected on the agent (forward adopt-path guard) @requirement:REQ-005 @scenario:adopted-runtime @given:a real Config whose active provider=fake and model=fake-model @when:fromConfig({ config }) @then:agent.getProvider() === "fake" and agent.getModel() === "fake-model"', async () => {
    const route = await openRouteAAgent({
      intent: {},
      authority: credentials().authority,
    });
    try {
      expect(route.agent.getProvider()).toBe('fake');
      expect(route.agent.getModel()).toBe('fake-model');
    } finally {
      await route.close();
    }
  });

  // ─── Property-based tests (>=30% of total) ──────────────────────────────

  it('PROP-A for any valid non-empty sessionId R, fromConfig({ config, sessionId: R }) yields agent.getRuntimeId() === R @requirement:REQ-005.1 @scenario:property-runtime-id @given:any non-empty sessionId string R @when:fromConfig({ config, sessionId: R }) @then:agent.getRuntimeId() === R for every generated R', async () => {
    await fc.assert(
      fc.asyncProperty(nonBlankStringArbitrary, async (runtimeId) => {
        const route = await openRouteAAgent({
          intent: { sessionId: runtimeId },
          authority: credentials().authority,
        });
        try {
          expect(route.agent.getRuntimeId()).toBe(runtimeId);
        } finally {
          await route.close();
        }
      }),
    );
  }, 30000);
});
