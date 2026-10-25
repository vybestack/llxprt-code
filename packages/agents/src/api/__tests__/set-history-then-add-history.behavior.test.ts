/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

function human(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function humanTexts(history: readonly IContent[]): string[] {
  return history
    .filter((item) => item.speaker === 'human')
    .flatMap((item) => item.blocks)
    .filter((block) => block.type === 'text')
    .map((block) => block.text);
}

describe('addHistory after setHistory', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'set-add-history-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  const credentials = useOwnedCredentials();

  it('appends to the restored history on a fresh agent', async () => {
    const route = await openRouteAAgent({ authority: credentials().authority });
    try {
      const { agent } = route;
      await agent.setHistory([human('restored first')]);
      await agent.addHistory(human('added second'));
      expect(humanTexts(await agent.getHistory())).toStrictEqual([
        'restored first',
        'added second',
      ]);
    } finally {
      await route.close();
    }
  }, 30000);

  it('appends to the restored history after a turn', async () => {
    const route = await openRouteAAgent({ authority: credentials().authority });
    try {
      const { agent } = route;
      await agent.chat('start the chat');
      await agent.setHistory([human('restored first')]);
      await agent.addHistory(human('added second'));
      expect(humanTexts(await agent.getHistory())).toStrictEqual([
        'restored first',
        'added second',
      ]);
    } finally {
      await route.close();
    }
  }, 30000);
});
