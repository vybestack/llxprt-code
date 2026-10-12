/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellSupervisorSource } from './shellJobSupervisor.js';
import type { BunSupervisorRuntime } from './shellJobGroup.js';
import { deadline, processGone } from './shell-terminal-test-helper.js';

async function groupGone(pid: number): Promise<void> {
  await deadline(
    (async () => {
      while (!processGone(-pid))
        await new Promise<void>((resolve) => setImmediate(resolve));
    })(),
  );
}

describe('shell supervisor runtime distribution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shell-supervisor-build-'));
  let compiledSource: typeof shellSupervisorSource;
  beforeAll(async () => {
    if (process.platform === 'win32') return;
    const build = spawnSync(
      'node',
      [
        join(import.meta.dir, '../../../../node_modules/typescript/bin/tsc'),
        join(import.meta.dir, 'shellJobSupervisor.ts'),
        join(import.meta.dir, 'shellJobGroup.ts'),
        '--rootDir',
        join(import.meta.dir, '..'),
        '--outDir',
        dir,
        '--target',
        'ES2022',
        '--module',
        'ES2022',
        '--skipLibCheck',
        '--strict',
        '--types',
        'node',
        '--moduleResolution',
        'node',
      ],
      { encoding: 'utf8' },
    );
    if (build.status !== 0) throw new Error(build.stdout + build.stderr);
    const module = await import(join(dir, 'services/shellJobSupervisor.js'));
    compiledSource = module.shellSupervisorSource;
    const bundle = await Bun.build({
      entrypoints: [join(import.meta.dir, 'shellJobRuntimeDriver.ts')],
      outdir: dir,
      target: 'node',
    });
    if (!bundle.success)
      throw new AggregateError(bundle.logs, 'Driver build failed');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('supports the typed native runtime dependency', async () => {
    const runtime: BunSupervisorRuntime = {
      spawn: (args, options) => Bun.spawn(args, options),
    };
    const logPath = join(dir, 'native-contract.log');
    const fd = openSync(logPath, 'w');
    try {
      const child = runtime.spawn(
        [
          process.execPath,
          '--eval',
          'console.log("native-output"); process.exitCode = 7',
        ],
        {
          detached: false,
          env: process.env,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: fd,
        },
      );
      const output = new Response(child.stdout).text();
      await child.stdin.end();
      expect(await deadline(child.exited)).toBe(7);
      expect((await output).trim()).toBe('native-output');
      expect(child.exitCode).toBe(7);
      expect(child.signalCode).toBeNull();
      expect(readFileSync(logPath, 'utf8')).toBe('');
    } finally {
      closeSync(fd);
    }
  });

  for (const runtime of ['node', process.execPath]) {
    for (const compiled of [false, true]) {
      it.skipIf(process.platform === 'win32')(
        `preserves command output and status with ${runtime}, compiled=${compiled}`,
        async () => {
          const source = (compiled ? compiledSource : shellSupervisorSource)({
            executable: '/bin/sh',
            args: ['-c', 'echo real-output; exit 7'],
            cwd: dir,
            graceMs: 20,
          });
          const process = Bun.spawn([runtime, '--eval', source], {
            detached: true,
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
          });
          const output = new Response(process.stdout).text();
          const log = new Response(process.stderr).text();
          try {
            await deadline(process.exited);
            await groupGone(process.pid);
            expect(await output).toContain(
              '"event":"result","exitCode":7,"signal":null',
            );
            expect(await log).toBe('real-output\n');
          } finally {
            await process.stdin.end();
            await deadline(process.exited);
            await groupGone(process.pid);
          }
        },
      );

      it.skipIf(process.platform === 'win32')(
        `drains on parent control EOF even with a closed result pipe (${runtime}, compiled=${compiled})`,
        async () => {
          const source = (compiled ? compiledSource : shellSupervisorSource)({
            executable: '/bin/sh',
            args: ['-c', 'sleep 1'],
            cwd: dir,
            graceMs: 20,
          });
          const process = Bun.spawn([runtime, '--eval', source], {
            detached: true,
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
          });
          await process.stdout.cancel();
          await process.stdin.end();
          try {
            await deadline(process.exited);
            await groupGone(process.pid);
            expect(process.signalCode).toBe('SIGKILL');
            expect(await new Response(process.stderr).text()).toBe('');
          } finally {
            await deadline(process.exited);
            await groupGone(process.pid);
          }
        },
      );
    }
    for (const mode of ['join', 'unref']) {
      it.skipIf(process.platform === 'win32')(
        `runs the bundled production transport with ${runtime} (${mode})`,
        async () => {
          const log = join(dir, `transport-${mode}.log`);
          const driver = Bun.spawn(
            [runtime, join(dir, 'shellJobRuntimeDriver.js'), mode, log],
            { stdout: 'pipe', stderr: 'pipe' },
          );
          const output = new Response(driver.stdout).text();
          const errors = new Response(driver.stderr).text();
          await deadline(driver.exited);
          const text = await output;
          const pid = Number(text.split('\n')[0]);
          expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
          await groupGone(pid);
          expect(driver.exitCode).toBe(0);
          expect(await errors).toBe('');
          expect(text.includes('"exitCode":7')).toBe(mode === 'join');
          expect(readFileSync(log, 'utf8')).toBe(
            mode === 'join' ? 'transport-output\n' : '',
          );
        },
      );
    }
  }
});
