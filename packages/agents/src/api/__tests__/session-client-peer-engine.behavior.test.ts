/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('Explicit session client lifetime', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
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
  it('keeps same-label clients separate and leaves a sibling conversation usable after one facade closes', async () => {
    const left = await openRouteAAgent({
      config: { sessionId: 'shared-engine-label' },
      authority: credentials().authority,
    });
    let right: RouteAAgent;
    try {
      right = await openRouteAAgent({
        config: { sessionId: 'shared-engine-label' },
        authority: credentials().authority,
      });
    } catch (primary) {
      await runCleanupSteps([() => left.close()]);
      throw primary;
    }
    const a = left.agent;
    const b = right.agent;
    try {
      await a.chat('start left chat');
      await b.chat('start right chat');
      await a.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'left only' }] },
      ]);
      await b.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'right only' }] },
      ]);
      await a.dispose();
      await b.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'right continues' }],
      });
      expect(
        (await b.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(2);
      expect(
        (await b.getHistory())
          .flatMap((item) => item.blocks)
          .filter((block) => block.type === 'text')
          .map((block) => block.text),
      ).not.toContain('left only');
    } finally {
      await runCleanupSteps([() => right.close(), () => left.close()]);
    }
  }, 30000);
});
