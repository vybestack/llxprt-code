import {
  terminal,
  awaitGroupAbsence,
  groupOf,
  assertUncertainDisposal,
} from './helpers/shell-owner-isolation-fixture.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { fromConfig } from '../fromConfig.js';
import { mkdtemp, realpath, rm, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

import { randomUUID } from 'node:crypto';

import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { existsSync } from 'node:fs';

import { setImmediate } from 'node:timers/promises';
import { type Agent } from '@vybestack/llxprt-code-agents';

import {
  ApprovalMode,
  Config,
} from '@vybestack/llxprt-code-core/config/config.js';
import { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { makeScratchDir } from './helpers/scratch-dir.js';
import {
  deadline,
  deferred,
  shellOwnerGate,
  shellQuote,
} from './helpers/shell-owner-gate.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('Public Agent managed shell ownership (#2616)', () => {
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
  useFakeResponsesReplay('plain-text.jsonl');
  const builtCredentials = useOwnedCredentials();
  async function exercise(
    disposeFirst: boolean,
    denyOwnershipProbe = false,
    holdShellNotice = false,
    sameOwnerSafeJob = false,
  ): Promise<boolean> {
    const root = await makeScratchDir('shell-agent-owner-');
    const environment = new Map(
      [
        'LLXPRT_CONFIG_HOME',
        'LLXPRT_DATA_HOME',
        'LLXPRT_CACHE_HOME',
        'LLXPRT_LOG_HOME',
        'TMPDIR',
      ].map((key) => [key, process.env[key]]),
    );
    for (const key of environment.keys()) {
      process.env[key] = root;
    }
    const logParent = tmpdir();
    const gate = await shellOwnerGate();
    const noticeEntered = deferred<void>();
    const noticeReleased = deferred<void>();
    let heldNoticeId = '';
    const agents: Agent[] = [];
    let disposalFailure: unknown;
    let retainedDir: string | undefined;
    let retainedPgid: number | undefined;
    const controller = new AbortController();

    let sharedConfig: Config | undefined;
    try {
      const config = new Config(
        toConfigParameters({
          provider: 'fake',
          model: 'fake-model',
          sessionId: randomUUID(),
          workingDir: await realpath(root),
          folderTrust: true,
          telemetry: { enabled: false },
          recording: { enabled: false },
          skillsSupport: false,
          approvalMode: ApprovalMode.YOLO,
          interactive: true,
          includeDirectories: [process.cwd()],
        }),
      );
      sharedConfig = config;
      async function facade(): Promise<Agent> {
        const settings = new SettingsService();
        for (const [key, value] of Object.entries(config.getInitialSettings()))
          settings.set(key, value);
        const agent = await fromConfig(
          config,
          settings,
          {
            sessionId: 'shell-owner-same-label',
            activation: { provider: 'fake', model: 'fake-model' },
          },
          builtCredentials().authority,
        );

        agents.push(agent);
        return agent;
      }
      const a = await facade();
      const b = await facade();
      const aNotices: string[] = [];
      const bNotices: string[] = [];
      const unsubscribeA = a.tasks.subscribeNotifications(
        () => false,
        async (message) => {
          aNotices.push(message);
        },
      );
      const unsubscribeB = b.tasks.subscribeNotifications(
        () => false,
        async (message) => {
          bNotices.push(message);
          if (
            holdShellNotice &&
            heldNoticeId &&
            message.includes(heldNoticeId)
          ) {
            noticeEntered.resolve();
            await noticeReleased.promise;
          }
        },
      );
      async function launch(agent: Agent, name: string): Promise<string> {
        const complete = deferred<CompletedToolCall[]>();
        const channel = agent.tools.openClientChannel((calls) =>
          complete.resolve(calls),
        );
        const command = [
          'exec',
          shellQuote(process.execPath),
          shellQuote(
            resolve(
              resolveRepositoryFixture(
                import.meta.url,
                'packages/agents/src/api/__tests__/helpers/shell-owner-workload.ts',
              ),
            ),
          ),
          shellQuote(`${gate.url}/${name}`),
          shellQuote(join(root, `${name}.marker`)),
        ].join(' ');
        try {
          await deadline(channel.ready, `${name} channel ready`);
          await deadline(
            channel.schedule(
              {
                callId: `shell-owner-${name}`,
                name: 'run_shell_command',
                args: { command, is_background: true },
                isClientInitiated: true,
                prompt_id: `shell-owner-${name}`,
              },
              controller.signal,
            ),
            `${name} schedule`,
          );
          expect(
            (await deadline(complete.promise, `${name} completion`)).map(
              (call) => call.status,
            ),
          ).toStrictEqual(['success']);
          await gate.entered(name);
          const job = agent.tasks
            .list()
            .find(
              (candidate) =>
                candidate.kind === 'shell' && candidate.command === command,
            );
          if (!job) throw new Error(`Public launch ${name} absent from Agent`);
          expect(agent.tasks.get(job.id)?.kind).toBe('shell');
          return job.id;
        } finally {
          await channel.release();
        }
      }
      const aId = await launch(a, 'A');
      const safeId = sameOwnerSafeJob ? await launch(a, 'A-safe') : undefined;
      const safe = safeId
        ? { id: safeId, pgid: await groupOf(join(root, 'A-safe.marker.pid')) }
        : undefined;
      const bId = await launch(b, 'B');
      expect(aId).not.toBe(bId);
      expect(a.tasks.get(bId)).toBeUndefined();
      expect(b.tasks.get(aId)).toBeUndefined();
      expect(a.tasks.list().some((task) => task.id === bId)).toBe(false);
      expect(b.tasks.list().some((task) => task.id === aId)).toBe(false);
      expect(await b.tasks.cancel(aId)).toBe(false);
      for (const [owner, ownId, foreignId] of [
        [a, aId, bId],
        [b, bId, aId],
      ] as const) {
        const query = owner.tools.get('check_async_tasks');
        if (!query) throw new Error('Missing task query tool');
        const listing = await query.buildAndExecute({}, controller.signal);
        expect(JSON.stringify(listing.llmContent)).toContain(ownId);
        expect(JSON.stringify(listing.llmContent)).not.toContain(foreignId);
        const foreign = await query.buildAndExecute(
          { action: 'peek', task_id: foreignId },
          controller.signal,
        );
        expect(JSON.stringify(foreign.llmContent)).not.toContain('exec ');
        const prefix = await query.buildAndExecute(
          { action: 'peek', task_id: foreignId.slice(0, 12) },
          controller.signal,
        );
        expect(JSON.stringify(prefix.llmContent)).not.toContain(foreignId);
        const ownPrefix = await query.buildAndExecute(
          { action: 'peek', task_id: ownId.slice(0, 12) },
          controller.signal,
        );
        expect(JSON.stringify(ownPrefix.llmContent)).toContain(ownId);
        await query.buildAndExecute(
          { action: 'cancel', task_id: foreignId },
          controller.signal,
        );
      }
      expect(gate.connected('A') && gate.connected('B')).toBe(true);
      if (disposeFirst) {
        const staleShell = a.tools.get('run_shell_command');
        if (!staleShell) throw new Error('Missing shell tool');
        if (denyOwnershipProbe) {
          const uncertain = await assertUncertainDisposal(
            a,
            root,
            logParent,
            aId,
            safe,
          );
          disposalFailure = uncertain.failure;
          retainedDir = uncertain.retainedDir;
          retainedPgid = uncertain.pgid;
        } else {
          await deadline(a.dispose(), 'A disposal');
          expect(a.tasks.get(aId)).toBeUndefined();
        }
        await expect(
          staleShell.buildAndExecute(
            { command: 'echo late', is_background: true },
            controller.signal,
          ),
        ).rejects.toThrow('Tool dispatch admission is closed');
      }
      expect(gate.connected('B')).toBe(true);
      gate.release('B');
      await terminal(b, bId);
      if (!disposeFirst) {
        gate.release('A');
        await terminal(a, aId);
      }
      expect(await readFile(join(root, 'B.marker'), 'utf8')).toBe('released\n');
      const next = await launch(b, 'B-next');
      heldNoticeId = next;
      gate.release('B-next');
      await terminal(b, next);
      if (holdShellNotice) {
        await deadline(
          noticeEntered.promise,
          'shell completion notice entered',
        );
        unsubscribeB();
        let settled = false;
        const disposal = b.dispose().then(() => {
          settled = true;
        });
        await setImmediate();
        expect(settled).toBe(false);
        noticeReleased.resolve();
        await deadline(disposal, 'notice drain on Agent disposal');
      }
      expect(await readFile(join(root, 'B-next.marker'), 'utf8')).toBe(
        'released\n',
      );
      const aWrote = existsSync(join(root, 'A.marker'));
      await deadline(
        new Promise<void>((resolve) => {
          const check = (): void => {
            if (bNotices.some((message) => message.includes(bId))) resolve();
            else setTimeout(check, 10);
          };
          check();
        }),
        'B completion notification',
      );
      expect(bNotices.join('\n')).not.toContain(aId);
      expect(aNotices.join('\n')).not.toContain(bId);
      unsubscribeA();
      unsubscribeB();
      return aWrote;
    } finally {
      noticeReleased.resolve();
      controller.abort();
      const agentCleanup = await Promise.allSettled(
        agents.map((agent) => agent.dispose()),
      );
      const callerCleanup = await Promise.allSettled([sharedConfig?.dispose()]);
      const cleanup = [...agentCleanup, ...callerCleanup];
      await gate.stop();
      if (retainedDir && retainedPgid !== undefined) {
        await awaitGroupAbsence(retainedPgid);
        await rm(retainedDir, { recursive: true, force: true });
      }
      for (const [key, value] of environment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
      const failures = cleanup.filter((result) => result.status === 'rejected');
      if (denyOwnershipProbe && disposalFailure !== undefined) {
        expect(failures).toHaveLength(1);
        expect(failures[0]?.reason).toBe(disposalFailure);
      } else {
        expect(failures).toStrictEqual([]);
      }
    }
  }
  async function terminalDescendantDrain(): Promise<void> {
    const root = await makeScratchDir('shell-agent-descendant-');
    const gate = await shellOwnerGate();

    const route = await openRouteAAgent({
      authority: builtCredentials().authority,
      config: {
        workingDir: root,
        folderTrust: true,
        telemetry: { enabled: false },
        recording: { enabled: false },
        skillsSupport: false,
        approvalMode: ApprovalMode.YOLO,
        interactive: true,
        includeDirectories: [process.cwd()],
      },
    });
    const agent = route.agent;
    try {
      const shell = agent.tools.get('run_shell_command');
      if (!shell) throw new Error('Missing public Agent shell tool');
      const marker = join(root, 'descendant.marker');
      const command = [
        'exec',
        shellQuote(process.execPath),
        shellQuote(
          resolve(
            resolveRepositoryFixture(
              import.meta.url,
              'packages/agents/src/api/__tests__/helpers/shell-owner-descendant.ts',
            ),
          ),
        ),
        'leader',
        shellQuote(gate.url),
        shellQuote(marker),
      ].join(' ');
      await deadline(
        shell.buildAndExecute(
          { command, is_background: true },
          new AbortController().signal,
        ),
        'descendant background launch',
      );
      await gate.entered('descendant');
      const job = agent.tasks
        .list()
        .find(
          (candidate) =>
            candidate.kind === 'shell' && candidate.command === command,
        );
      if (!job) throw new Error('Descendant job absent from public Agent');
      const pgid = await groupOf(`${marker}.pid`);
      expect(gate.connected('descendant')).toBe(true);
      gate.release('leader');
      await terminal(agent, job.id);
      expect(agent.tasks.get(job.id)?.status).not.toBe('running');
      expect(process.kill(-pgid, 0)).toBe(true);
      const disposal = agent.dispose();
      await deadline(disposal, 'terminal descendant group disposal');
      await awaitGroupAbsence(pgid);
      expect(existsSync(marker)).toBe(false);
      expect(agent.tasks.get(job.id)).toBeUndefined();
      const logs = (await readdir(tmpdir()))
        .filter((entry) => entry.startsWith('shell-jobs-'))
        .map((entry) => join(tmpdir(), entry, `${job.id}.log`));
      expect(logs.some((file) => existsSync(file))).toBe(false);
    } finally {
      const cleanup = await Promise.allSettled([route.close()]);
      await gate.stop();
      await rm(root, { recursive: true, force: true });
      expect(
        cleanup.filter((result) => result.status === 'rejected'),
      ).toStrictEqual([]);
    }
  }

  it.skipIf(process.platform === 'win32')(
    'joins a terminal leader whose TERM-ignoring same-group descendant remains',
    terminalDescendantDrain,
    30_000,
  );
  it.skipIf(process.platform === 'win32')(
    'admits real managed jobs through two public Agents with the same session label over one Config',
    async () => {
      expect(await exercise(false)).toBe(true);
    },
    30_000,
  );
  it.skipIf(process.platform === 'win32')(
    'joins only the disposed facade work before releasing external effects',
    async () => {
      expect(await exercise(true)).toBe(false);
    },
    30_000,
  );
  it.skipIf(process.platform === 'win32')(
    'surfaces uncertain group ownership through public disposal without stopping a sibling Agent',
    async () => {
      expect(await exercise(true, true)).toBe(false);
    },
    30_000,
  );
  it.skipIf(process.platform === 'win32')(
    'cleans a safe same-owner group and log despite another group losing ownership',
    async () => {
      expect(await exercise(true, true, false, true)).toBe(false);
    },
    30_000,
  );
  it.skipIf(process.platform === 'win32')(
    'joins a held shell completion notice before disposing its Agent',
    async () => {
      expect(await exercise(true, false, true)).toBe(false);
    },
    30_000,
  );
});
