/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import fc from 'fast-check';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';

import { projectCurrentSequenceModel } from '../agentStatsProjector.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';

describe('Agent current sequence model delegation', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const suiteReleases: Array<() => Promise<void>> = [];
  afterAll(async () => runCleanupSteps(suiteReleases.splice(0).reverse()));
  beforeAll(async () => {
    const prompts = await mkdtemp(join(tmpdir(), 'sequence-model-prompts-'));
    suiteReleases.push(() => rm(prompts, { recursive: true, force: true }));
    const previous = process.env.LLXPRT_PROMPTS_DIR;
    suiteReleases.push(async () => {
      if (previous === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
      else process.env.LLXPRT_PROMPTS_DIR = previous;
    });
    process.env.LLXPRT_PROMPTS_DIR = prompts;
    await initializePromptSystem();
  });
  let built: RouteAAgent;
  afterEach(async () => built.close());
  beforeEach(async () => {
    built = await openRouteAAgent();
  });
  it('T9b null remains a genuine public contract value across repeated calls', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 25 }), async (count) => {
        for (let index = 0; index < count; index++)
          expect(built.agent.getCurrentSequenceModel()).toBeNull();
      }),
    );
  });
  it('T9c the actual projection used by Agent guards an absent pre-initialization client', () => {
    expect(projectCurrentSequenceModel(undefined)).toBeNull();
  });
});
