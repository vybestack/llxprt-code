/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';

describe('fromConfig real orchestration: configured vs unconfigured (#2481)', () => {
  useFakeResponsesReplay('plain-text.jsonl');
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

  const builtCredentials = useOwnedCredentials();
  let built: RouteAAgent | undefined;
  afterEach(async () => {
    await built?.close();
    built = undefined;
  });

  it('fromConfig over a real Config (buildCliStyleConfig) drives a real turn when configured', async () => {
    built = await openRouteAAgent({ authority: builtCredentials().authority });
    const { agent } = built;
    // The real Config has FakeProvider active (configured state).
    expect(agent.getProvider()).toBeDefined();

    // A real stream turn must resolve with exactly one done event.
    const events: Array<{ type: string; reason?: string }> = [];
    for await (const event of agent.stream('hello')) {
      events.push(event as { type: string; reason?: string });
    }
    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
  });

  it('first Agent selection: fromConfig picks up the configured active provider', async () => {
    built = await openRouteAAgent({ authority: builtCredentials().authority });
    // The agent should reflect the active FakeProvider, not a sentinel.
    const provider = built.agent.getProvider();
    expect(provider).toBeDefined();
    expect(provider).not.toBe('unconfigured');
  });
});
