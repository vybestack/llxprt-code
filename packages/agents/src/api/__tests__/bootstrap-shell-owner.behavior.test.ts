/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgent } from '@vybestack/llxprt-code-agents';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import type { ToolControl } from '../control/toolControl.js';
import { resolveRepositoryFixture } from './helpers/fixtureRoot.js';
import { makeScratchDir } from './helpers/scratch-dir.js';
import {
  awaitShellGroupAbsence,
  deadline,
  shellOwnerGate,
  shellQuote,
} from './helpers/shell-owner-gate.js';

async function bootstrapFailure(denyObservation: boolean): Promise<number> {
  const root = await makeScratchDir('bootstrap-shell-owner-');
  const gate = await shellOwnerGate();
  const marker = join(root, 'bootstrap.marker');
  const primary = new Error('injected SessionStart bootstrap failure');
  const environment = new Map(
    [
      'TMPDIR',
      'LLXPRT_CONFIG_HOME',
      'LLXPRT_DATA_HOME',
      'LLXPRT_CACHE_HOME',
      'LLXPRT_LOG_HOME',
    ].map((key) => [key, process.env[key]]),
  );
  for (const key of environment.keys()) process.env[key] = root;
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
    shellQuote(`${gate.url}/bootstrap`),
    shellQuote(marker),
  ].join(' ');
  let pgid: number | undefined;
  let logDir: string | undefined;
  let denied = 0;
  const forbidden: Array<string | number | undefined> = [];
  const originalKill = process.kill;
  function denyGroupObservation(unsafeGroup: number): void {
    process.kill = (target, signal): true => {
      if (target === -unsafeGroup) {
        if (signal !== 0) {
          forbidden.push(signal);
          throw new Error(
            'Refusing numeric group signal on uncertain ownership',
          );
        }
        denied++;
        throw Object.assign(new Error('ownership observation denied'), {
          code: 'EPERM',
        });
      }
      return originalKill.call(process, target, signal);
    };
  }
  const toolsByOwner = new WeakMap<SessionClientOwner, ToolControl>();
  const createTools = SessionClientOwner.prototype.createToolControl;
  const createHooks = SessionClientOwner.prototype.createHookControl;
  const restore: Array<() => void> = [];
  try {
    const toolCapture = spyOn(
      SessionClientOwner.prototype,
      'createToolControl',
    ).mockImplementation(function (this: SessionClientOwner, ...args) {
      const control = createTools.call(this, ...args);
      toolsByOwner.set(this, control);
      return control;
    });
    restore.push(() => toolCapture.mockRestore());
    const hookCapture = spyOn(
      SessionClientOwner.prototype,
      'createHookControl',
    ).mockImplementation(function (this: SessionClientOwner, ...args) {
      const control = createHooks.call(this, ...args);
      const tools = toolsByOwner.get(this);
      if (tools === undefined)
        throw new Error('Expected tools from the same acquired session owner');
      const originalStart = control.triggerSessionStart.bind(control);
      control.triggerSessionStart = async () => {
        await originalStart();
        const shell = tools.get('run_shell_command');
        if (!shell) throw new Error('Bootstrap Agent has no shell tool');
        const launched = await deadline(
          shell.buildAndExecute(
            { command, is_background: true },
            new AbortController().signal,
          ),
          'bootstrap shell launch',
        );
        await gate.entered('bootstrap');
        const jobId = /Job ID: ([a-zA-Z0-9_-]+)/.exec(
          String(launched.llmContent),
        )?.[1];
        if (!jobId)
          throw new Error('Real background launch did not report its job id');
        const pid = Number(await readFile(`${marker}.pid`, 'utf8'));
        const group = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        pgid = Number(group.stdout.trim());
        if (group.status !== 0 || !Number.isSafeInteger(pgid) || pgid <= 1)
          throw new Error(`Cannot identify bootstrap group: ${group.stderr}`);
        const logParent = tmpdir();
        const dirs = (await readdir(logParent)).filter(
          (entry) =>
            entry.startsWith('shell-jobs-') &&
            existsSync(join(logParent, entry, `${jobId}.log`)),
        );
        if (dirs.length !== 1)
          throw new Error(
            `Expected one real bootstrap shell log directory for ${jobId}`,
          );
        logDir = join(logParent, dirs[0]);
        expect(await readFile(join(logDir, `${jobId}.log`), 'utf8')).toContain(
          'waiting for shell owner gate',
        );
        if (denyObservation) {
          denyGroupObservation(pgid);
        }
        throw primary;
      };
      return control;
    });
    restore.push(() => hookCapture.mockRestore());
    const failure = await deadline(
      createAgent({
        provider: 'openai',
        model: 'bootstrap-test-model',
        auth: {
          apiKey: 'bootstrap-test-key',
          baseUrl: 'http://127.0.0.1:9/v1',
        },
        workingDir: root,
        folderTrust: true,
        telemetry: { enabled: false },
        recording: { enabled: false },
        skillsSupport: false,
      }).then(
        () => undefined,
        (error: unknown) => error,
      ),
      'failed Agent construction',
    );
    if (!logDir || pgid === undefined)
      throw new Error(
        `Failure occurred before background shell launch: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
    if (denyObservation) {
      expect(failure).toBeInstanceOf(AggregateError);
      if (!(failure instanceof AggregateError))
        throw new Error('Missing aggregate bootstrap failure');
      expect(failure.errors[0]).toBe(primary);
      expect(
        failure.errors
          .slice(1)
          .map((error: unknown) =>
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error),
          )
          .join('\n'),
      ).toContain('Cannot confirm shell process group');
      expect(denied).toBeGreaterThan(0);
      expect(forbidden).toStrictEqual([]);
      expect(existsSync(logDir)).toBe(true);
    } else {
      expect(failure).toBe(primary);
      await awaitShellGroupAbsence(pgid);
      expect(existsSync(logDir)).toBe(false);
    }
    expect(existsSync(marker)).toBe(false);
    return pgid;
  } finally {
    process.kill = originalKill;
    for (const undo of restore.reverse()) undo();
    await gate.stop();
    if (pgid !== undefined) await awaitShellGroupAbsence(pgid);
    await rm(root, { recursive: true, force: true });
    for (const [key, value] of environment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('public Agent bootstrap shell ownership', () => {
  it.skipIf(process.platform === 'win32')(
    'joins a launched process and its log when construction fails after SessionStart',
    async () => {
      expect(await bootstrapFailure(false)).toBeGreaterThan(1);
    },
    30_000,
  );
  it.skipIf(process.platform === 'win32')(
    'aggregates the original bootstrap error with uncertain real group cleanup without numeric termination',
    async () => {
      expect(await bootstrapFailure(true)).toBeGreaterThan(1);
    },
    30_000,
  );
});
