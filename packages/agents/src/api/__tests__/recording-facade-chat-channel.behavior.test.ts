import { SessionControl } from '../control/sessionControl.js';
import { useRecordingPrompts } from './helpers/recording-prompts.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  createRecordingProvider,
  type RecordingProvider,
} from './helpers/recording-provider.js';
import { createAgent } from '../createAgent.js';
import type { Agent } from '../agent.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { makeScratchDir } from './helpers/scratch-dir.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { drain } from './helpers/agentHarness.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { OneShotStrategy } from '../../compression/OneShotStrategy.js';
import { summaryOutput } from '../../compression/summaryOutput.js';
import {
  withNativeRecordingFixture,
  nativeRows,
  rowTexts,
} from './helpers/native-session-fixture.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function pathOf(state: { enabled: boolean; path?: string }): string {
  if (!state.enabled || state.path === undefined) {
    throw new Error('Expected a materialized recording');
  }
  return state.path;
}

function mediaSeed(): IContent {
  return {
    speaker: 'human',
    blocks: [
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
      },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'url',
        data: 'https://example.test/image.png',
      },
    ],
  };
}

function compressionSeed(label: string): IContent[] {
  return ['human', 'ai', 'human', 'ai'].map((speaker, index) => ({
    speaker: speaker === 'human' ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `${label}-${index}` }],
  }));
}

async function expectNativePurge(
  path: string,
  ownTurn: string,
  foreignTurn: string,
): Promise<void> {
  const rows = await nativeRows(path);
  expect(rows[0].blocks).toStrictEqual([mediaSeed().blocks[1]]);
  expect(rowTexts(rows)).toContain(ownTurn);
  expect(rowTexts(rows)).not.toContain(foreignTurn);
}

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

describe('native facade recording chat execution on a borrowed client', () => {
  useRecordingPrompts();
  it('commits compression to its executing recorder across stop and resume', async () => {
    await withNativeRecordingFixture(async ({ agent, borrow }) => {
      const sibling = await borrow();
      const seenPaths: Array<string | undefined> = [];
      const strategy = spyOn(
        OneShotStrategy.prototype,
        'prepareDisk',
      ).mockImplementation(async (context) => {
        seenPaths.push(context.transcriptPath);
        return summaryOutput(context.history, 0, context.history.length, [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: `summary-path:${context.transcriptPath ?? 'absent'}`,
              },
            ],
          },
        ]);
      });
      try {
        await agent.setHistory(compressionSeed('A'));
        await agent.session.setRecording({ enabled: true });
        const pathA = pathOf(agent.session.getRecording());
        const sessionA = agent.session.getSessionId();
        await sibling.setHistory(compressionSeed('B'));
        await sibling.session.setRecording({ enabled: true });
        const pathB = pathOf(sibling.session.getRecording());
        expect(pathB).not.toBe(pathA);
        await agent.compress({ promptId: 'native-compress-A' });
        await agent.session.flushRecording();
        expect(rowTexts(await nativeRows(pathA))).toContain(
          `summary-path:${pathA}`,
        );
        expect(rowTexts(await nativeRows(pathB))).not.toContain(
          `summary-path:${pathA}`,
        );
        await agent.session.setRecording({ enabled: false });
        const closedA = await readFile(pathA);
        await agent.setHistory(compressionSeed('stopped-A'));
        await agent.compress({ promptId: 'native-compress-stopped' });
        expect(seenPaths[seenPaths.length - 1]).toBeUndefined();
        await sibling.setHistory(compressionSeed('B'));
        await sibling.compress({ promptId: 'native-compress-B' });
        await sibling.session.flushRecording();
        expect(seenPaths[seenPaths.length - 1]).toBe(pathB);
        expect(rowTexts(await nativeRows(pathB))).toContain(
          `summary-path:${pathB}`,
        );
        expect(Buffer.compare(await readFile(pathA), closedA)).toBe(0);
        await agent.session.resume(sessionA);
        await agent.setHistory(compressionSeed('resumed-A'));
        await agent.compress({ promptId: 'native-compress-resumed' });
        expect(seenPaths[seenPaths.length - 1]).toBe(pathA);
        await agent.session.setRecording({ enabled: false });
        expect(rowTexts(await nativeRows(pathA))).toContain(
          `summary-path:${pathA}`,
        );
        expect(rowTexts(await nativeRows(pathB))).not.toContain(
          `summary-path:${pathA}`,
        );
      } finally {
        strategy.mockRestore();
      }
    });
  }, 30000);

  it('keeps media purges and turns isolated between independently owned facades', async () => {
    await withNativeRecordingFixture(async ({ agent, borrow }) => {
      agent.setEphemeralSetting('media.semantic-purge', 'remove');
      const sibling = await borrow();
      sibling.setEphemeralSetting('media.semantic-purge', 'remove');
      await agent.setHistory([mediaSeed()]);
      await sibling.setHistory([mediaSeed()]);
      await agent.session.setRecording({ enabled: true });
      await sibling.session.setRecording({ enabled: true });
      const pathA = pathOf(agent.session.getRecording());
      const pathB = pathOf(sibling.session.getRecording());
      expect(pathA).not.toBe(pathB);
      expect((await nativeRows(pathA))[0].blocks).toHaveLength(2);
      expect((await nativeRows(pathB)).map((row) => row.blocks)).toStrictEqual(
        (await nativeRows(pathA)).map((row) => row.blocks),
      );
      const eventsA = await drain(agent.stream('native-purge-A'));
      expect(eventsA.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
      await agent.session.flushRecording();
      await sibling.session.flushRecording();
      await expectNativePurge(pathA, 'native-purge-A', 'native-purge-B');
      expect(rowTexts(await nativeRows(pathB))).toStrictEqual(['']);
      expect((await nativeRows(pathB))[0].blocks).toHaveLength(2);
      await sibling.setHistory([mediaSeed()]);
      const eventsB = await drain(sibling.stream('native-purge-B'));
      expect(eventsB.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
      await agent.session.setRecording({ enabled: false });
      await sibling.session.setRecording({ enabled: false });
      await expectNativePurge(pathB, 'native-purge-B', 'native-purge-A');
      await expectNativePurge(pathA, 'native-purge-A', 'native-purge-B');
    });
  }, 30000);

  it('rejects an unrecorded facade purge without changing live media or its sibling file', async () => {
    await withNativeRecordingFixture(async ({ agent, borrow }) => {
      agent.setEphemeralSetting('media.semantic-purge', 'remove');
      const sibling = await borrow();
      await agent.setHistory([mediaSeed()]);
      await agent.session.setRecording({ enabled: true });
      const pathA = pathOf(agent.session.getRecording());
      const before = await nativeRows(pathA);
      const liveBefore = await Array.fromAsync(sibling.streamHistory());
      if (!(sibling.session instanceof SessionControl))
        throw new Error('Missing recording session');
      await expect(sibling.session.persistSemanticMediaPurge()).rejects.toThrow(
        'No active recording',
      );
      expect(sibling.session.getRecording().enabled).toBe(false);
      expect((await Array.fromAsync(sibling.streamHistory()))[0]).toStrictEqual(
        liveBefore[0],
      );
      await agent.session.setRecording({ enabled: false });
      expect(isDeepStrictEqual(await nativeRows(pathA), before)).toBe(true);
      const events = await drain(sibling.stream('native-unrecorded-B'));
      expect(events.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
      expect(rowTexts(await nativeRows(pathA))).not.toContain(
        'native-unrecorded-B',
      );
    });
  }, 30000);

  it('moves the executing recorder to its profile client without purging or appending to its borrowed sibling', async () => {
    const replacement = createRecordingProvider({ alias: 'replacement' });
    await withRouteCPair(replacement, async (agent, sibling) => {
      agent.setEphemeralSetting('media.semantic-purge', 'remove');
      sibling.setEphemeralSetting('media.semantic-purge', 'remove');
      await agent.setHistory([mediaSeed()]);
      await sibling.setHistory([mediaSeed()]);
      await agent.session.setRecording({ enabled: true });
      await sibling.session.setRecording({ enabled: true });
      const pathA = pathOf(agent.session.getRecording());
      const pathB = pathOf(sibling.session.getRecording());
      const siblingBefore = await nativeRows(pathB);
      await agent.profiles.applySnapshot({
        version: 1,
        provider: 'replacement',
        model: 'candidate',
        modelParams: {},
        ephemeralSettings: { 'media.semantic-purge': 'remove' },
      });
      expect(agent.getProvider()).toBe('replacement');
      const events = await drain(agent.stream('native-purge-after-profile-A'));
      expect(events.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
      expect(agent.session.getRecording().path).toBe(pathA);
      expect(sibling.session.getRecording().path).toBe(pathB);
      await agent.session.setRecording({ enabled: false });
      await sibling.session.setRecording({ enabled: false });
      await expectNativePurge(
        pathA,
        'native-purge-after-profile-A',
        'native-profile-sibling-B',
      );
      expect(isDeepStrictEqual(await nativeRows(pathB), siblingBefore)).toBe(
        true,
      );
      expect(
        (await Array.fromAsync(agent.streamHistory()))[0].blocks,
      ).toStrictEqual([mediaSeed().blocks[1]]);
    });
  }, 30000);
  it('publishes unowned native media replacement to both recorders while routing owned rows separately', async () => {
    await withNativeRecordingFixture(
      async ({ agent, borrow, shareHistory, clientFor }) => {
        const sibling = await borrow();
        await shareHistory(agent, sibling);
        const shared = clientFor(agent).getHistoryService();
        if (shared === null) throw new Error('Missing shared journal');
        await shared.addBatch([mediaSeed()]);
        await agent.session.setRecording({ enabled: true });
        await sibling.session.setRecording({ enabled: true });
        const pathA = pathOf(agent.session.getRecording());
        const pathB = pathOf(sibling.session.getRecording());
        expect(pathA).not.toBe(pathB);
        const history = clientFor(agent).getHistoryService();
        if (history === null) throw new Error('Missing native shared history');
        await history.detachedValues.transform(async (source, sink) => {
          for await (const row of source.streamRows())
            await sink.appendValue({
              ...row,
              blocks: row.blocks.filter(
                (block) =>
                  !(block.type === 'media' && block.encoding !== 'url'),
              ),
            });
        });
        await history.addBatch(
          [{ speaker: 'human', blocks: [{ type: 'text', text: 'owned A' }] }],
          undefined,
          { origin: agent.session },
        );
        await history.addBatch(
          [{ speaker: 'human', blocks: [{ type: 'text', text: 'owned B' }] }],
          undefined,
          { origin: sibling.session },
        );
        await agent.session.flushRecording();
        await sibling.session.flushRecording();
        await expectNativePurge(pathA, 'owned A', 'owned B');
        await expectNativePurge(pathB, 'owned B', 'owned A');
      },
    );
  }, 30000);
});
