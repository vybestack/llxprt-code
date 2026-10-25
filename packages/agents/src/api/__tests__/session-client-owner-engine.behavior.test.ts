/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Agent } from '../agent.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { createAgent } from '../createAgent.js';
import { fromConfig } from '../fromConfig.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

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

  /** A further facade over the first one's `Config`, with its own seeded settings. */
  async function openSibling(
    first: RouteAAgent,
    activation: { provider: string; model?: string },
  ): Promise<Agent> {
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(
      first.config.getInitialSettings(),
    ))
      settings.set(key, value);
    return fromConfig(first.config, settings, { activation }, first.authority);
  }

  for (const firstClosed of [0, 1]) {
    it(`keeps the shared caller and surviving facade usable when facade ${firstClosed} closes first`, async () => {
      const built = await openRouteAAgent({
        authority: credentials().authority,
      });
      let sibling: Agent | undefined;
      try {
        sibling = await openSibling(built, {
          provider: 'fake',
          model: 'fake-model',
        });
        const facades = [built.agent, sibling];
        const closing = facades[firstClosed].dispose();
        expect(new Set([closing, facades[firstClosed].dispose()]).size).toBe(1);
        await closing;
        await facades[1 - firstClosed].setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'surviving facade' }],
          },
        ]);
        expect(
          (await facades[1 - firstClosed].getHistory()).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(1);
        await facades[1 - firstClosed].dispose();
      } finally {
        await sibling?.dispose();
        await built.close();
      }
    }, 30000);
  }
  it('releases failed shared activation without losing a surviving facade or the caller MCP collaborator', async () => {
    const built = await openRouteAAgent({ authority: credentials().authority });
    const facade = built.agent;
    try {
      await expect(
        openSibling(built, { provider: 'missing-shared-provider' }),
      ).rejects.toThrow(/activation failed/i);
      await facade.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'survives failed sibling' }],
        },
      ]);
      expect(
        (await facade.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(1);
      await facade.dispose();
    } finally {
      await built.close();
    }
  }, 30000);
  it('creates and disposes an owned public agent with its separate media lifetime', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'public-media-owner-')),
    );
    const location = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
    );
    const liveMedia = async (): Promise<readonly string[]> => {
      try {
        return await readdir(join(location.projectTempDir, 'media-live'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    };
    try {
      const agent = await createAgent({
        provider: 'fake',
        model: 'fake-model',
        workingDir: directory,
        credentialAuthority: credentials().authority,
      });
      try {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'owned public session' },
              {
                type: 'media',
                encoding: 'base64',
                mimeType: 'image/png',
                data: PNG_BASE64,
              },
            ],
          },
        ]);
        expect(
          (await agent.getHistory()).filter((item) => item.speaker === 'human'),
        ).toHaveLength(1);
        expect(await liveMedia()).toHaveLength(1);
        await agent.dispose();
        await expect(agent.getHistory()).rejects.toThrow(/disposed/i);
        expect(await liveMedia()).toHaveLength(0);
      } finally {
        await agent.dispose();
      }
    } finally {
      await location.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
