import { useRecordingPrompts } from './helpers/recording-prompts.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionControl } from '../control/sessionControl.js';
import { AgentEventType } from '../../core/turn.js';
import { createAgent } from '../createAgent.js';
import { drain } from './helpers/agentHarness.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openClientOwner } from './helpers/client-owner-session.js';
import { enableOAuthProviders } from './helpers/oauth-contribution.js';
import {
  MemoryTokenStore,
  makeExpiredToken,
} from './helpers/provider-auth-fixtures.js';
import { createRefreshableOAuthContribution } from './helpers/refreshable-oauth-provider.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import * as fs from 'node:fs/promises';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

async function filesIn(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).sort();
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function recordingPath(path: string | undefined): string {
  if (path === undefined) throw new Error('Recording did not materialize');
  return path;
}

/**
 * Independent agents built through `fromConfig` over one working directory
 * (so one chats directory), each with its own Config, client and history.
 */
async function withRouteAAgents(
  authority: CredentialAuthority,
  count: number,
  scenario: (agents: readonly Agent[], chatsDir: string) => Promise<void>,
): Promise<void> {
  const routes: RouteAAgent[] = [];
  try {
    const first = await openRouteAAgent({
      authority,
      config: { interactive: true },
    });
    routes.push(first);
    for (let index = 1; index < count; index++) {
      routes.push(
        await openRouteAAgent({
          authority,
          config: { interactive: true, workingDir: first.directory },
        }),
      );
    }
    await scenario(
      routes.map((route) => route.agent),
      first.config.projectChatsDir,
    );
  } finally {
    await runCleanupSteps(
      [...routes].reverse().map((route) => () => route.close()),
    );
  }
}

async function withAgent(
  authority: CredentialAuthority,
  scenario: (agent: Agent, chatsDir: string) => Promise<void>,
): Promise<void> {
  await withRouteAAgents(authority, 1, (agents, chatsDir) =>
    scenario(agents[0], chatsDir),
  );
}

async function withPair(
  authority: CredentialAuthority,
  scenario: (agent: Agent, other: Agent) => Promise<void>,
): Promise<void> {
  await withRouteAAgents(authority, 2, (agents) =>
    scenario(agents[0], agents[1]),
  );
}

async function streamClientTurn(
  client: AgentClientContract,
  message: string,
): Promise<void> {
  const stream = client.sendMessageStream(
    message,
    new AbortController().signal,
    'recording-lifetime-' + randomUUID(),
  );
  for await (const event of stream) {
    if (event.type === AgentEventType.Error)
      throw new Error(event.value.error.message);
  }
}

describe('recording owner lifetime', () => {
  useRecordingPrompts();
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();
  for (const failureKind of ['queue', 'append']) {
    it(`releases startup ownership after ${failureKind} failure before subscription`, async () => {
      await withAgent(credentials().authority, async (agent, chatsDir) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'startup-seed'.repeat(1000) }],
          },
        ]);
        const failure = new Error('External append failed');
        const fault =
          failureKind === 'append'
            ? spyOn(fs, 'appendFile').mockImplementationOnce(async () => {
                throw failure;
              })
            : undefined;
        if (failureKind === 'queue') {
          agent.setEphemeralSetting('session-recording-queue-max-bytes', 4096);
        }
        try {
          await expect(
            agent.session.setRecording({ enabled: true }),
          ).rejects.toThrow(
            failureKind === 'append' ? failure : 'queue byte limit exceeded',
          );
        } finally {
          fault?.mockRestore();
          agent.setEphemeralSetting(
            'session-recording-queue-max-bytes',
            undefined,
          );
        }
        expect(agent.session.getRecording().enabled).toBe(false);
        expect(
          (await filesIn(chatsDir)).filter((file) => file.endsWith('.lock')),
        ).toStrictEqual([]);
        await agent.session.setRecording({ enabled: true });
        await drain(agent.stream(`public-turn-after-${failureKind}-failure`));
        const path = recordingPath(agent.session.getRecording().path);
        await agent.session.setRecording({ enabled: false });
        expect(await readFile(path, 'utf8')).toContain(
          `public-turn-after-${failureKind}-failure`,
        );
      });
    }, 30000);
  }

  it('closes admission synchronously and joins an admitted external append before disposing', async () => {
    await withAgent(credentials().authority, async (agent, chatsDir) => {
      const session = agent.session;
      if (!(session instanceof SessionControl))
        throw new Error('Expected real SessionControl');
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'admitted-append-seed' }],
        },
      ]);
      let entered = (): void => {};
      const writing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release = (): void => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const append = fs.appendFile;
      const boundary = spyOn(fs, 'appendFile').mockImplementationOnce(
        async (...args) => {
          entered();
          await gate;
          return append(...args);
        },
      );
      const admitted = session.setRecording({ enabled: true });
      let terminal: Promise<void> | undefined;
      try {
        await writing;
        terminal = session.dispose();
        expect(session.dispose()).toBe(terminal);
        let settled = false;
        void terminal.then(() => {
          settled = true;
        });
        await expect(session.setRecording({ enabled: true })).rejects.toThrow(
          'disposed',
        );
        await expect(session.resume('latest')).rejects.toThrow('disposed');
        await expect(session.createCheckpoint('late')).rejects.toThrow(
          'disposed',
        );
        expect(settled).toBe(false);
        expect(
          (await filesIn(chatsDir)).some((file) => file.endsWith('.lock')),
        ).toBe(true);
      } finally {
        release();
        await admitted;
        await terminal;
        boundary.mockRestore();
      }
      expect(session.getRecording().enabled).toBe(false);
      expect(
        (await filesIn(chatsDir)).filter((file) => file.endsWith('.lock')),
      ).toStrictEqual([]);
      const journals = (await filesIn(chatsDir)).filter((file) =>
        file.endsWith('.jsonl'),
      );
      expect(journals).toHaveLength(1);
      expect(await readFile(`${chatsDir}/${journals[0]}`, 'utf8')).toContain(
        'admitted-append-seed',
      );
    });
  }, 30000);

  it('control: records and flushes a subsequent public turn on a borrowed Config', async () => {
    await withAgent(credentials().authority, async (agent) => {
      await agent.session.setRecording({ enabled: true });
      await drain(agent.stream('recording-lifetime-control-turn'));
      const path = recordingPath(agent.session.getRecording().path);
      await agent.session.setRecording({ enabled: false });
      const transcript = await readFile(path, 'utf8');
      expect(transcript).toContain('recording-lifetime-control-turn');
      expect(transcript).toContain('turn one reply');
    });
  }, 30000);

  it('disposing a non-recording borrowed facade preserves the other recorder and its subsequent turn', async () => {
    await withPair(credentials().authority, async (agent, other) => {
      await agent.session.setRecording({ enabled: true });
      await drain(agent.stream('recording-owner-before-sibling-disposal'));
      const path = recordingPath(agent.session.getRecording().path);
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path,
      });
      expect(other.session.getRecording().enabled).toBe(false);

      await other.dispose();
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path,
      });
      await drain(agent.stream('recording-owner-after-sibling-disposal'));
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path,
      });
      await agent.session.setRecording({ enabled: false });
      const transcript = await readFile(path, 'utf8');

      expect(transcript).toContain('recording-owner-before-sibling-disposal');
      expect(transcript).toContain('recording-owner-after-sibling-disposal');
      expect(transcript).toContain('turn two reply');
    });
  }, 30000);

  it('stopping and disposing a recording sibling leaves the first owner recording later turns', async () => {
    await withPair(credentials().authority, async (agent, other) => {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'first-owner-seed' }],
        },
      ]);
      await agent.session.setRecording({ enabled: true });
      await other.session.setRecording({ enabled: true });
      await drain(other.stream('recording-sibling-own-turn'));
      const siblingPath = recordingPath(other.session.getRecording().path);
      const firstPath = recordingPath(agent.session.getRecording().path);
      expect(siblingPath).not.toBe(firstPath);
      await other.session.setRecording({ enabled: false });
      expect(other.session.getRecording().enabled).toBe(false);
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path: firstPath,
      });
      expect(await readFile(siblingPath, 'utf8')).toContain(
        'recording-sibling-own-turn',
      );

      await other.dispose();
      await drain(agent.stream('recording-first-after-sibling-stop'));
      expect(agent.session.getRecording()).toMatchObject({
        enabled: true,
        path: firstPath,
      });
      await agent.session.setRecording({ enabled: false });
      expect(await readFile(firstPath, 'utf8')).toContain(
        'recording-first-after-sibling-stop',
      );
    });
  }, 30000);

  it.each([1, 3])(
    'releases the lock after rejected subscription %i and lets the replacement recorder record another turn',
    async (failureAt) => {
      // The history event source has no Agent form, so the subject is the
      // session control a SessionClientOwner builds over its real client.
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'recording-lifetime-control-')),
      );
      const chatsDir = new Storage(directory).getProjectChatsDir();
      const opened = await openClientOwner(
        credentials().authority,
        {
          provider: 'fake',
          model: 'fake-model',
          workingDir: directory,
          interactive: true,
          harness: { includeProcessCwd: false },
        },
        { provider: 'fake', model: 'fake-model' },
      );
      const session = opened.owner.createSessionControl(
        'facade',
        () => 'recording-lifetime-runtime',
        (operation) => operation(),
        () => {},
        () => {},
        () => 'fake',
        () => 'fake-model',
      );
      try {
        await opened.client.restoreHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'subscription-failure-seed' }],
          },
        ]);
        const history = opened.client.getHistoryService();
        if (history === null)
          throw new Error('Client has no history event source');
        const failure = new Error(
          'External history event source rejects subscription',
        );
        const events = [
          'contentAdded',
          'compressionStarted',
          'compressionLockReleased',
          'compressionEnded',
        ];
        const priorListeners = events.map((event) =>
          history.listenerCount(event),
        );
        let acquiredFiles: string[] = [];
        const subscribe = history.on.bind(history);
        let registrations = 0;
        const subscription = spyOn(history, 'on').mockImplementation(
          (event, listener) => {
            registrations += 1;
            if (registrations === failureAt) {
              acquiredFiles = readdirSync(chatsDir);
              throw failure;
            }
            return subscribe(event, listener);
          },
        );
        try {
          await expect(session.setRecording({ enabled: true })).rejects.toThrow(
            failure,
          );
        } finally {
          subscription.mockRestore();
        }
        expect(
          events.map((event) => history.listenerCount(event)),
        ).toStrictEqual(priorListeners);
        expect(acquiredFiles.some((file) => file.endsWith('.lock'))).toBe(true);
        expect(acquiredFiles.some((file) => file.endsWith('.jsonl'))).toBe(
          true,
        );
        expect(session.getRecording().enabled).toBe(false);

        await session.setRecording({ enabled: true });
        const path = recordingPath(session.getRecording().path);
        expect(
          (await filesIn(chatsDir)).some((file) => file.endsWith('.lock')),
        ).toBe(true);
        await streamClientTurn(
          opened.client,
          'replacement-recorder-after-failed-subscription',
        );
        expect(session.getRecording()).toMatchObject({
          enabled: true,
          path,
        });
        await session.setRecording({ enabled: false });
        const transcript = await readFile(path, 'utf8');
        expect(transcript).toContain(
          'replacement-recorder-after-failed-subscription',
        );
        expect(transcript).toContain('turn one reply');
        expect(
          (await filesIn(chatsDir)).some((file) => file.endsWith('.lock')),
        ).toBe(false);
      } finally {
        await runCleanupSteps([
          () => session.dispose(),
          () => opened.close(),
          () => rm(directory, { recursive: true, force: true }),
        ]);
      }
    },
    30000,
  );

  it('rejects recording admission while public disposal joins a pending provider body before session shutdown', async () => {
    let entered = (_signal: AbortSignal): void => {};
    const reading = new Promise<AbortSignal>((resolve) => {
      entered = resolve;
    });
    let release = (): void => {};
    const body = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The replay seam registers only the `fake` provider; this agent selects a
    // contributed OAuth provider whose token refresh is the held body.
    delete process.env.LLXPRT_FAKE_RESPONSES;
    const alias = 'recording-refresh-oauth';
    const contribution = createRefreshableOAuthContribution([
      {
        alias,
        refresh: async (current, signal) => {
          if (signal === undefined)
            throw new Error('Token refresh carried no abort signal');
          entered(signal);
          await body;
          return {
            ...current,
            access_token: 'recording-rotated',
            refresh_token: 'recording-rotated-refresh',
            expiry: Math.floor(Date.now() / 1000) + 120,
          };
        },
      },
    ]);
    const configHome = process.env.LLXPRT_CONFIG_HOME;
    if (configHome === undefined)
      throw new Error('Owned credentials set no config home');
    await enableOAuthProviders(configHome, [alias]);
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'recording-lifetime-refresh-')),
    );
    const chatsDir = new Storage(directory).getProjectChatsDir();
    const store = new MemoryTokenStore();
    const agent = await createAgent({
      provider: alias,
      model: 'initial-model',
      sessionId: randomUUID(),
      workingDir: directory,
      telemetry: { enabled: false },
      recording: { enabled: false },
      interactive: true,
      tokenStore: store,
      credentialAuthority: credentials().authority,
      providerContributions: contribution.contributions,
      harness: { includeProcessCwd: false },
    });
    await store.saveToken(
      alias,
      makeExpiredToken('recording-refresh'),
      'primary',
    );
    await store.saveToken(
      alias,
      makeExpiredToken('recording-refresh-secondary'),
      'secondary',
    );
    let disposal: Promise<void> | undefined;
    let applying: Promise<unknown> = Promise.resolve();
    try {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'inflight-disposal-recording-seed' }],
        },
      ]);
      applying = agent.profiles
        .applySnapshot({
          version: 1,
          provider: alias,
          model: 'recording-refresh-model',
          modelParams: {},
          ephemeralSettings: {},
          auth: { type: 'oauth', buckets: ['primary', 'secondary'] },
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      const signal = await Promise.race([
        reading,
        applying.then((error) => {
          throw new Error('Profile settled before the provider body barrier', {
            cause: error,
          });
        }),
      ]);
      const before = await filesIn(chatsDir);
      expect(before).toStrictEqual([]);
      expect(agent.session.getRecording().enabled).toBe(false);
      let disposalSettled = false;
      disposal = agent.dispose();
      const admission = agent.session.setRecording({ enabled: true }).then(
        (): string => 'accepted',
        (error: unknown): string =>
          error instanceof Error ? error.message : String(error),
      );
      void disposal.then(() => {
        disposalSettled = true;
      });
      expect(signal.aborted).toBe(true);
      const outcome = await admission;
      const createdFiles = (await filesIn(chatsDir)).filter(
        (file) => !before.includes(file),
      );
      expect({
        disposalSettled,
        outcome,
        createdFiles,
        recordingEnabled: agent.session.getRecording().enabled,
        recordingPath: agent.session.getRecording().path,
      }).toStrictEqual({
        disposalSettled: false,
        outcome: expect.stringMatching(/disposed|closed/i),
        createdFiles: [],
        recordingEnabled: false,
        recordingPath: undefined,
      });
    } finally {
      release();
      await runCleanupSteps([
        () => applying,
        () => disposal,
        () => agent.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  }, 30000);

  it('rejects recording admission after public disposal without creating a journal or lock', async () => {
    await withAgent(credentials().authority, async (agent, chatsDir) => {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'post-disposal-recording-seed' }],
        },
      ]);
      await agent.dispose();
      const before = await filesIn(chatsDir);
      const outcome = await agent.session.setRecording({ enabled: true }).then(
        (): string => 'accepted',
        (error: unknown): string =>
          error instanceof Error ? 'rejected' : 'non-error rejection',
      );
      const after = await filesIn(chatsDir);
      expect({
        outcome,
        createdFiles: after.filter((file) => !before.includes(file)),
      }).toStrictEqual({
        outcome: 'rejected',
        createdFiles: [],
      });
    });
  }, 30000);
});
