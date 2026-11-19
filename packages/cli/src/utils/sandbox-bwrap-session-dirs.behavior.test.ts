/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  BWRAP_SESSION_DIR_PREFIX,
  BWRAP_SESSION_OWNER_FILE,
  createBwrapSessionDir,
  reapStaleBwrapSessionDirs,
} from './sandbox-bwrap-session-dirs.js';

/**
 * Every bwrap launch keeps its credential proxy socket in a private session
 * directory under the temp directory. SIGKILL gives the host no chance to
 * remove it, so the next launch reaps the directories of hosts that are
 * provably gone and leaves every live session alone. The host in these tests
 * is a real process running the production launch function against a real
 * bwrap sandbox; its temp directory is private to the test.
 */

const HOST_SCRIPT = fileURLToPath(
  new URL('./__tests__/sandbox-bwrap-session-host.ts', import.meta.url),
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
const LAUNCH_TIMEOUT_MS = 600_000;
const TEST_TIMEOUT_MS = 720_000;
const TEARDOWN_TIMEOUT_MS = 60_000;

const scratchRoot = path.resolve(process.cwd(), '..', '..', '.work', 'phase1b');

const PAYLOAD_SOURCE = [
  "require('node:fs').writeFileSync('ready', String(process.pid));",
  'setInterval(() => {}, 1000);',
  '',
].join('\n');

interface RunningHost {
  readonly host: ChildProcess;
  readonly exited: Promise<void>;
}

function sessionDirsIn(root: string): string[] {
  return fs
    .readdirSync(root)
    .filter((entry) => entry.startsWith(BWRAP_SESSION_DIR_PREFIX))
    .sort();
}

async function waitUntil(
  condition: () => boolean,
  description: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The pid of a process that has already ended. */
function deadPid(): number {
  return spawnSync('/bin/true').pid;
}

describe('bwrap session directories', () => {
  const fixtures: string[] = [];
  const hosts: ChildProcess[] = [];

  // Removing the fixtures takes longer than the default hook timeout on a
  // loaded shared machine.
  afterEach(() => {
    for (const host of hosts.splice(0)) {
      if (host.exitCode === null && host.signalCode === null) {
        host.kill('SIGKILL');
      }
    }
    for (const fixture of fixtures.splice(0)) {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }, TEARDOWN_TIMEOUT_MS);

  function createFixture(): string {
    fs.mkdirSync(scratchRoot, { recursive: true });
    const fixture = fs.mkdtempSync(path.join(scratchRoot, 'session-dirs-'));
    fixtures.push(fixture);
    return fixture;
  }

  /**
   * Starts a host whose temp directory is `tmp` and waits until its payload
   * runs inside the sandbox. `name` keeps each host's workspace apart.
   */
  async function startHost(
    fixture: string,
    tmp: string,
    name: string,
  ): Promise<RunningHost> {
    const workspace = path.join(fixture, name, 'workspace');
    const home = path.join(fixture, name, 'home');
    const entryDir = path.join(fixture, name, 'runtime', 'bin');
    const payload = path.join(entryDir, 'payload.cjs');
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(home);
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(payload, PAYLOAD_SOURCE);
    const log = fs.openSync(path.join(fixture, name, 'host.log'), 'w');
    const host = spawn(process.execPath, [HOST_SCRIPT], {
      cwd: workspace,
      stdio: ['pipe', log, log],
      env: {
        ...process.env,
        HOME: home,
        TMPDIR: tmp,
        SANDBOX_PAYLOAD: payload,
      },
    });
    fs.closeSync(log);
    hosts.push(host);
    const exited = new Promise<void>((resolve) => {
      host.once('exit', () => resolve());
    });
    const readyFile = path.join(workspace, 'ready');
    await waitUntil(
      () =>
        fs.existsSync(readyFile) ||
        host.exitCode !== null ||
        host.signalCode !== null,
      `the ${name} payload to start`,
      LAUNCH_TIMEOUT_MS,
    );
    if (!fs.existsSync(readyFile)) {
      throw new Error(
        `Host ${name} exited before its payload started: ${fs.readFileSync(path.join(fixture, name, 'host.log'), 'utf8')}`,
      );
    }
    return { host, exited };
  }

  it.skipIf(skipBwrap)(
    'removes the directory of a SIGKILLed host on the next launch and leaves live sessions alone',
    async () => {
      const fixture = createFixture();
      const tmp = path.join(fixture, 'tmp');
      fs.mkdirSync(tmp);

      const live = await startHost(fixture, tmp, 'live');
      const [liveDir] = sessionDirsIn(tmp);
      const doomed = await startHost(fixture, tmp, 'doomed');
      const doomedDir = sessionDirsIn(tmp).filter((dir) => dir !== liveDir)[0];
      doomed.host.kill('SIGKILL');
      await doomed.exited;
      expect(fs.existsSync(path.join(tmp, doomedDir))).toBe(true);

      await startHost(fixture, tmp, 'next');

      const remaining = sessionDirsIn(tmp);
      expect(remaining).not.toContain(doomedDir);
      expect(remaining).toContain(liveDir);
      expect(remaining).toHaveLength(2);
      expect(live.host.exitCode).toBeNull();
      expect(
        fs
          .readdirSync(path.join(tmp, liveDir))
          .some((entry) => entry.endsWith('.sock')),
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  describe('reaping', () => {
    function writeOwner(
      dir: string,
      owner: Record<string, unknown> | string,
    ): void {
      fs.writeFileSync(
        path.join(dir, BWRAP_SESSION_OWNER_FILE),
        typeof owner === 'string' ? owner : JSON.stringify(owner),
      );
    }

    function ownerOf(pid: number, startTimeMs = Date.now()) {
      return {
        version: 1,
        hostname: os.hostname(),
        pid,
        startTimeMs,
        startTimeSource: 'observed',
      };
    }

    function staleDir(root: string, name: string): string {
      const dir = path.join(root, `${BWRAP_SESSION_DIR_PREFIX}${name}`);
      fs.mkdirSync(dir, { mode: 0o700 });
      return dir;
    }

    function ageDir(dir: string, ageMs: number): void {
      const when = new Date(Date.now() - ageMs);
      fs.utimesSync(dir, when, when);
    }

    function root(): string {
      const fixture = createFixture();
      const tmp = path.join(fixture, 'tmp');
      fs.mkdirSync(tmp);
      return tmp;
    }

    it('creates an owned private directory that the creating process keeps', () => {
      const tmp = root();
      const dir = createBwrapSessionDir(tmp);

      expect(path.dirname(dir)).toBe(tmp);
      expect(path.basename(dir).startsWith(BWRAP_SESSION_DIR_PREFIX)).toBe(
        true,
      );
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      reapStaleBwrapSessionDirs(tmp);
      expect(fs.existsSync(dir)).toBe(true);
    });

    it('removes the directory of an owner that no longer exists', () => {
      const tmp = root();
      const dir = staleDir(tmp, 'dead');
      fs.writeFileSync(path.join(dir, 'proxy.sock'), '');
      writeOwner(dir, ownerOf(deadPid()));

      reapStaleBwrapSessionDirs(tmp);

      expect(fs.existsSync(dir)).toBe(false);
    });

    it('removes the directory when its pid now belongs to a different process', () => {
      const tmp = root();
      const dir = staleDir(tmp, 'reused');
      writeOwner(dir, ownerOf(process.pid, Date.now() - 3_600_000));

      reapStaleBwrapSessionDirs(tmp);

      expect(fs.existsSync(dir)).toBe(false);
    });

    it('keeps the directory of an owner on another host', () => {
      const tmp = root();
      const dir = staleDir(tmp, 'elsewhere');
      writeOwner(dir, { ...ownerOf(deadPid()), hostname: 'another-host' });

      reapStaleBwrapSessionDirs(tmp);

      expect(fs.existsSync(dir)).toBe(true);
    });

    it('keeps a young directory that has no owner record yet', () => {
      const tmp = root();
      const dir = staleDir(tmp, 'young');

      reapStaleBwrapSessionDirs(tmp);

      expect(fs.existsSync(dir)).toBe(true);
    });

    it('removes an old directory without an owner record when nothing listens on its socket', () => {
      const tmp = root();
      const dir = staleDir(tmp, 'legacy');
      fs.writeFileSync(path.join(dir, 'proxy.sock'), '');
      ageDir(dir, 3_600_000);

      reapStaleBwrapSessionDirs(tmp);

      expect(fs.existsSync(dir)).toBe(false);
    });

    it('keeps an old directory without an owner record while a process listens on its socket', async () => {
      // A Unix socket path is limited to about 107 bytes, so this case needs a
      // root shorter than the scratch fixtures.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lxs-'));
      fixtures.push(tmp);
      const dir = staleDir(tmp, 'legacy-live');
      const socketPath = path.join(dir, 'proxy.sock');
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
      });
      try {
        ageDir(dir, 3_600_000);

        reapStaleBwrapSessionDirs(tmp);

        expect(fs.existsSync(dir)).toBe(true);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it('keeps a directory whose owner record it cannot read', () => {
      const tmp = root();
      const dir = staleDir(tmp, 'garbled');
      writeOwner(dir, '{not json');

      reapStaleBwrapSessionDirs(tmp);

      expect(fs.existsSync(dir)).toBe(true);
    });

    it('ignores unrelated entries and does not follow symbolic links', () => {
      const tmp = root();
      const unrelated = path.join(tmp, 'something-else');
      fs.mkdirSync(unrelated);
      const target = path.join(tmp, 'target');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'keep'), 'keep');
      writeOwner(target, ownerOf(deadPid()));
      const link = path.join(tmp, `${BWRAP_SESSION_DIR_PREFIX}link`);
      fs.symlinkSync(target, link);

      reapStaleBwrapSessionDirs(tmp);

      expect(fs.existsSync(unrelated)).toBe(true);
      expect(fs.readFileSync(path.join(target, 'keep'), 'utf8')).toBe('keep');
    });
  });
});
