/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'bun:test';

/**
 * Each case runs the production bwrap launch function in a host process of
 * its own, with a profile whose values the launcher must treat carefully, and
 * observes what the sandboxed payload received.
 */

const HOST_SCRIPT = fileURLToPath(
  new URL('./__tests__/sandbox-bwrap-config-host.ts', import.meta.url),
);

const bwrapProbe =
  process.platform === 'linux'
    ? spawnSync(
        'bwrap',
        [
          '--unshare-user',
          '--unshare-pid',
          '--disable-userns',
          '--ro-bind',
          '/',
          '/',
          '--',
          '/bin/true',
        ],
        { stdio: 'ignore', timeout: 1500 },
      )
    : undefined;
const skipBwrap =
  process.platform !== 'linux' ||
  (bwrapProbe?.status !== 0 &&
    process.env.LLXPRT_REQUIRE_BWRAP_TESTS !== 'true');

/** Upper bounds for cold Bun starts on a loaded shared machine. */
const HOST_TIMEOUT_MS = 240_000;
const TEST_TIMEOUT_MS = 300_000;

const scratchRoot = path.resolve(process.cwd(), '..', '..', '.work', 'phase1b');
const PAYLOAD_SOURCE = [
  "const fs = require('node:fs');",
  "fs.writeFileSync('payload-env.json', JSON.stringify({ PATH: process.env.PATH, GREETING: process.env.GREETING }));",
  '',
].join('\n');

interface HostRun {
  readonly workspace: string;
  readonly tmp: string;
  readonly status: number | null;
}

const fixtures: string[] = [];

function removeFixtures(): void {
  for (const fixture of fixtures.splice(0)) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

async function runHost(profile: Record<string, unknown>): Promise<HostRun> {
  fs.mkdirSync(scratchRoot, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(scratchRoot, 'launch-'));
  fixtures.push(fixture);
  const workspace = path.join(fixture, 'workspace');
  const home = path.join(fixture, 'home');
  const tmp = path.join(fixture, 'tmp');
  const entryDir = path.join(fixture, 'runtime', 'bin');
  for (const dir of [workspace, home, tmp, entryDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = path.join(entryDir, 'payload.cjs');
  fs.writeFileSync(payload, PAYLOAD_SOURCE);
  const log = fs.openSync(path.join(fixture, 'host.log'), 'w');
  const host = spawn(process.execPath, [HOST_SCRIPT], {
    cwd: workspace,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      HOME: home,
      TMPDIR: tmp,
      SANDBOX_PAYLOAD: payload,
      SANDBOX_CONFIG_JSON: JSON.stringify(profile),
    },
  });
  fs.closeSync(log);
  const timer = setTimeout(() => host.kill('SIGKILL'), HOST_TIMEOUT_MS);
  const status = await new Promise<number | null>((resolve) => {
    host.once('exit', (code) => resolve(code));
  });
  clearTimeout(timer);
  return { workspace, tmp, status };
}

function payloadEnvironment(run: HostRun): Record<string, string> {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(run.workspace, 'payload-env.json'), 'utf8'),
  );
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('payload environment was not recorded');
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value)]),
  );
}

describe('bwrap launch with profile values', () => {
  afterEach(removeFixtures);

  it.skipIf(skipBwrap)(
    'starts bwrap even when the profile sets PATH to a directory without it',
    async () => {
      const run = await runHost({ env: { PATH: '/profile-only/bin' } });

      expect(run.status).toBe(0);
      expect(payloadEnvironment(run).PATH).toBe('/profile-only/bin');
    },
    TEST_TIMEOUT_MS,
  );

  it.skipIf(skipBwrap)(
    'passes a profile value with spaces as one environment value',
    async () => {
      const run = await runHost({ env: { GREETING: 'hello brave world' } });

      expect(run.status).toBe(0);
      expect(payloadEnvironment(run).GREETING).toBe('hello brave world');
    },
    TEST_TIMEOUT_MS,
  );

  it.skipIf(skipBwrap)(
    'refuses a profile environment value that contains a NUL character before starting anything',
    async () => {
      const run = await runHost({ env: { GREETING: 'before\u0000after' } });

      expect(run.status).toBe(70);
      expect(
        fs.readFileSync(path.join(run.workspace, 'launch-error'), 'utf8'),
      ).toMatch(/NUL/);
      expect(fs.existsSync(path.join(run.workspace, 'payload-env.json'))).toBe(
        false,
      );
      expect(
        fs.readdirSync(run.tmp).filter((name) => name.startsWith('llxprt-')),
      ).toStrictEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it.skipIf(skipBwrap)(
    'refuses a profile environment name that contains a NUL character',
    async () => {
      const run = await runHost({ env: { 'BAD\u0000NAME': 'value' } });

      expect(run.status).toBe(70);
      expect(
        fs.readFileSync(path.join(run.workspace, 'launch-error'), 'utf8'),
      ).toMatch(/NUL/);
    },
    TEST_TIMEOUT_MS,
  );
});
