/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural acceptance tests for the ShellJobManager ownership extraction.
 *
 * @plan PLAN-20260808-ISSUE2615
 *
 * These are the criteria the plan sets for the slice, and they are deliberately
 * behavioural. Structural checks — that Config has no shellJobManager field or
 * getter — are necessary but not sufficient: the previous attempt on this
 * branch satisfied every structural check it set itself while moving nothing at
 * runtime. So these tests use the real ShellJobManager and real processes, and
 * assert on observable behaviour: who can see a job, when an admission limit
 * takes effect, whether two sessions interfere, and whether disposal actually
 * terminates a process.
 */

import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { ShellJobManager } from '@vybestack/llxprt-code-core';
import { TasksControl } from '../../api/control/tasksControl.js';
import { SessionRuntime } from '../SessionRuntime.js';

/**
 * Minimal SettingsService stand-in. Not a mock of behaviour under test — it is
 * the settings *input*, and the point of several of these tests is that the
 * runtime reads from the exact instance it was handed.
 */
function settingsWith(values: Record<string, unknown>): {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
} {
  const store = new Map<string, unknown>(Object.entries(values));
  return {
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => {
      store.set(key, value);
    },
  };
}

type SettingsLike = ReturnType<typeof settingsWith>;

function newRuntime(settings: SettingsLike): SessionRuntime {
  // SessionRuntime only reads via resolveShellJobSettings(settingsService).
  return new SessionRuntime(settings as never);
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitUntil timed out');
}

describe('ShellJobManager ownership (issue #2615)', () => {
  it('constructs the manager from the exact settings instance it was handed', () => {
    // A pre-construction write determines the initial admission limit. This is
    // what proves the runtime reads the caller's scoped settings rather than a
    // default or a globally-resolved service.
    const settings = settingsWith({ 'shell-max-background-jobs': 3 });
    const runtime = newRuntime(settings);

    expect(runtime.shellJobManager.getMaxBackgroundJobs()).toBe(3);
  });

  it('surfaces a real background job through the tasks API with the same identity', async () => {
    const runtime = newRuntime(
      settingsWith({ 'shell-max-background-jobs': 4 }),
    );
    const tasks = new TasksControl({
      getManager: () => undefined,
      shellJobManager: runtime.shellJobManager,
    });

    const job = runtime.shellJobManager.launch({
      command: 'sleep 0.4',
      cwd: tmpdir(),
    });

    // The identity must be the same across the two surfaces. Before this
    // change, the tasks API reached the manager through a Config accessor; the
    // manager is now injected, and this asserts the injection reaches the same
    // object rather than a second instance.
    const listed = tasks.list();
    const ids = listed.map((t) => t.id);
    expect(ids).toContain(job.id);

    await runtime.dispose();
  });

  it('applies a new admission limit before the reactor call returns', async () => {
    const runtime = newRuntime(
      settingsWith({ 'shell-max-background-jobs': 1 }),
    );

    const first = runtime.shellJobManager.launch({
      command: 'sleep 0.6',
      cwd: tmpdir(),
    });
    await waitUntil(
      () => runtime.shellJobManager.getRunningJobs().length === 1,
    );

    // At a limit of one, a second concurrent launch must be refused.
    expect(() =>
      runtime.shellJobManager.launch({ command: 'sleep 0.6', cwd: tmpdir() }),
    ).toThrow();

    // The reaction is synchronous and mandatory: after it returns, admission
    // has already changed. Nothing is awaited here on purpose — that is the
    // property being asserted.
    runtime.applyMaxBackgroundJobs(3);
    expect(runtime.shellJobManager.getMaxBackgroundJobs()).toBe(3);

    const second = runtime.shellJobManager.launch({
      command: 'sleep 0.2',
      cwd: tmpdir(),
    });
    expect(second.id).not.toBe(first.id);

    await runtime.dispose();
  });

  it('keeps two runtimes isolated even when settings are identical', async () => {
    // The old scheduler singleton shared state whenever two callers happened to
    // pass the same sessionId string. Ownership must come from the object, not
    // from a matching identifier, so identical settings must not couple them.
    const shared = { 'shell-max-background-jobs': 2 };
    const a = newRuntime(settingsWith({ ...shared }));
    const b = newRuntime(settingsWith({ ...shared }));

    expect(a.shellJobManager).not.toBe(b.shellJobManager);

    const jobA = a.shellJobManager.launch({
      command: 'sleep 0.3',
      cwd: tmpdir(),
    });

    expect(a.shellJobManager.list().map((j) => j.id)).toContain(jobA.id);
    expect(b.shellJobManager.list().map((j) => j.id)).not.toContain(jobA.id);

    // Changing one runtime's admission budget must not move the other's.
    a.applyMaxBackgroundJobs(7);
    expect(a.shellJobManager.getMaxBackgroundJobs()).toBe(7);
    expect(b.shellJobManager.getMaxBackgroundJobs()).toBe(2);

    await a.dispose();
    await b.dispose();
  });

  it('terminates a real running process on disposal', async () => {
    const runtime = newRuntime(
      settingsWith({ 'shell-max-background-jobs': 2 }),
    );

    runtime.shellJobManager.launch({ command: 'sleep 30', cwd: tmpdir() });
    await waitUntil(
      () => runtime.shellJobManager.getRunningJobs().length === 1,
    );

    // Disposal is the runtime's responsibility now, not Config's. It must
    // actually reap the process rather than merely dropping the reference —
    // `sleep 30` would outlive the test otherwise.
    await runtime.dispose();

    expect(runtime.shellJobManager.getRunningJobs().length).toBe(0);
  });

  it('is safe to dispose more than once', async () => {
    const runtime = newRuntime(
      settingsWith({ 'shell-max-background-jobs': 1 }),
    );
    runtime.shellJobManager.launch({ command: 'sleep 0.2', cwd: tmpdir() });

    await runtime.dispose();
    // Idempotence matters because agent teardown and an owning caller can both
    // reach a runtime; a second dispose must not throw.
    await runtime.dispose();

    expect(runtime.shellJobManager.getRunningJobs().length).toBe(0);
  });

  it('does not let the tasks API invent a manager when none is injected', () => {
    // TasksControl used to call an optional getShellJobManager accessor. With
    // direct injection, absent means absent: no fallback, no lazy creation.
    const tasks = new TasksControl({ getManager: () => undefined });
    const listed = tasks.list();

    expect(listed).toEqual([]);
  });

  it('reports the manager it was constructed with, not a fresh one', () => {
    const runtime = newRuntime(
      settingsWith({ 'shell-max-background-jobs': 5 }),
    );
    const borrowed = runtime.coreSessionServices.shellJobManager;

    // The borrowed contract Config receives must hand over the very object the
    // runtime owns. If these ever diverge, Config would be assembling tools
    // around a manager nobody disposes.
    expect(borrowed).toBe(runtime.shellJobManager);
    expect(borrowed).toBeInstanceOf(ShellJobManager);
  });
});
