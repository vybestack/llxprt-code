import { useRecordingPrompts } from './helpers/recording-owner-lifetime-fixture.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Profile } from '@vybestack/llxprt-code-settings';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { drain } from './helpers/agentHarness.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import {
  createRecordingProvider,
  type RecordingProvider,
} from './helpers/recording-provider.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';
import { makeScratchDir } from './helpers/scratch-dir.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { CompressionStrategy } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { createAgent } from '../createAgent.js';
import type { Agent } from '../agent.js';
import * as compressionFactory from '../../compression/compressionStrategyFactory.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function pathOf(state: { enabled: boolean; path?: string }): string {
  if (!state.enabled || state.path === undefined) {
    throw new Error('Expected a materialized recording');
  }
  return state.path;
}

const mediaHistory = [
  {
    speaker: 'human' as const,
    blocks: [
      {
        type: 'media' as const,
        mimeType: 'image/png',
        encoding: 'base64' as const,
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
      },
      {
        type: 'media' as const,
        mimeType: 'image/png',
        encoding: 'url' as const,
        data: 'https://example.test/image.png',
      },
    ],
  },
];

/**
 * The user config directory is a temp directory so journals never land in the
 * real one.
 */
async function withConfigHome(run: () => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'recording-facade-home-'));
  const previousHome = process.env.LLXPRT_CONFIG_HOME;
  process.env.LLXPRT_CONFIG_HOME = home;
  try {
    await run();
  } finally {
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
}

/**
 * Two independent agents built through `fromConfig` over one working
 * directory (so one chats directory), each with its own Config, client and
 * history.
 */
async function withRouteAPair(
  scenario: (agent: Agent, sibling: Agent) => Promise<void>,
): Promise<void> {
  await withConfigHome(async () => {
    const routes: RouteAAgent[] = [];
    try {
      const first = await openRouteAAgent({ config: { interactive: true } });
      routes.push(first);
      const second = await openRouteAAgent({
        config: { interactive: true, workingDir: first.directory },
      });
      routes.push(second);
      await scenario(first.agent, second.agent);
    } finally {
      await runCleanupSteps(
        [...routes].reverse().map((route) => () => route.close()),
      );
    }
  });
}

/**
 * Two independent agents built through `createAgent` over one working
 * directory, both with the contributed providers a host registers.
 */
async function withRouteCPair(
  recording: RecordingProvider,
  scenario: (agent: Agent, sibling: Agent) => Promise<void>,
): Promise<void> {
  await withConfigHome(async () => {
    const directory = await makeScratchDir('recording-facade-channel-');
    const agents: Agent[] = [];
    const open = async (): Promise<Agent> => {
      const agent = await createAgent({
        provider: 'openai',
        model: 'gpt-4o',
        interactive: true,
        workingDir: directory,
        providerContributions: recording.contributions,
        credentialAuthority: new CredentialAuthority(),
      });
      agents.push(agent);
      return agent;
    };
    try {
      const first = await open();
      const second = await open();
      await scenario(first, second);
    } finally {
      await runCleanupSteps([
        ...[...agents].reverse().map((agent) => () => agent.dispose()),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  });
}

describe('facade recording chat execution on a borrowed client', () => {
  useRecordingPrompts();
  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('routes manual compression through the executing facade across stop and resume', async () => {
    const seenPaths: Array<string | undefined> = [];
    const strategy: CompressionStrategy = {
      name: 'one-shot',
      requiresLLM: true,
      trigger: { mode: 'threshold', defaultThreshold: 0.8 },
      compress: async (context) => {
        seenPaths.push(context.transcriptPath);
        return {
          kind: 'applied',
          newHistory: [
            {
              speaker: 'ai',
              blocks: [
                {
                  type: 'text',
                  text: `summary-path:${context.transcriptPath ?? 'absent'}`,
                },
              ],
            },
          ],
          metadata: {
            originalMessageCount: context.history.length,
            compressedMessageCount: 1,
            strategyUsed: 'one-shot',
            llmCallMade: false,
          },
        };
      },
    };
    const strategySpy = spyOn(
      compressionFactory,
      'getCompressionStrategy',
    ).mockReturnValue(strategy);
    try {
      await withRouteAPair(async (agent, sibling) => {
        const seedForA = [
          {
            speaker: 'human' as const,
            blocks: [{ type: 'text' as const, text: 'seed for A' }],
          },
          {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: 'answer for A' }],
          },
          {
            speaker: 'human' as const,
            blocks: [{ type: 'text' as const, text: 'another question' }],
          },
          {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: 'another answer' }],
          },
        ];
        await agent.setHistory(seedForA);
        await sibling.setHistory(seedForA);
        await agent.session.setRecording({ enabled: true });
        const pathA = pathOf(agent.session.getRecording());
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        const pathB = pathOf(sibling.session.getRecording());
        expect(pathB).not.toBe(pathA);
        await agent.compress({ promptId: 'compress-A' });
        expect(seenPaths).toContain(pathA);
        await agent.session.setRecording({ enabled: false });
        await agent.compress({ promptId: 'compress-A-stopped' });
        expect(seenPaths[seenPaths.length - 1]).toBeUndefined();
        await sibling.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'seed for B' }],
          },
          { speaker: 'ai', blocks: [{ type: 'text', text: 'answer for B' }] },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'next for B' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'next answer for B' }],
          },
        ]);
        await sibling.compress({ promptId: 'compress-B' });
        expect(seenPaths[seenPaths.length - 1]).toBe(pathB);
        await agent.session.resume('latest');
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'resumed seed' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'resumed answer' }],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'resumed follow-up' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'resumed completion' }],
          },
        ]);
        await agent.compress({ promptId: 'compress-A-resumed' });
        expect(seenPaths[seenPaths.length - 1]).toBe(
          pathOf(agent.session.getRecording()),
        );
      });
    } finally {
      strategySpy.mockRestore();
    }
  }, 30000);

  it('records a purge only for the executing facade on the same client and history', async () => {
    await withRouteAPair(async (agent, sibling) => {
      agent.setEphemeralSetting('media.semantic-purge', 'remove');
      sibling.setEphemeralSetting('media.semantic-purge', 'remove');
      await agent.setHistory(mediaHistory);
      await sibling.setHistory(mediaHistory);
      await agent.session.setRecording({ enabled: true });
      const pathA = pathOf(agent.session.getRecording());
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const pathB = pathOf(sibling.session.getRecording());
      expect(pathA).not.toBe(pathB);
      await drain(agent.stream('purge A'));
      const a = await readFile(pathA, 'utf8');
      const b = await readFile(pathB, 'utf8');
      expect(a).toContain('"type":"semantic_media_purge"');
      expect(b).not.toContain('"type":"semantic_media_purge"');
      await sibling.setHistory(mediaHistory);
      await drain(sibling.stream('purge B'));
      expect(await readFile(pathB, 'utf8')).toContain(
        '"type":"semantic_media_purge"',
      );
      expect(
        (await readFile(pathA, 'utf8')).match(/"type":"semantic_media_purge"/g),
      ).toHaveLength(1);
    });
  }, 30000);

  it('does not persist a non-recording facade purge into the sibling recorder', async () => {
    await withRouteAPair(async (agent, sibling) => {
      agent.setEphemeralSetting('media.semantic-purge', 'remove');
      sibling.setEphemeralSetting('media.semantic-purge', 'remove');
      await agent.setHistory(mediaHistory);
      await sibling.setHistory(mediaHistory);
      await agent.session.setRecording({ enabled: true });
      const pathA = pathOf(agent.session.getRecording());
      await drain(sibling.stream('non-recording B'));
      expect(await readFile(pathA, 'utf8')).not.toContain(
        '"type":"semantic_media_purge"',
      );
      expect(sibling.session.getRecording().enabled).toBe(false);
    });
  }, 30000);

  it('uses the executing facade recorder after a profile candidate adopts live history', async () => {
    // The replay seam registers only the fake provider; this scenario selects
    // a contributed provider instead.
    delete process.env.LLXPRT_FAKE_RESPONSES;
    const replacement = createRecordingProvider({ alias: 'replacement' });
    await withRouteCPair(replacement, async (agent, sibling) => {
      agent.setEphemeralSetting('media.semantic-purge', 'remove');
      sibling.setEphemeralSetting('media.semantic-purge', 'remove');
      await agent.setHistory(mediaHistory);
      await sibling.setHistory(mediaHistory);
      await agent.session.setRecording({ enabled: true });
      const pathA = pathOf(agent.session.getRecording());
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const pathB = pathOf(sibling.session.getRecording());
      const profile: Profile = {
        version: 1,
        provider: 'replacement',
        model: 'candidate',
        modelParams: {},
        ephemeralSettings: { 'media.semantic-purge': 'remove' },
      };
      await agent.profiles.applySnapshot(profile);
      expect(agent.getProvider()).toBe('replacement');
      await drain(agent.stream('purge A after rebind'));
      expect(await readFile(pathA, 'utf8')).toContain(
        '"type":"semantic_media_purge"',
      );
      expect(await readFile(pathB, 'utf8')).not.toContain(
        '"type":"semantic_media_purge"',
      );
    });
  }, 30000);
});
