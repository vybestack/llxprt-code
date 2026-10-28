/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

import { realpath, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';

import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';

import { releaseAdoptedFileScope } from '../../adoption-release.js';

import { runCleanupSteps } from '../../../core/subagent-cleanup.js';

import { expect } from 'bun:test';

import type { executeProviderActivation } from '../../providerActivationExecutor.js';

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
import { type Agent } from '@vybestack/llxprt-code-agents';
import { AggregateDisposeError } from '../../disposeErrors.js';

import { deadline } from './shell-owner-gate.js';
export async function terminal(agent: Agent, id: string): Promise<void> {
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
export async function awaitGroupAbsence(pgid: number): Promise<void> {
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
export async function groupOf(pidPath: string): Promise<number> {
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
export async function disposeWithDeniedGroupObservation(
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
export async function assertUncertainDisposal(
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
export async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}
export function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
export function seedCallerSettings(
  config: Config,
  settings: SettingsService,
): void {
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
}
export function acquireCallerFileScopes(
  release: AcquisitionRelease,
  files: ProviderFileLifecycle,
  runtimeId: string,
  sessionId: string,
): void {
  for (const scope of [runtimeId, sessionId])
    release.acquire('files', () => releaseAdoptedFileScope(files, scope));
}
export async function callerWorkingDirectory(
  directory: string | undefined,
  fallback: string,
): Promise<string> {
  return directory === undefined ? fallback : realpath(directory);
}
export function includeCallerCwd(
  directories: readonly string[] | undefined,
): string[] {
  return [...(directories ?? []), process.cwd()];
}
