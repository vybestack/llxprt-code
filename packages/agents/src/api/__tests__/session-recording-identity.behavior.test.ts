import { useRecordingPrompts } from './helpers/recording-prompts.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';
import { openClientOwner } from './helpers/client-owner-session.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '@vybestack/llxprt-code-core';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

async function locks(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((file) => file.endsWith('.lock'));
}

interface RouteBBuilt {
  readonly agent: Agent;
  readonly config: Config;
  readonly cleanup: () => Promise<void>;
}

/**
 * Agents built through the foreground preflight route the CLI takes (the
 * route that gives the agent ownership of its Config's session identity),
 * over one working directory. The runtime id is the session id, as it is for
 * agents created from an `AgentConfig`.
 */
async function withRouteBAgents(
  authority: CredentialAuthority,
  scenario: (input: {
    build: (id?: string) => Promise<RouteBBuilt>;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'session-identity-'));
  const cleanups: Array<() => Promise<void>> = [];
  let storageDir: string | undefined;
  try {
    await scenario({
      build: async (id = randomUUID()) => {
        const route = await openRouteBPreflight({
          authority,
          runtimeId: id,
          config: { workingDir: root, sessionId: id },
        });
        let cleanup = async (): Promise<void> => {};
        try {
          await route.prepare();
          const agent = await route.createAgent();
          let closed = false;
          cleanup = async (): Promise<void> => {
            if (closed) return;
            closed = true;
            await runCleanupSteps([() => agent.dispose(), () => route.close()]);
          };
          storageDir = route.config.projectTempDir;
          cleanups.push(cleanup);
          return { agent, config: route.config, cleanup };
        } catch (primary) {
          await route.close();
          throw primary;
        }
      },
    });
  } finally {
    await runCleanupSteps([
      ...cleanups.reverse().map((cleanup) => () => cleanup()),
      () =>
        storageDir === undefined
          ? undefined
          : rm(storageDir, { recursive: true, force: true }),
      () => rm(root, { recursive: true, force: true }),
    ]);
  }
}

/**
 * The session control owns the Config's session identity (the ownership mode
 * `createAgent` and the foreground route both use). The client's history read
 * has no Agent form and no public input makes it fail, so the subject is the
 * SessionControl a SessionClientOwner builds over its real client, with a
 * one-shot fault wrapped around that client's `getHistory` on the instance
 * (the same form as session-restore-history-failure.behavior.test.ts).
 */
async function openControl(
  authority: CredentialAuthority,
  directory: string,
  sessionId: string,
) {
  const opened = await openClientOwner(
    authority,
    {
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      sessionId,
      interactive: true,
      harness: { includeProcessCwd: false },
    },
    { provider: 'fake', model: 'fake-model' },
  );
  const session = opened.owner.createSessionControl(
    'config',
    () => sessionId,
    (operation) => operation(),
    () => {},
    () => {},
    () => 'fake',
    () => 'fake-model',
  );
  return { opened, session };
}

describe('Agent recording identity transitions', () => {
  useRecordingPrompts();
  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();
  it('initializes generated facade recording identity in Config before resume', async () => {
    await withRouteBAgents(credentials().authority, async ({ build }) => {
      const { agent, config } = await build();
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
    await withRouteBAgents(credentials().authority, async ({ build }) => {
      const source = await build('identity-source');
      await source.agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'identity-seed' }] },
      ]);
      await source.agent.session.setRecording({ enabled: true });
      const sourcePath = source.agent.session.getRecording().path;
      await source.agent.session.setRecording({ enabled: false });
      await source.cleanup();

      const owner = await build('identity-owner');
      const { config } = owner;
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
    await withRouteBAgents(credentials().authority, async ({ build }) => {
      const { agent, config } = await build('fork-owner');
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
    await withRouteBAgents(credentials().authority, async ({ build }) => {
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

      const { agent, config } = await build('rollback-owner');
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

  it('resumes two independent facades without sharing their Config identity', async () => {
    const routes: RouteAAgent[] = [];
    try {
      const first = await openRouteAAgent({
        authority: credentials().authority,
        config: { interactive: true },
      });
      routes.push(first);
      const second = await openRouteAAgent({
        authority: credentials().authority,
        config: { interactive: true, workingDir: first.directory },
      });
      routes.push(second);
      const a = first.agent;
      const b = second.agent;
      const chatsDir = first.config.projectChatsDir;
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
      expect(a.getRuntimeId()).not.toBe(b.getRuntimeId());
      expect(a.session.getRecording().path).toBe(bPath);
      await a.session.setRecording({ enabled: false });
      await b.session.resume(a.getRuntimeId());
      expect(b.session.getRecording().path).toBe(aPath);
      await b.session.setRecording({ enabled: false });
      await a.session.setRecording({ enabled: true });
      expect(a.session.getRecording().path).toBe(bPath);
      await a.session.setRecording({ enabled: false });
      await b.session.setRecording({ enabled: true });
      expect(b.session.getRecording().path).toBe(aPath);
      expect(await readFile(bPath, 'utf8')).toContain('b-seed');
      expect(await readFile(aPath, 'utf8')).toContain('a-seed');
      await b.session.setRecording({ enabled: false });
      expect(await locks(chatsDir)).toStrictEqual([]);
    } finally {
      await runCleanupSteps(
        [...routes].reverse().map((route) => () => route.close()),
      );
    }
  }, 30000);

  it('releases prepared recording and lock when reading prior history fails before adoption', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'resume-history-read-failure-')),
    );
    const cleanups: Array<() => Promise<void>> = [];
    try {
      const source = await openControl(
        credentials().authority,
        directory,
        'history-source',
      );
      cleanups.push(() => source.opened.close());
      await source.opened.client.restoreHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'history-source-turn' }],
        },
      ]);
      await source.session.setRecording({ enabled: true });
      await source.session.setRecording({ enabled: false });
      await source.session.dispose();
      await source.opened.close();
      cleanups.pop();

      const { opened, session } = await openControl(
        credentials().authority,
        directory,
        'history-owner',
      );
      cleanups.push(
        () => session.dispose(),
        () => opened.close(),
      );
      const { config, client } = opened;
      const failure = new Error('prior history unavailable');
      const fault = spyOn(client, 'getHistory').mockRejectedValueOnce(failure);
      try {
        await expect(session.resume('history-source')).rejects.toThrow(failure);
      } finally {
        fault.mockRestore();
      }
      expect(config.getSessionId()).toBe('history-owner');
      expect(session.getRecording().enabled).toBe(false);
      expect(await locks(config.projectChatsDir)).toStrictEqual([]);
      const restored = await session.resume('history-source');
      expect(JSON.stringify(restored)).toContain('history-source-turn');
      expect(config.getSessionId()).toBe('history-source');
      await session.setRecording({ enabled: false });
      expect(await locks(config.projectChatsDir)).toStrictEqual([]);
    } finally {
      await runCleanupSteps([
        ...cleanups.reverse(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  }, 30000);
});
