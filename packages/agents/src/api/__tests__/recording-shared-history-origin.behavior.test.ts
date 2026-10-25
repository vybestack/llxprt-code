import { useRecordingPrompts } from './helpers/recording-prompts.js';
import { describe, test, expect } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { drain } from './helpers/agentHarness.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Two independent agents built through `fromConfig` over one working
 * directory (so one chats directory), each with its own Config, client and
 * history. The user config directory is a temp directory so journals never
 * land in the real one.
 */
async function withIndependentPair(
  scenario: (agent: Agent, sibling: Agent) => Promise<void>,
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'recording-shared-origin-home-'));
  const previousHome = process.env.LLXPRT_CONFIG_HOME;
  process.env.LLXPRT_CONFIG_HOME = home;
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
    await runCleanupSteps([
      ...[...routes].reverse().map((route) => () => route.close()),
      () => {
        if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
        else process.env.LLXPRT_CONFIG_HOME = previousHome;
      },
      () => rm(home, { recursive: true, force: true }),
    ]);
  }
}

const seed = [
  {
    speaker: 'human' as const,
    blocks: [{ type: 'text' as const, text: 'seed' }],
  },
];

function recordingPath(agent: Agent): string {
  const path = agent.session.getRecording().path;
  if (!path) throw new Error('Missing journal');
  return path;
}

describe('shared history recording origin', () => {
  useRecordingPrompts();
  useFakeResponsesReplay('multi-turn-text.jsonl');
  test('two recording facades on the same history append only their own turns', async () => {
    await withIndependentPair(async (agent, sibling) => {
      await agent.setHistory(seed);
      await sibling.setHistory(seed);
      await agent.session.setRecording({ enabled: true });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const pathA = recordingPath(agent);
      const pathB = recordingPath(sibling);
      await drain(agent.stream('A-only-content-marker'));
      await drain(sibling.stream('B-only-content-marker'));
      const a = await readFile(pathA, 'utf8');
      const b = await readFile(pathB, 'utf8');
      expect(a).toContain('A-only-content-marker');
      expect(a).not.toContain('B-only-content-marker');
      expect(b).toContain('B-only-content-marker');
      expect(b).not.toContain('A-only-content-marker');
    });
  }, 30000);

  test('a facade starting after an owned turn does not seed the other owner turn', async () => {
    await withIndependentPair(async (agent, sibling) => {
      await agent.setHistory(seed);
      await sibling.setHistory(seed);
      await agent.session.setRecording({ enabled: true });
      await drain(agent.stream('A-before-B-start-marker'));
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const bPath = recordingPath(sibling);
      expect(await readFile(bPath, 'utf8')).not.toContain(
        'A-before-B-start-marker',
      );
    });
  }, 30000);

  test('profile adoption keeps owner provenance on the same live history for late recording', async () => {
    await withIndependentPair(async (agent, sibling) => {
      await agent.setHistory(seed);
      await sibling.setHistory(seed);
      await agent.session.setRecording({ enabled: true });
      await drain(agent.stream('A-before-profile-marker'));
      await agent.profiles.applySnapshot({
        version: 1,
        provider: 'fake',
        model: 'fake-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      expect(
        (await agent.getHistory()).some((content) =>
          content.blocks.some(
            (block) =>
              block.type === 'text' && block.text === 'A-before-profile-marker',
          ),
        ),
      ).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const bPath = recordingPath(sibling);
      expect(await readFile(bPath, 'utf8')).not.toContain(
        'A-before-profile-marker',
      );
    });
  }, 30000);

  test('external unbound history additions remain visible to the recording facade', async () => {
    await withIndependentPair(async (agent, sibling) => {
      await agent.setHistory(seed);
      await sibling.setHistory(seed);
      await agent.session.setRecording({ enabled: true });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      await agent.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'external-batch-marker' }],
      });
      await agent.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'external-sync-marker' }],
      });
      const aPath = recordingPath(agent);
      await agent.session.setRecording({ enabled: false });
      await sibling.session.setRecording({ enabled: false });
      const a = await readFile(aPath, 'utf8');
      expect(a).toContain('external-batch-marker');
      expect(a).toContain('external-sync-marker');
    });
  }, 30000);

  test('stopping and restarting A keeps B turns out of A and A turns out of B', async () => {
    await withIndependentPair(async (agent, sibling) => {
      await agent.setHistory(seed);
      await sibling.setHistory(seed);
      await agent.session.setRecording({ enabled: true });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const aPath = recordingPath(agent);
      const bPath = recordingPath(sibling);
      await agent.session.setRecording({ enabled: false });
      await drain(sibling.stream('B-after-A-stop'));
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await agent.session.setRecording({ enabled: true });
      const resumedPath = agent.session.getRecording().path;
      if (!resumedPath) throw new Error('Missing restarted journal');
      await drain(agent.stream('A-after-A-restart'));
      const a = await readFile(aPath, 'utf8');
      const b = await readFile(bPath, 'utf8');
      expect(a).not.toContain('B-after-A-stop');
      expect(b).toContain('B-after-A-stop');
      expect(b).not.toContain('A-after-A-restart');
      expect(await readFile(resumedPath, 'utf8')).toContain(
        'A-after-A-restart',
      );
      expect(await readFile(resumedPath, 'utf8')).not.toContain(
        'B-after-A-stop',
      );
    });
  }, 30000);

  test('resuming A while B records keeps resumed turns out of B', async () => {
    await withIndependentPair(async (agent, sibling) => {
      await agent.setHistory(seed);
      await sibling.setHistory(seed);
      await agent.session.setRecording({ enabled: true });
      await agent.session.nameCurrentSession('A-origin-resume');
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const bPath = recordingPath(sibling);
      await agent.session.setRecording({ enabled: false });
      const saved = (await agent.session.listSessions()).find(
        (session) => session.name === 'A-origin-resume',
      );
      if (!saved) throw new Error('Missing A session');
      await agent.session.resume(saved.id);
      await drain(agent.stream('A-resumed-content-marker'));
      const aPath = agent.session.getRecording().path;
      if (!aPath) throw new Error('Missing resumed journal');
      expect(await readFile(aPath, 'utf8')).toContain(
        'A-resumed-content-marker',
      );
      expect(await readFile(bPath, 'utf8')).not.toContain(
        'A-resumed-content-marker',
      );
    });
  }, 30000);

  test('disposing A leaves B able to record its next turn', async () => {
    await withIndependentPair(async (agent, sibling) => {
      await agent.setHistory(seed);
      await sibling.setHistory(seed);
      await agent.session.setRecording({ enabled: true });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const aPath = recordingPath(agent);
      const bPath = recordingPath(sibling);
      await agent.dispose();
      await drain(sibling.stream('B-after-A-dispose'));
      expect(await readFile(bPath, 'utf8')).toContain('B-after-A-dispose');
      expect(await readFile(aPath, 'utf8')).not.toContain('B-after-A-dispose');
    });
  }, 30000);
});
