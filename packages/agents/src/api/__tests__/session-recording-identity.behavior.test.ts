/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgent, internalConfig } from './helpers/agentHarness.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

async function withAgents(
  scenario: (input: {
    root: string;
    build: (id?: string) => ReturnType<typeof buildAgent>;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'session-identity-'));
  const cleanups: Array<() => Promise<void>> = [];
  let storageDir: string | undefined;
  try {
    await scenario({
      root,
      build: async (id) => {
        const built = await buildAgent('plain-text.jsonl', {
          workingDir: root,
          ...(id === undefined ? {} : { sessionId: id }),
        });
        storageDir = internalConfig(built.agent).projectTempDir;
        cleanups.push(built.cleanup);
        return built;
      },
    });
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
    if (storageDir !== undefined)
      await rm(storageDir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}

async function locks(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((file) => file.endsWith('.lock'));
}

describe('Agent recording identity transitions', () => {
  it('initializes generated facade recording identity in Config before resume', async () => {
    await withAgents(async ({ build }) => {
      const { agent } = await build();
      const config = internalConfig(agent);
      expect(config.getSessionId()).toBe(agent.getRuntimeId());
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'generated-id-seed' }],
        },
      ]);
      await agent.session.setRecording({ enabled: true });
      await agent.session.setRecording({ enabled: false });
      await agent.session.resume('latest');
      expect(config.getSessionId()).toBe(agent.getRuntimeId());
    });
  }, 30000);

  it('adopts a different recording ID and keeps facade runtime ID stable across stop/start', async () => {
    await withAgents(async ({ build }) => {
      const source = await build('identity-source');
      await source.agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'identity-seed' }] },
      ]);
      await source.agent.session.setRecording({ enabled: true });
      const sourcePath = source.agent.session.getRecording().path;
      await source.agent.session.setRecording({ enabled: false });
      await source.cleanup();

      const owner = await build('identity-owner');
      const config = internalConfig(owner.agent);
      const restored = await owner.agent.session.resume('identity-source');
      expect(JSON.stringify(restored)).toContain('identity-seed');
      expect(config.getSessionId()).toBe('identity-source');
      expect(owner.agent.getRuntimeId()).toBe('identity-owner');
      expect(owner.agent.session.getRecording().path).toBe(sourcePath);
      await owner.agent.session.setRecording({ enabled: false });
      await owner.agent.session.setRecording({ enabled: true });
      expect(owner.agent.session.getRecording().path).toBe(sourcePath);
      expect(await locks(config.projectChatsDir)).toHaveLength(1);
      await owner.agent.session.setRecording({ enabled: false });
      expect(await locks(config.projectChatsDir)).toStrictEqual([]);
    });
  }, 30000);

  it('adopts checkpoint fork identity while preserving the facade runtime ID', async () => {
    await withAgents(async ({ build }) => {
      const { agent } = await build('fork-owner');
      const config = internalConfig(agent);
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'fork-seed' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const checkpoint = await agent.session.createCheckpoint(
        'identity-checkpoint',
      );
      const child = await agent.session.forkFromCheckpoint(
        checkpoint.checkpointId,
      );
      expect(child.id).not.toBe('fork-owner');
      expect(config.getSessionId()).toBe(child.id);
      expect(agent.getRuntimeId()).toBe('fork-owner');
      expect(agent.session.getRecording().enabled).toBe(true);
      await agent.session.setRecording({ enabled: false });
      await agent.session.setRecording({ enabled: true });
      expect(
        await readFile(agent.session.getRecording().path ?? '', 'utf8'),
      ).toContain('fork-seed');
      await agent.session.setRecording({ enabled: false });
      expect(await locks(config.projectChatsDir)).toStrictEqual([]);
    });
  }, 30000);

  it('rolls back Config ID, history and prepared lock when adoption throws after mutating Config', async () => {
    await withAgents(async ({ build }) => {
      const source = await build('rollback-source');
      await source.agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'source-history' }],
        },
      ]);
      await source.agent.session.setRecording({ enabled: true });
      await source.agent.session.setRecording({ enabled: false });
      await source.cleanup();

      const { agent } = await build('rollback-owner');
      const config = internalConfig(agent);
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'prior-history' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const previousPath = agent.session.getRecording().path;
      if (!previousPath) throw new Error('Previous recording is missing');
      const adopt = config.adoptSessionId.bind(config);
      const fault = spyOn(config, 'adoptSessionId').mockImplementationOnce(
        (id) => {
          adopt(id);
          throw new Error('adoption interrupted');
        },
      );
      try {
        await expect(agent.session.resume('rollback-source')).rejects.toThrow(
          'adoption interrupted',
        );
      } finally {
        fault.mockRestore();
      }
      expect(config.getSessionId()).toBe('rollback-owner');
      await agent.session.recordRecordingEvent({
        type: 'session_event',
        severity: 'info',
        message: 'after-failed-adoption',
      });
      expect(await readFile(previousPath, 'utf8')).toContain(
        'after-failed-adoption',
      );
      expect(JSON.stringify(await agent.getHistory())).toContain(
        'prior-history',
      );
      expect(JSON.stringify(await agent.getHistory())).not.toContain(
        'source-history',
      );
      expect(await locks(config.projectChatsDir)).toHaveLength(1);
      await agent.session.setRecording({ enabled: false });
      await agent.session.setRecording({ enabled: true });
      expect(await readFile(previousPath, 'utf8')).toContain('prior-history');
      await agent.session.setRecording({ enabled: false });
      expect(await locks(config.projectChatsDir)).toStrictEqual([]);
    });
  }, 30000);

  it('releases prepared recording and lock when reading prior history fails before adoption', async () => {
    await withAgents(async ({ build }) => {
      const source = await build('history-source');
      await source.agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'history-source-turn' }],
        },
      ]);
      await source.agent.session.setRecording({ enabled: true });
      await source.agent.session.setRecording({ enabled: false });
      await source.cleanup();

      const { agent } = await build('history-owner');
      const config = internalConfig(agent);
      const client = agent.agentClient;
      const failure = new Error('prior history unavailable');
      const fault = spyOn(client, 'getHistory').mockRejectedValueOnce(failure);
      try {
        await expect(agent.session.resume('history-source')).rejects.toThrow(
          failure,
        );
      } finally {
        fault.mockRestore();
      }
      expect(config.getSessionId()).toBe('history-owner');
      expect(agent.session.getRecording().enabled).toBe(false);
      expect(await locks(config.projectChatsDir)).toStrictEqual([]);
      await agent.session.resume('history-source');
      expect(config.getSessionId()).toBe('history-source');
      await agent.session.setRecording({ enabled: false });
    });
  }, 30000);

  it('resumes two borrowed facades independently without adopting their shared Config identity', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent: a, config, borrow, chatsDir }) => {
        const b = await borrow();
        expect(config.getSessionId()).toBeUndefined();
        await a.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'a-seed' }] },
        ]);
        await a.session.setRecording({ enabled: true });
        const aPath = a.session.getRecording().path;
        await a.session.setRecording({ enabled: false });
        await b.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'b-seed' }] },
        ]);
        await b.session.setRecording({ enabled: true });
        const bPath = b.session.getRecording().path;
        await b.session.setRecording({ enabled: false });
        if (!aPath || !bPath) throw new Error('Recording path missing');
        expect(aPath).not.toBe(bPath);
        await a.session.resume(b.getRuntimeId());
        expect(config.getSessionId()).toBeUndefined();
        expect(a.getRuntimeId()).not.toBe(b.getRuntimeId());
        expect(a.session.getRecording().path).toBe(bPath);
        await a.session.setRecording({ enabled: false });
        await b.session.resume(a.getRuntimeId());
        expect(config.getSessionId()).toBeUndefined();
        expect(b.session.getRecording().path).toBe(aPath);
        await b.session.setRecording({ enabled: false });
        await a.session.setRecording({ enabled: true });
        expect(a.session.getRecording().path).toBe(bPath);
        await a.session.setRecording({ enabled: false });
        await b.session.setRecording({ enabled: true });
        expect(b.session.getRecording().path).toBe(aPath);
        expect(await readFile(bPath, 'utf8')).toContain('b-seed');
        expect(await readFile(aPath, 'utf8')).toContain('a-seed');
        expect(config.getSessionId()).toBeUndefined();
        await b.session.setRecording({ enabled: false });
        expect(await locks(chatsDir)).toStrictEqual([]);
      },
    );
  }, 30000);
});
