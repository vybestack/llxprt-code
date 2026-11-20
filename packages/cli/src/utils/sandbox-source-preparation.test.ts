/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Launch-level behavior tests for source-checkout dependency preparation
 * (#3573 review round).
 *
 * `bun install` runs lifecycle scripts from the checkout. While it ran in the
 * main container's entrypoint, the entrypoint shell already held the
 * capability token, and the capability mount was present from container
 * start. A same-uid lifecycle script, or a daemon it left behind, could read
 * the token from that shell's memory or from /proc/<pid>/fd. The install now
 * runs in a separate short-lived container that never receives the capability
 * mount, the credential socket or any bridge, and that is gone before the
 * main container starts.
 *
 * These tests drive the REAL launch path (`runContainerSandbox`) against the
 * executable fake container engine. Only the main-container `spawn` and the
 * host credential proxy server are stood in, as in the other launch tests.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'bun:test';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { useFakeEngine } from '../../test-utils/fake-dependency-engine-harness.js';
import { runContainerSandbox } from './sandbox-exec.js';

const realAuthProviderModule = {
  ...(await import('@vybestack/llxprt-code-providers/auth.js')),
};
void vi.mock('@vybestack/llxprt-code-providers/auth.js', () => ({
  ...realAuthProviderModule,
  createAndStartProxy: vi.fn(async () => ({
    socketPath: '/tmp/llxprt-source-prep-fake.sock',
    capabilityToken: 'a'.repeat(64),
    stop: async () => {},
  })),
}));

const __actual = { ...(await import('node:child_process')) };
void vi.mock('node:child_process', () => {
  const actual: typeof import('node:child_process') = __actual;
  return {
    ...actual,
    execSync: vi.fn(),
    spawn: vi.fn(),
  };
});

const CONFIG = { command: 'docker', image: 'test' } as const;
const FAILURE_MESSAGE =
  'Failed to prepare isolated Linux dependencies for LLxprt source development';
const CAPABILITY_MOUNT_DESTINATION = '/run/llxprt-capability';
const POSIX = process.platform !== 'win32';

type SpawnMock = Mock<typeof childProcess.spawn>;

function flagValues(args: readonly string[], flag: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < args.length - 1; index++) {
    if (args[index] === flag) found.push(args[index + 1]);
  }
  return found;
}

function flagValue(args: readonly string[], flag: string): string {
  const value = flagValues(args, flag).at(-1);
  if (value === undefined) throw new Error(`Missing ${flag} value`);
  return value;
}

function exitedEngineProcess(
  stdout: string,
  exitCode: number,
): childProcess.ChildProcess {
  const proc = new EventEmitter() as unknown as childProcess.ChildProcess;
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  proc.stdout = stdoutStream;
  proc.stderr = stderrStream;
  queueMicrotask(() => {
    stdoutStream.end(stdout === '' ? undefined : Buffer.from(stdout));
    stderrStream.end();
    queueMicrotask(() => {
      proc.emit('close', exitCode, null);
    });
  });
  return proc;
}

function seedSourceCheckout(dir: string): void {
  fs.mkdirSync(path.join(dir, 'packages', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'packages', 'cli', 'index.ts'), '// cli\n');
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'llxprt-source-fixture', private: true }) + '\n',
  );
  fs.writeFileSync(path.join(dir, 'bun.lock'), '{}\n');
}

function capabilityHostDirectories(): string[] {
  return fs
    .readdirSync(os.tmpdir())
    .filter((entry) => entry.startsWith('llxprt-code-cap-'));
}

/** What the stand-in engine does when it is asked for the preparation run. */
type PreparationOutcome =
  | { readonly kind: 'exit'; readonly code: number }
  | { readonly kind: 'cannot-start' };

describe('source-checkout dependency preparation', () => {
  describe.skipIf(!POSIX)('runs in its own container', () => {
    const engine = useFakeEngine();
    let environmentSnapshot: NodeJS.ProcessEnv;
    let fixturePath = '';
    let originalCwd = '';
    let isolatedCacheDir = '';
    let engineRuns: string[][] = [];
    let preparationOutcome: PreparationOutcome = { kind: 'exit', code: 0 };

    function spawnMock(): SpawnMock {
      return childProcess.spawn as unknown as SpawnMock;
    }

    /** Registers a container with the fake engine the way `run` would. */
    function attachToFakeEngine(
      args: readonly string[],
      options: { readonly keepAfterExit: boolean },
    ): void {
      const attachArgs = ['run', '--name', flagValue(args, '--name')];
      for (const mount of flagValues(args, '--mount')) {
        attachArgs.push('--mount', mount);
      }
      attachArgs.push(engine.config.image, 'true');
      if (!options.keepAfterExit) return;
      const attached = __actual.spawnSync(engine.command, attachArgs, {
        encoding: 'utf8',
        env: process.env,
      });
      if (attached.status !== 0) {
        throw new Error(`Fake container failed: ${attached.stderr}`);
      }
    }

    function installEngineStandIn(): void {
      spawnMock().mockImplementation(((_command: string, args: string[]) => {
        if (args[0] === 'images') return exitedEngineProcess('image-id\n', 0);
        engineRuns.push([...args]);
        const isPreparation = flagValue(args, '--name').endsWith('-prep');
        if (!isPreparation) {
          attachToFakeEngine(args, { keepAfterExit: true });
          return exitedEngineProcess('', 0);
        }
        if (preparationOutcome.kind === 'cannot-start') {
          throw new Error('engine cannot start the preparation container');
        }
        // A failed run leaves its container record behind, as an engine does
        // when the host dies or the container is stopped without --rm
        // cleanup, so the release has to remove it before the volumes.
        attachToFakeEngine(args, {
          keepAfterExit: preparationOutcome.code !== 0,
        });
        return exitedEngineProcess('', preparationOutcome.code);
      }) as unknown as typeof childProcess.spawn);
    }

    function preparationRuns(): string[][] {
      return engineRuns.filter((args) =>
        flagValue(args, '--name').endsWith('-prep'),
      );
    }

    function mainRuns(): string[][] {
      return engineRuns.filter(
        (args) => !flagValue(args, '--name').endsWith('-prep'),
      );
    }

    function singleRun(runs: string[][]): string[] {
      expect(runs).toHaveLength(1);
      return runs[0];
    }

    beforeEach(() => {
      environmentSnapshot = { ...process.env };
      fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'source-prep-'));
      isolatedCacheDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'source-prep-c'),
      );
      process.env.LLXPRT_CACHE_HOME = isolatedCacheDir;
      originalCwd = process.cwd();
      seedSourceCheckout(fixturePath);
      process.chdir(fixturePath);
      vi.clearAllMocks();
      (
        childProcess.execSync as Mock<typeof childProcess.execSync>
      ).mockImplementation(((command: string) =>
        command === 'id -u' || command === 'id -g'
          ? Buffer.from('1234\n')
          : Buffer.from('image-id\n')) as typeof childProcess.execSync);
      for (const key of [
        'LLXPRT_SANDBOX_NETWORK',
        'SANDBOX_NETWORK',
        'LLXPRT_SANDBOX_PROXY_COMMAND',
        'SANDBOX_FLAGS',
        'SANDBOX_ENV',
        'SSH_AUTH_SOCK',
        'LLXPRT_DEBUG_PORT',
      ]) {
        delete process.env[key];
      }
      process.env.NODE_ENV = 'development';
      process.env.SANDBOX_SET_UID_GID = 'false';
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      engineRuns = [];
      preparationOutcome = { kind: 'exit', code: 0 };
      installEngineStandIn();
    });

    afterEach(() => {
      process.env = environmentSnapshot;
      vi.restoreAllMocks();
      process.chdir(originalCwd);
      fs.rmSync(fixturePath, { recursive: true, force: true });
      fs.rmSync(isolatedCacheDir, { recursive: true, force: true });
    });

    function assertEverythingReleased(): void {
      expect(engine.volumeNames()).toStrictEqual([]);
      expect(engine.containerNames()).toStrictEqual([]);
    }

    it('prepares the dependencies in a separate container that starts before the main container', async () => {
      const result = await runContainerSandbox(CONFIG, []);

      expect(result.exitCode).toBe(0);
      const order = engineRuns.map((args) =>
        flagValue(args, '--name').endsWith('-prep') ? 'prep' : 'main',
      );
      expect(order).toStrictEqual(['prep', 'main']);
      assertEverythingReleased();
    }, 30_000);

    it('gives the preparation container no capability mount, credential socket or bridge', async () => {
      await runContainerSandbox(CONFIG, []);

      const main = singleRun(mainRuns());
      const prep = singleRun(preparationRuns());

      // Control: the main container does carry them, so their absence from
      // the preparation argv is a real difference and not an empty search.
      const mainText = main.join('\n');
      expect(mainText).toContain(CAPABILITY_MOUNT_DESTINATION);
      expect(mainText).toContain('LLXPRT_CREDENTIAL_SOCKET=');

      const prepText = prep.join('\n');
      expect(prepText).not.toContain(CAPABILITY_MOUNT_DESTINATION);
      expect(prepText).not.toContain('llxprt-code-cap-');
      expect(prepText).not.toContain('CAPABILITY');
      expect(prepText).not.toContain('LLXPRT_CREDENTIAL_SOCKET');
      expect(prepText).not.toContain('--env-file');
      expect(prepText).not.toContain('SSH_AUTH_SOCK');
      expect(prepText).not.toContain('llxprt-sandbox-');
    }, 30_000);

    it('mounts only the workspace and the same private dependency volumes', async () => {
      await runContainerSandbox(CONFIG, []);

      const main = singleRun(mainRuns());
      const prep = singleRun(preparationRuns());

      expect(flagValues(prep, '--volume')).toStrictEqual([
        `${fixturePath}:${fixturePath}`,
      ]);
      expect(flagValues(prep, '--mount').length).toBeGreaterThan(0);
      expect(flagValues(prep, '--mount')).toStrictEqual(
        flagValues(main, '--mount'),
      );
      expect(flagValue(prep, '--workdir')).toBe(flagValue(main, '--workdir'));
      expect(prep).toContain(CONFIG.image);
      expect(main).toContain(CONFIG.image);
      // The same run label lets orphan recovery treat both as one run.
      const runLabel = flagValues(main, '--label').filter((label) =>
        label.startsWith('com.vybestack.llxprt.sandbox-dependency-run='),
      );
      expect(runLabel).toHaveLength(1);
      expect(flagValues(prep, '--label')).toContain(runLabel[0]);
    }, 30_000);

    it('keeps the hardening flags and runs the install as an unprivileged installer', async () => {
      await runContainerSandbox(CONFIG, []);

      const prep = singleRun(preparationRuns());

      expect(prep).toContain('--cap-drop=ALL');
      expect(flagValues(prep, '--security-opt')).toContain('no-new-privileges');
      expect(prep).not.toContain('--cap-add=CHOWN');
      expect(prep).not.toContain('-t');
      const script = String(prep.at(-1));
      expect(script).toContain('bun install --no-save');
    }, 30_000);

    it('uses the current-user uid and gid without the root setup stage', async () => {
      process.env.SANDBOX_SET_UID_GID = 'true';

      await runContainerSandbox(CONFIG, []);

      const main = singleRun(mainRuns());
      const prep = singleRun(preparationRuns());

      expect(flagValue(main, '--user')).toBe('root');
      expect(flagValue(prep, '--user')).toBe('1234:1234');
      expect(prep.filter((arg) => arg.startsWith('--cap-add'))).toStrictEqual(
        [],
      );
      // The su-less run has no passwd entry or home for that uid.
      expect(flagValues(prep, '--env')).toContain('HOME=/tmp');
    }, 30_000);

    it('removes the install from the main container entrypoint', async () => {
      await runContainerSandbox(CONFIG, []);

      const main = singleRun(mainRuns());

      expect(String(main.at(-1))).not.toContain('bun install');
      expect(String(main.at(-1))).toContain('bun ./packages/cli/index.ts');
    }, 30_000);

    it('does not prepare anything for a repository that is not a source checkout', async () => {
      fs.rmSync(path.join(fixturePath, 'packages'), { recursive: true });

      await runContainerSandbox(CONFIG, []);

      expect(preparationRuns()).toStrictEqual([]);
      expect(mainRuns()).toHaveLength(1);
    }, 30_000);

    it('does not prepare anything outside development mode', async () => {
      process.env.NODE_ENV = 'production';

      await runContainerSandbox(CONFIG, []);

      expect(preparationRuns()).toStrictEqual([]);
      expect(mainRuns()).toHaveLength(1);
    }, 30_000);

    describe('when preparation fails', () => {
      it('fails the launch with the same message, never starts the main container, and releases the volumes and the capability directory', async () => {
        preparationOutcome = { kind: 'exit', code: 1 };
        const capabilityDirsBefore = capabilityHostDirectories();

        await expect(runContainerSandbox(CONFIG, [])).rejects.toThrowError(
          FAILURE_MESSAGE,
        );

        expect(preparationRuns()).toHaveLength(1);
        expect(mainRuns()).toStrictEqual([]);
        assertEverythingReleased();
        expect(
          capabilityHostDirectories().filter(
            (entry) => !capabilityDirsBefore.includes(entry),
          ),
        ).toStrictEqual([]);
      }, 30_000);

      it('reports a missing manifest or lockfile with the message the entrypoint used to print', async () => {
        preparationOutcome = { kind: 'exit', code: 64 };

        await expect(runContainerSandbox(CONFIG, [])).rejects.toThrowError(
          'LLxprt source development requires package.json and bun.lock in the repository root',
        );
        expect(mainRuns()).toStrictEqual([]);
        assertEverythingReleased();
      }, 30_000);

      it('reports a missing Bun with the message the entrypoint used to print', async () => {
        preparationOutcome = { kind: 'exit', code: 65 };

        await expect(runContainerSandbox(CONFIG, [])).rejects.toThrowError(
          'LLxprt source development requires Bun in the sandbox image',
        );
        expect(mainRuns()).toStrictEqual([]);
        assertEverythingReleased();
      }, 30_000);

      it('fails the launch and releases the volumes when the engine cannot start the preparation container', async () => {
        preparationOutcome = { kind: 'cannot-start' };

        await expect(runContainerSandbox(CONFIG, [])).rejects.toThrowError(
          FAILURE_MESSAGE,
        );
        expect(mainRuns()).toStrictEqual([]);
        assertEverythingReleased();
      }, 30_000);
    });
  });
});
