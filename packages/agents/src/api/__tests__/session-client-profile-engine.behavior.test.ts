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
import { AgentProfilePreflight } from '../profile-preflight.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';
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
  it('publishes a profile client through its owner and retains the borrowed caller after profile retirement', async () => {
    const built = await openRouteAAgent({
      authority: credentials().authority,
    });
    try {
      await built.agent.chat('start profile chat');
      await built.agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'profile carries history' }],
        },
      ]);
      await built.agent.profiles.applySnapshot({
        version: 1,
        provider: 'fake',
        model: 'engine-profile-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      expect(
        (await built.agent.getHistory()).filter(
          (item) => item.speaker === 'human',
        ),
      ).toHaveLength(1);
      expect(built.agent.getProvider()).toBe('fake');
      expect(built.agent.getModel()).toBe('engine-profile-model');
    } finally {
      await built.close();
    }
  }, 30000);
  it('restores caller MCP and retains the borrowed client after facade activation fails', async () => {
    await expect(
      openRouteAAgent({
        authority: credentials().authority,
        intent: { activation: { provider: 'missing-engine-provider' } },
      }),
    ).rejects.toThrow(/activation failed/i);
    expect(credentials().snapshot()).toStrictEqual([1]);
  }, 30000);
  it('transfers the owned preflight client and media into one facade lifetime', async () => {
    const route = await openRouteBPreflight({
      authority: credentials().authority,
    });
    try {
      await route.prepare();
      const intent = { provider: 'fake', model: 'fake-model' };
      const result = await route.preflight.preflight(intent);
      if (result.token === undefined)
        throw new Error('Missing owned preflight handoff');
      const agent = await AgentProfilePreflight.createForegroundAgent(
        route.preflight,
        result.token,
        intent,
        {},
      );
      try {
        await expect(route.preflight.captureHistory()).rejects.toThrow(
          /disposed/i,
        );
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'owned preflight history' }],
          },
        ]);
      } finally {
        await agent.dispose();
      }
      await expect(agent.getHistory()).rejects.toThrow(/disposed/i);
    } finally {
      await route.close();
    }
  }, 30000);
});
