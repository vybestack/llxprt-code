/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
import { readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { AggregateDisposeError } from '../disposeErrors.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { makeScratchDir } from './helpers/scratch-dir.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import {
  deadline,
  deferred,
  shellOwnerGate,
  shellQuote,
} from './helpers/shell-owner-gate.js';

async function terminal(agent: Agent, id: string): Promise<void> {
  await deadline(
    new Promise<void>((resolve) => {
      const check = (): void => {
        if (agent.tasks.get(id)?.status !== 'running') {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    }),
    `${id} terminal`,
  );
}

async function awaitGroupAbsence(pgid: number): Promise<void> {
  const until = Date.now() + 8000;
  for (;;) {
    try {
      process.kill(-pgid, 0);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
        return;
      }
      throw error;
    }
    if (Date.now() >= until) {
      throw new Error(
        `Shell process group ${pgid} still exists after gate shutdown`,
      );
    }
    await setImmediate();
  }
}

async function groupOf(pidPath: string): Promise<number> {
  const childPid = Number(await readFile(pidPath, 'utf8'));
  const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(childPid)], {
    encoding: 'utf8',
  });
  const pgid = Number(result.stdout.trim());
  if (result.status !== 0 || !Number.isSafeInteger(pgid) || pgid <= 1) {
    throw new Error(
      `Cannot identify the real shell process group: ${result.stderr}`,
    );
  }
  return pgid;
}

async function disposeWithDeniedGroupObservation(
  agent: Agent,
  pidPath: string,
): Promise<{ failure: unknown; pgid: number }> {
  const pgid = await groupOf(pidPath);
  const originalKill = process.kill;
  const forbidden: Array<string | number | undefined> = [];
  let denied = 0;
  process.kill = (pid, signal): true => {
    if (pid === -pgid) {
      if (signal !== 0) {
        forbidden.push(signal);
        throw new Error('Refusing a parent-issued numeric group signal');
      }
      denied++;
      throw Object.assign(new Error('observation denied'), { code: 'EPERM' });
    }
    return originalKill.call(process, pid, signal);
  };
  try {
    const disposal = agent.dispose();
    expect(agent.dispose()).toBe(disposal);
    const failure = await deadline(
      disposal.then(
        () => undefined,
        (error: unknown) => error,
      ),
      'Agent ownership loss disposal',
    );
    expect(denied).toBeGreaterThan(1);
    expect(forbidden).toStrictEqual([]);
    expect(failure).toBeInstanceOf(Error);
    return { failure, pgid };
  } finally {
    process.kill = originalKill;
  }
}

async function assertUncertainDisposal(
  agent: Agent,
  root: string,
  logParent: string,
  id: string,
  safe?: { id: string; pgid: number },
): Promise<{
  failure: AggregateDisposeError;
  retainedDir: string;
  pgid: number;
}> {
  const { failure, pgid } = await disposeWithDeniedGroupObservation(
    agent,
    join(root, 'A.marker.pid'),
  );
  expect(agent.tasks.get(id)).toBeDefined();
  expect(failure).toBeInstanceOf(AggregateDisposeError);
  if (!(failure instanceof AggregateDisposeError)) {
    throw new Error('Expected public disposal failure');
  }
  const groupFailure = failure.errors[0];
  expect(groupFailure).toBeInstanceOf(Error);
  if (!(groupFailure instanceof Error)) {
    throw new Error('Expected retained group failure');
  }
  expect(groupFailure.message).toContain('Cannot confirm shell process group');
  const dirs = (await readdir(logParent)).filter((entry) =>
    entry.startsWith('shell-jobs-'),
  );
  const retained = dirs.map((dir) => join(logParent, dir, `${id}.log`));
  const retainedLog = retained.find((file) => existsSync(file));
  if (!retainedLog) throw new Error('Unknown group log was discarded');
  expect(await readFile(retainedLog, 'utf8')).toContain(
    'waiting for shell owner gate',
  );
  if (safe) {
    await awaitGroupAbsence(safe.pgid);
    expect(existsSync(join(retainedLog, '..', `${safe.id}.log`))).toBe(false);
    expect(agent.tasks.get(safe.id)).toBeUndefined();
    expect(existsSync(join(root, 'A-safe.marker'))).toBe(false);
  }
  await expect(agent.dispose()).rejects.toBe(failure);
  return { failure, retainedDir: join(retainedLog, '..'), pgid };
}

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
      'LLXPRT_FAKE_RESPONSES',
    ].map((key) => [key, process.env[key]]),
  );
  for (const key of environment.keys()) {
    if (key !== 'LLXPRT_FAKE_RESPONSES') process.env[key] = root;
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
  let built: Awaited<ReturnType<typeof buildCliStyleConfig>> | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    built = await buildCliStyleConfig('plain-text.jsonl', {
      workingDir: root,
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
      skillsSupport: false,
    });
    const shared = built;
    const busSubscriptions: Array<() => void> = [];
    unsubscribe = () => busSubscriptions.forEach((stop) => stop());
    async function facade(): Promise<Agent> {
      const agent = await fromConfig({
        settingsOwner: shared.settingsOwner,
        settingsService: shared.settingsService,
        providerManager: shared.providerManager,
        sessionId: 'shell-owner-same-label',
        config: shared.config,
        mcpRuntime: shared.mcpRuntime,
        mcpOwnership: 'caller',
        messageBus: shared.messageBus,
      });

      agents.push(agent);
      expect(agent.getMessageBus()).not.toBe(shared.messageBus);
      const bus = agent.getMessageBus();
      busSubscriptions.push(
        bus.subscribe<ToolConfirmationRequest>(
          MessageBusType.TOOL_CONFIRMATION_REQUEST,
          (request) =>
            queueMicrotask(() =>
              bus.respondToConfirmation(
                request.correlationId,
                ToolConfirmationOutcome.ProceedOnce,
              ),
            ),
        ),
      );
      return agent;
    }
    const a = await facade();
    const b = await facade();
    expect(a.getMessageBus()).not.toBe(b.getMessageBus());
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
        if (holdShellNotice && heldNoticeId && message.includes(heldNoticeId)) {
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
      await deadline(noticeEntered.promise, 'shell completion notice entered');
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
    const callerCleanup = built
      ? await Promise.allSettled([built.config.dispose(), built.cleanup()])
      : [];
    const cleanup = [...agentCleanup, ...callerCleanup];
    await gate.stop();
    if (retainedDir && retainedPgid !== undefined) {
      await awaitGroupAbsence(retainedPgid);
      await rm(retainedDir, { recursive: true, force: true });
    }
    unsubscribe?.();
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
  const built = await buildCliStyleConfig('plain-text.jsonl', {
    workingDir: root,
    folderTrust: true,
    telemetry: { enabled: false },
    recording: { enabled: false },
    skillsSupport: false,
  });
  const unsubscribe = built.messageBus.subscribe<ToolConfirmationRequest>(
    MessageBusType.TOOL_CONFIRMATION_REQUEST,
    (request) => {
      queueMicrotask(() =>
        built.messageBus.respondToConfirmation(
          request.correlationId,
          ToolConfirmationOutcome.ProceedOnce,
        ),
      );
    },
  );
  let agent: Agent | undefined;
  try {
    agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
      mcpOwnership: 'caller',
      messageBus: built.messageBus,
    });
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
    unsubscribe();
    const cleanup = await Promise.allSettled([
      agent?.dispose(),
      built.config.dispose(),
      built.cleanup(),
    ]);
    await gate.stop();
    await rm(root, { recursive: true, force: true });
    expect(
      cleanup.filter((result) => result.status === 'rejected'),
    ).toStrictEqual([]);
  }
}

describe('Public Agent managed shell ownership (#2616)', () => {
  it.skipIf(process.platform === 'win32')(
    'joins a terminal leader whose TERM-ignoring same-group descendant remains',
    terminalDescendantDrain,
    30_000,
  );
  it.skipIf(process.platform === 'win32')(
    'admits real managed jobs through two public facades sharing Config and bus',
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
