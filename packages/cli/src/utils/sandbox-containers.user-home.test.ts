/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * #3471 selected container home creation.
 *
 * Split from sandbox-containers.test.ts for max-lines compliance. On the
 * current-user path (Debian/Ubuntu hosts auto-select it; SANDBOX_SET_UID_GID
 * forces it) the launcher runs groupadd/useradd as root and then drops to
 * the selected uid with HOME pinned to the host home. `useradd -d` never
 * creates that directory, and the fresh container does not contain the host
 * home path, so before the fix the su'd user could not create
 * $HOME/.local/... and the session died. These suites prove the root setup
 * creates the selected home with the selected uid/gid BEFORE the drop, and
 * that the host-derived path is safely quoted for the shell.
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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildContainerRunArgs,
  setupContainerUser,
} from './sandbox-containers.js';
import { getContainerPath } from './sandbox-env.js';
import { entrypoint } from './sandbox-entrypoint.js';

// Explicit factory mock: Bun's automock walks every export of
// node:child_process and hits getters that access private fields
// (this.#stdin), crashing the compat shim. Spread importOriginal so
// everything else in the module graph keeps the real implementations.
// Only execSync is stubbed: it is the process-launching call these tests
// must not actually perform; the emitted script assertions below inspect
// produced argv/script text, never mock call records.
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

// Repo pattern for stubbing execSync: a plain Mock with the simple signature
// the tests exercise; mockImplementation then needs no overload gymnastics.
const mockedExecSync = childProcess.execSync as unknown as Mock<
  (command: string) => string
>;

function buildArgs(fixturePath: string): string[] {
  return buildContainerRunArgs(
    CONFIG,
    'test-image',
    fixturePath,
    '/workspace',
    fixturePath,
  );
}

function envValue(args: readonly string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && i + 1 < args.length) {
      const pair = args[i + 1];
      if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1);
    }
  }
  return undefined;
}

const CONFIG_MOUNT_ENV_KEYS = [
  'SANDBOX_SET_UID_GID',
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
] as const;

/**
 * Escape hatch for the storage guard. These blocks clear the storage overrides
 * on purpose: the host's own config directory is what gets mounted, so the
 * unredirected platform default IS the subject. Nothing here writes to that
 * directory; the cases only assemble container arguments.
 */
const REAL_STORAGE_OPT_IN_ENV = 'LLXPRT_ALLOW_REAL_STORAGE_IN_TESTS';

describe('#3471 selected container home creation', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let fixturePath = '';

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'container-3471-'));
    vi.resetAllMocks();
    process.env.SANDBOX_SET_UID_GID = '1';
    for (const key of CONFIG_MOUNT_ENV_KEYS) {
      if (key !== 'SANDBOX_SET_UID_GID') delete process.env[key];
    }
    process.env[REAL_STORAGE_OPT_IN_ENV] = 'true';
    delete process.env.SANDBOX_ENV;
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    vi.restoreAllMocks();
    if (fixturePath !== '') {
      fs.rmSync(fixturePath, { recursive: true, force: true });
    }
  });

  /**
   * The root user-setup block the current-user branch injects before the
   * `su` privilege drop: `{ <commands>; } 3<&-`. Throws when absent so the
   * assertions below cannot silently degrade into substring checks on the
   * wrong script region.
   */
  function rootSetupBlock(script: string): string {
    const match = /\{ (.+); \} 3<&-/.exec(script);
    if (match === null) {
      throw new Error('root user-setup block not found in entrypoint script');
    }
    return match[1];
  }

  it('creates the selected container home with the selected uid/gid before the su drop', async () => {
    mockedExecSync.mockImplementation((command) => {
      if (command === 'id -u') return '4242\n';
      if (command === 'id -g') return '4243\n';
      return '';
    });
    const args = buildArgs(fixturePath);
    const finalEntrypoint = entrypoint(fixturePath, ['llxprt', 'chat']);
    await setupContainerUser(args, finalEntrypoint);

    const script = String(finalEntrypoint.at(-1));
    const setup = rootSetupBlock(script);
    const userDrop = script.indexOf('exec su -p');
    expect(userDrop).toBeGreaterThanOrEqual(0);
    // The home creation happens inside the root block, strictly before the
    // privilege drop to the selected user: after the drop the selected uid
    // cannot write the (root-owned) parent of its own home.
    const creation = /mkdir -p ('.+') && chown 4242:4243 ('.+')$/.exec(setup);
    if (creation === null) {
      throw new Error('home-creation command missing from the setup block');
    }
    expect(script.indexOf(setup)).toBeLessThan(userDrop);
    // useradd's -d and the created home agree on the exact path token.
    expect(creation[1]).toBe(creation[2]);
    expect(setup).toContain(`-d ${creation[1]}`);
  });

  // POSIX-only: executes the emitted creation command through a real `sh`,
  // which does not exist on Windows hosts.
  it.skipIf(process.platform === 'win32')(
    'creates a host-derived home whose path needs shell quoting, owned by the selected uid/gid',
    async () => {
      const uid = process.getuid?.() ?? 0;
      const gid = process.getgid?.() ?? 0;
      mockedExecSync.mockImplementation((command) => {
        if (command === 'id -u') return `${uid}\n`;
        if (command === 'id -g') return `${gid}\n`;
        return '';
      });
      // A host home that demands single-quote shell safety: spaces would
      // word-split, the embedded quote would end a naive quoting attempt,
      // and $home would expand as a variable.
      const hostileHome = path.join(fixturePath, "issue 3471 'selected' $home");
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(hostileHome);

      const args = buildArgs(fixturePath);
      const finalEntrypoint = entrypoint(fixturePath, ['llxprt', 'chat']);
      await setupContainerUser(args, finalEntrypoint);
      homedirSpy.mockRestore();

      expect(envValue(args, 'HOME')).toBe(getContainerPath(hostileHome));

      const setup = rootSetupBlock(String(finalEntrypoint.at(-1)));
      const creation =
        /mkdir -p ('.+') && chown ([0-9]+):([0-9]+) ('.+')$/.exec(setup);
      if (creation === null) {
        throw new Error('home-creation command missing from the setup block');
      }
      expect(creation[1]).toBe(creation[4]);

      // Behavioral proof: run the emitted creation text through a real
      // shell exactly as the container will. Unquoted emission would
      // word-split into several wrong directories; the chown-to-self of a
      // process-owned file succeeds without privileges.
      const run = childProcess.spawnSync('sh', ['-c', creation[0]]);
      expect(run.status).toBe(0);
      const stat = fs.statSync(hostileHome);
      expect(stat.isDirectory()).toBe(true);
      expect(stat.uid).toBe(uid);
      expect(stat.gid).toBe(gid);
      // No word-split strays were created next to the exact home.
      expect(fs.readdirSync(fixturePath)).toStrictEqual([
        path.basename(hostileHome),
      ]);
    },
  );
});
