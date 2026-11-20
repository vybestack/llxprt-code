import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { openClientOwner } from './helpers/client-owner-session.js';
import { captureSessionOwner } from './helpers/capture-session-owner.js';
import { collectAgentHistory } from './helpers/collect-agent-history.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
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
import type { RouteAAgent } from './helpers/route-a-agent.js';

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

  async function openEngine(options: { authority: CredentialAuthority }) {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'engine-caller-')),
    );
    const caller = await openClientOwner(
      options.authority,
      {
        provider: 'fake',
        model: 'fake-model',
        sessionId: 'shared-engine-label',
        workingDir: directory,
        harness: { includeProcessCwd: false },
      },
      { provider: 'fake', model: 'fake-model' },
    );
    await caller.client.addHistory({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'caller before adoption' }],
    });
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(
      caller.config.getInitialSettings(),
    ))
      settings.set(key, value);
    const { value: agent, owner } = await captureSessionOwner(() =>
      fromConfig(
        caller.config,
        settings,
        { activation: { provider: 'fake', model: 'fake-model' } },
        options.authority,
      ),
    );
    return {
      agent,
      owner,
      config: caller.config,
      settings,
      authority: options.authority,
      directory,
      caller,
      close: () =>
        runCleanupSteps([
          () => agent.dispose(),
          () => caller.close(),
          () => rm(directory, { recursive: true, force: true }),
        ]),
    };
  }

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
      const built = await openEngine({
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
          (await collectAgentHistory(facades[1 - firstClosed])).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(1);
        await facades[1 - firstClosed].dispose();
        await built.caller.mcp.refreshContext();
        await built.caller.client.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'caller after both facades' }],
        });
        expect(
          (await Array.fromAsync(built.caller.client.getHistory())).filter(
            (row) => row.speaker === 'human',
          ),
        ).toHaveLength(2);
        expect(
          await built.caller.client.mediaStore?.getStoredByteLength(),
        ).toBe(0);
      } finally {
        await sibling?.dispose();
        await built.close();
      }
    }, 30000);
  }
  it('releases failed shared activation without losing a surviving facade or the caller MCP collaborator', async () => {
    const built = await openEngine({ authority: credentials().authority });
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
        (await collectAgentHistory(facade)).filter(
          (item) => item.speaker === 'human',
        ),
      ).toHaveLength(1);
      await facade.dispose();
      await built.caller.mcp.refreshContext();
      await built.caller.client.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'caller survives failed sibling' }],
      });
      expect(
        (await Array.fromAsync(built.caller.client.getHistory())).filter(
          (row) => row.speaker === 'human',
        ),
      ).toHaveLength(2);
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
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return [];
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
          (await collectAgentHistory(agent)).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(1);
        expect(await liveMedia()).toHaveLength(1);
        await agent.dispose();
        await expect(collectAgentHistory(agent)).rejects.toThrow(/disposed/i);
        expect(await liveMedia()).toHaveLength(0);
      } finally {
        await agent.dispose();
      }
    } finally {
      await location.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
  type Engine = Awaited<ReturnType<typeof openEngine>>;
  const replacements = [
    {
      name: 'model',
      replace: async (
        built: Engine,
        prior: AgentClientContract,
      ): Promise<void> => {
        await built.agent.setModel('replacement-model');
        expect(built.owner.clients.getAgentClient()).not.toBe(prior);
      },
    },
    {
      name: 'profile',
      replace: async (
        built: Engine,
        _prior: AgentClientContract,
      ): Promise<void> => {
        await built.agent.profiles.applySnapshot({
          version: 1,
          provider: 'fake',
          model: 'replacement-profile-model',
          modelParams: {},
          ephemeralSettings: {},
        });
        expect(built.agent.getModel()).toBe('replacement-profile-model');
      },
    },
  ];
  for (const replacement of replacements) {
    it(`keeps the original caller alive after facade ${replacement.name} replacement and retirement`, async () => {
      const built = await openEngine({ authority: credentials().authority });
      const prior = built.owner.clients.getAgentClient();

      try {
        await built.agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'retained across replacement' }],
          },
        ]);
        await replacement.replace(built, prior);
        expect(
          (await collectAgentHistory(built.agent)).filter(
            (row) => row.speaker === 'human',
          ),
        ).toHaveLength(1);
        await built.agent.dispose();
        await built.caller.mcp.refreshContext();
        await built.caller.client.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'caller after replacement' }],
        });
        expect(
          (await Array.fromAsync(built.caller.client.getHistory())).filter(
            (row) => row.speaker === 'human',
          ),
        ).toHaveLength(2);
        expect(
          await built.caller.client.mediaStore?.getStoredByteLength(),
        ).toBe(0);
      } finally {
        await built.close();
      }
    }, 30000);
  }
  it('isolates same-label caller clients and keeps the sibling usable after another facade closes', async () => {
    const left = await openEngine({ authority: credentials().authority });
    const right = await openEngine({ authority: credentials().authority });
    try {
      await left.agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'left only' }] },
      ]);
      await right.agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'right only' }] },
      ]);
      await left.agent.dispose();
      await right.caller.mcp.refreshContext();
      await right.owner.clients.getAgentClient().addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'right continues' }],
      });
      const rows = await collectAgentHistory(right.agent);
      expect(rows.filter((row) => row.speaker === 'human')).toHaveLength(2);
      expect(
        rows
          .flatMap((row) => row.blocks)
          .flatMap((block) => (block.type === 'text' ? [block.text] : [])),
      ).not.toContain('left only');
      expect(left.config.getSessionId()).toBe(right.config.getSessionId());
      expect(right.caller.client).not.toBe(left.caller.client);
    } finally {
      await runCleanupSteps([() => right.close(), () => left.close()]);
    }
  }, 30000);
});
