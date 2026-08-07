/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  buildSeatbeltArgs,
  runSeatbeltSandbox,
  wireSeatbeltProxyCloseHandler,
} from './sandbox-seatbelt.js';
import {
  assertSeatbeltProxyPortAvailable,
  captureSeatbeltHarnessProcessState,
  cleanupSeatbeltHarnessFixture,
  restoreSeatbeltHarnessFixture,
} from './sandbox-seatbelt.test-helpers.js';
import { Storage } from '@vybestack/llxprt-code-storage';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isMacOS = os.platform() === 'darwin';

/** Extracts the value of a `-D NAME=value` seatbelt param from args. */
function paramValue(args: string[], name: string): string | undefined {
  const param = args.find(
    (a, i) => i > 0 && args[i - 1] === '-D' && a.startsWith(`${name}=`),
  );
  return param?.split('=').slice(1).join('=');
}

/**
 * Reads all 6 built-in .sb profile files and returns their content keyed by
 * profile name. Used by cross-platform source assertions.
 */
function readAllProfiles(): Record<string, string> {
  const profiles = [
    'permissive-open',
    'permissive-closed',
    'permissive-proxied',
    'restrictive-open',
    'restrictive-closed',
    'restrictive-proxied',
  ];
  const result: Record<string, string> = {};
  for (const p of profiles) {
    const filePath = path.join(__dirname, `sandbox-macos-${p}.sb`);
    result[p] = fs.readFileSync(filePath, 'utf8');
  }
  return result;
}

// ─── Cross-platform source assertions on .sb profiles ─────────────────────

describe('seatbelt .sb profiles: canonical roots and no legacy write grants', () => {
  const profiles = readAllProfiles();

  /**
   * Extracts every `(allow|deny) file-(read|write)*` grant block from a
   * profile's source text. Each block terminates at a standalone `)` line.
   */
  function extractGrantBlocks(content: string): string[] {
    return (
      content.match(
        /\((?:allow|deny)\s+file-(?:read|write)\*[\s\S]*?\n\)\s*\n/g,
      ) ?? []
    );
  }

  for (const [profileName, content] of Object.entries(profiles)) {
    describe(`profile: ${profileName}`, () => {
      it('grants writes to CONFIG_DIR, DATA_DIR, and LOG_DIR canonical roots', () => {
        expect(content).toContain('(subpath (param "CONFIG_DIR"))');
        expect(content).toContain('(subpath (param "DATA_DIR"))');
        expect(content).toContain('(subpath (param "LOG_DIR"))');
      });

      it('does NOT grant writes to HOME_DIR/.llxprt (no active legacy write grant)', () => {
        const writeGrants = (
          content.match(/\(allow file-write\*[\s\S]*?\n\)\s*\n/g) ?? []
        ).join('\n');
        expect(writeGrants).not.toContain(
          '(string-append (param "HOME_DIR") "/.llxprt")',
        );
      });

      it('every HOME_DIR/.llxprt grant is read-only (no write grants)', () => {
        const llxprtBlocks = extractGrantBlocks(content).filter(
          (b) => b.includes('HOME_DIR') && b.includes('.llxprt'),
        );
        expect(
          llxprtBlocks.filter((b) => !b.includes('file-read')),
        ).toStrictEqual([]);
      });
    });
  }

  it('extractGrantBlocks mutation guard: detects a reintroduced HOME_DIR/.llxprt write grant', () => {
    const mutatedProfile = `(version 1)
(deny default)
(allow file-write*
    (subpath (param "TARGET_DIR"))
    (subpath (param "CONFIG_DIR"))
    (subpath (param "DATA_DIR"))
    (subpath (string-append (param "HOME_DIR") "/.npm"))
    (subpath (string-append (param "HOME_DIR") "/.cache"))
    (subpath (string-append (param "HOME_DIR") "/.gitconfig"))
    (subpath (string-append (param "HOME_DIR") "/.llxprt"))
    (literal "/dev/null")
)
(allow file-read*
    (subpath (string-append (param "HOME_DIR") "/.llxprt"))
)
`;
    const writeGrants = (
      mutatedProfile.match(/\(allow file-write\*[\s\S]*?\n\)\s*\n/g) ?? []
    ).join('\n');
    expect(writeGrants).toContain(
      '(string-append (param "HOME_DIR") "/.llxprt")',
    );
    const writeBlocks = extractGrantBlocks(mutatedProfile)
      .filter((b) => b.includes('HOME_DIR') && b.includes('.llxprt'))
      .filter((b) => !b.includes('file-read'));
    expect(writeBlocks.length).toBeGreaterThan(0);
  });
});

// ─── buildSeatbeltArgs passes canonical root params ───────────────────────

describe('buildSeatbeltArgs: canonical root resolution', () => {
  let tmpRoot: string;
  const savedEnv: Record<string, string | undefined> = {};

  const ENV_KEYS = [
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_LOG_HOME',
    'LLXPRT_CACHE_HOME',
    'HOME',
  ] as const;

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    tmpRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'seatbelt-args-'),
    );
    const configHome = path.join(tmpRoot, 'config');
    const dataHome = path.join(tmpRoot, 'data');
    const logHome = path.join(tmpRoot, 'log');
    const cacheHome = path.join(tmpRoot, 'cache');
    await fs.promises.mkdir(configHome, { recursive: true });
    await fs.promises.mkdir(dataHome, { recursive: true });
    await fs.promises.mkdir(logHome, { recursive: true });
    await fs.promises.mkdir(cacheHome, { recursive: true });
    process.env['LLXPRT_CONFIG_HOME'] = configHome;
    process.env['LLXPRT_DATA_HOME'] = dataHome;
    process.env['LLXPRT_LOG_HOME'] = logHome;
    process.env['LLXPRT_CACHE_HOME'] = cacheHome;
    process.env['HOME'] = tmpRoot;
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  });

  it.each([
    ['CONFIG_DIR', () => Storage.getGlobalConfigDir()],
    ['DATA_DIR', () => Storage.getGlobalDataDir()],
    ['LOG_DIR', () => Storage.getGlobalLogDir()],
    ['CACHE_DIR', () => Storage.getGlobalCacheDir()],
  ])(
    'passes %s resolved from canonical Storage resolver',
    (_name, resolver) => {
      const args = buildSeatbeltArgs('/tmp/profile.sb', 'node-opts');
      expect(paramValue(args, _name)).toBe(fs.realpathSync(resolver()));
    },
  );

  it.skipIf(process.platform === 'win32')(
    'creates missing canonical root directories with mode 0o700',
    () => {
      // Point CONFIG_DIR at a path that does NOT exist yet so
      // resolveRealpathSync must create it. The auto-created directory
      // must have a restrictive mode (0o700), not a permissive default.
      const newConfigDir = path.join(tmpRoot, 'fresh-config');
      expect(fs.existsSync(newConfigDir)).toBe(false);
      process.env['LLXPRT_CONFIG_HOME'] = newConfigDir;

      buildSeatbeltArgs('/tmp/profile.sb', 'node-opts');

      expect(fs.existsSync(newConfigDir)).toBe(true);
      const stat = fs.statSync(newConfigDir);
      // On macOS/Linux the mode is masked by umask, but 0o700 as the requested
      // mode means the result has no group/other bits. We assert that group
      // and other bits are absent (owner-only access).
      expect(stat.mode & 0o077).toBe(0);
    },
  );
});

// ─── Real macOS sandbox-exec behavioral test (gated to macOS) ─────────────

describe.skipIf(!isMacOS)(
  'real macOS sandbox-exec: canonical roots enforced',
  () => {
    let tmpRoot: string;
    const savedEnv: Record<string, string | undefined> = {};

    const ENV_KEYS = [
      'LLXPRT_CONFIG_HOME',
      'LLXPRT_DATA_HOME',
      'LLXPRT_LOG_HOME',
      'HOME',
    ] as const;

    beforeEach(async () => {
      for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      tmpRoot = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'seatbelt-real-'),
      );
      const configHome = path.join(tmpRoot, 'config');
      await fs.promises.mkdir(configHome, { recursive: true });
      process.env['LLXPRT_CONFIG_HOME'] = configHome;
      process.env['HOME'] = tmpRoot;
    });

    afterEach(async () => {
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      }
      await fs.promises.rm(tmpRoot, { recursive: true, force: true });
    });

    it('sandbox-exec permits write to CONFIG_DIR and denies write to legacy HOME/.llxprt', () => {
      const configDir = fs.realpathSync(process.env['LLXPRT_CONFIG_HOME']!);
      const realTmpRoot = fs.realpathSync(tmpRoot);
      const legacyDir = path.join(realTmpRoot, '.llxprt');
      fs.mkdirSync(legacyDir, { recursive: true });

      const profile = path.join(realTmpRoot, 'test.sb');
      fs.writeFileSync(
        profile,
        `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow file-read*)
(allow file-write*
    (subpath (param "CONFIG_DIR"))
    (literal "/dev/null")
)
;; read-only legacy grant
(allow file-read*
    (subpath (string-append (param "HOME_DIR") "/.llxprt"))
)
`,
      );

      function runInSandbox(cmd: string): string {
        return execFileSync(
          'sandbox-exec',
          [
            '-D',
            `CONFIG_DIR=${configDir}`,
            '-D',
            `HOME_DIR=${realTmpRoot}`,
            '-f',
            profile,
            'sh',
            '-c',
            cmd,
          ],
          { encoding: 'utf8', stdio: 'pipe' },
        );
      }

      // Write to CONFIG_DIR should succeed.
      execFileSync('sandbox-exec', [
        '-D',
        `CONFIG_DIR=${configDir}`,
        '-D',
        `HOME_DIR=${realTmpRoot}`,
        '-f',
        profile,
        'sh',
        '-c',
        `echo test > "${configDir}/write-test.txt"`,
      ]);
      expect(fs.existsSync(path.join(configDir, 'write-test.txt'))).toBe(true);

      // Write to legacy HOME/.llxprt should be DENIED.
      expect(() =>
        runInSandbox(`echo test > "${legacyDir}/denied.txt"`),
      ).toThrow(/denied|operation not permitted|sandbox/i);
      expect(fs.existsSync(path.join(legacyDir, 'denied.txt'))).toBe(false);

      // Read from legacy HOME/.llxprt should SUCCEED (read-only grant).
      const legacyFile = path.join(legacyDir, 'readme.txt');
      fs.writeFileSync(legacyFile, 'legacy data');
      expect(runInSandbox(`cat "${legacyFile}"`).trim()).toBe('legacy data');
    });
  },
);

// ─── AC11: Seatbelt starts no proxy and receives no capability transport (#1954)

/**
 * Reusable -D parameter pairs for the permissive-open profile that requires
 * all params defined. Used by every sandbox-exec spawn test.
 */
const PERMISSIVE_OPEN_D_PARAMS = [
  '-D',
  'TARGET_DIR=/tmp',
  '-D',
  'TMP_DIR=/tmp',
  '-D',
  'HOME_DIR=/tmp',
  '-D',
  'CACHE_DIR=/tmp',
  '-D',
  'CONFIG_DIR=/tmp',
  '-D',
  'DATA_DIR=/tmp',
  '-D',
  'LOG_DIR=/tmp',
  '-D',
  'INCLUDE_DIR_0=/dev/null',
  '-D',
  'INCLUDE_DIR_1=/dev/null',
  '-D',
  'INCLUDE_DIR_2=/dev/null',
  '-D',
  'INCLUDE_DIR_3=/dev/null',
  '-D',
  'INCLUDE_DIR_4=/dev/null',
];

const PERMISSIVE_OPEN_PROFILE = path.join(
  __dirname,
  'sandbox-macos-permissive-open.sb',
);

describe('AC11: seatbelt spawn env carries no capability transport (#1954)', () => {
  /**
   * Behavioral test through the real exported
   * runSeatbeltSandbox path. Begins with dirty capability markers in
   * process.env and asserts the actual spawned child env lacks
   * token/fd/socket. Uses a POSIX shell stub sandbox-exec binary on PATH
   * so this works without a real sandbox-exec.
   */
  it.skipIf(process.platform === 'win32')(
    'runSeatbeltSandbox: child env lacks LLXPRT_CAPABILITY_* and LLXPRT_CREDENTIAL_SOCKET even when parent env has dirty markers',
    async () => {
      const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stub-'));
      const stubPath = path.join(stubDir, 'sandbox-exec');
      const capturedEnvPath = path.join(stubDir, 'child-env');
      fs.writeFileSync(stubPath, '#!/bin/sh\nenv > "$SEATBELT_ENV_CAPTURE"\n', {
        mode: 0o755,
      });
      const savedFd = process.env.LLXPRT_CAPABILITY_FD;
      const savedTok = process.env.LLXPRT_CAPABILITY_TOKEN;
      const savedSock = process.env.LLXPRT_CREDENTIAL_SOCKET;
      const savedProfile = process.env.SEATBELT_PROFILE;
      const savedPath = process.env.PATH;
      process.env.LLXPRT_CAPABILITY_TOKEN = 'd'.repeat(64);
      process.env.LLXPRT_CAPABILITY_FD = '3';
      process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/fake-dirty.sock';
      process.env.SEATBELT_PROFILE = 'permissive-open';
      process.env.SEATBELT_ENV_CAPTURE = capturedEnvPath;
      process.env.PATH = `${stubDir}:${process.env.PATH ?? ''}`;
      try {
        await runSeatbeltSandbox(
          { command: 'sandbox-exec', image: 'test' } as never,
          [],
          undefined,
          [],
        );
        const childEnvOutput = fs.readFileSync(capturedEnvPath, 'utf8');
        expect(childEnvOutput).not.toContain('LLXPRT_CAPABILITY_TOKEN');
        expect(childEnvOutput).not.toContain('LLXPRT_CAPABILITY_FD');
        expect(childEnvOutput).not.toContain('LLXPRT_CREDENTIAL_SOCKET');
      } finally {
        if (savedFd !== undefined) process.env.LLXPRT_CAPABILITY_FD = savedFd;
        else delete process.env.LLXPRT_CAPABILITY_FD;
        if (savedTok !== undefined)
          process.env.LLXPRT_CAPABILITY_TOKEN = savedTok;
        else delete process.env.LLXPRT_CAPABILITY_TOKEN;
        if (savedSock !== undefined)
          process.env.LLXPRT_CREDENTIAL_SOCKET = savedSock;
        else delete process.env.LLXPRT_CREDENTIAL_SOCKET;
        if (savedProfile !== undefined)
          process.env.SEATBELT_PROFILE = savedProfile;
        else delete process.env.SEATBELT_PROFILE;
        process.env.PATH = savedPath;
        delete process.env.SEATBELT_ENV_CAPTURE;
        fs.rmSync(stubDir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!isMacOS)(
    'real sandbox-exec child inherits no capability transport markers from the post-consumption parent env',
    () => {
      expect(fs.existsSync(PERMISSIVE_OPEN_PROFILE)).toBe(true);

      const cleanEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: process.env.PATH ?? '/usr/bin:/bin',
      };
      delete cleanEnv.LLXPRT_CAPABILITY_FD;
      delete cleanEnv.LLXPRT_CAPABILITY_TOKEN;
      delete cleanEnv.LLXPRT_CREDENTIAL_SOCKET;

      const result = spawnSync(
        'sandbox-exec',
        [...PERMISSIVE_OPEN_D_PARAMS, '-f', PERMISSIVE_OPEN_PROFILE, 'env'],
        { encoding: 'utf8', env: cleanEnv },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      const childEnv = result.stdout;
      expect(childEnv).not.toContain('LLXPRT_CAPABILITY_FD');
      expect(childEnv).not.toContain('LLXPRT_CAPABILITY_TOKEN');
      expect(childEnv).not.toContain('LLXPRT_CREDENTIAL_SOCKET');
    },
  );

  it.skipIf(!isMacOS)(
    'O16: asserts real macOS sandbox-exec spawn success/failure surfaces correctly',
    () => {
      expect(fs.existsSync(PERMISSIVE_OPEN_PROFILE)).toBe(true);
      const dirtyEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        LLXPRT_CAPABILITY_TOKEN: 'd'.repeat(64),
        LLXPRT_CAPABILITY_FD: '3',
        LLXPRT_CREDENTIAL_SOCKET: '/tmp/fake.sock',
      };
      const ok = spawnSync(
        'sandbox-exec',
        [...PERMISSIVE_OPEN_D_PARAMS, '-f', PERMISSIVE_OPEN_PROFILE, 'env'],
        { encoding: 'utf8', env: dirtyEnv },
      );
      expect(ok.error).toBeUndefined();
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain('PATH=');

      const fail = spawnSync('sandbox-exec', [
        '-f',
        '/nonexistent/profile.sb',
        'env',
      ]);
      expect(fail.error !== undefined || fail.status !== 0).toBe(true);
    },
  );
});

const ISSUE_1456_ENV_KEYS = [
  'SEATBELT_PROFILE',
  'LLXPRT_SANDBOX_NETWORK',
  'SANDBOX_NETWORK',
  'LLXPRT_SANDBOX_PROXY_COMMAND',
  'LLXPRT_CAPABILITY_TOKEN',
  'LLXPRT_CAPABILITY_FD',
  'LLXPRT_CREDENTIAL_SOCKET',
  'PATH',
] as const;
const PROXIED_PROFILE_ERROR =
  'Seatbelt proxied profile requires a non-empty LLXPRT_SANDBOX_PROXY_COMMAND.';
const BUILTIN_PROFILE_DIRECTORY = __dirname;

type Issue1456Environment = Partial<
  Record<(typeof ISSUE_1456_ENV_KEYS)[number], string>
>;

interface SeatbeltHarness {
  readonly cwd: string;
  readonly argsFile: string;
  readonly envFile: string;
  readonly sandboxMarker: string;
  readonly proxyMarker: string;
  readonly proxyCommand: string;
  readonly cleanup: () => Promise<void>;
}

function restoreEnvironment(
  snapshot: Readonly<Record<string, string | undefined>>,
): void {
  for (const key of ISSUE_1456_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function applyEnvironment(environment: Issue1456Environment): void {
  for (const key of ISSUE_1456_ENV_KEYS) {
    if (key !== 'PATH') delete process.env[key];
  }
  Object.assign(
    process.env,
    Object.fromEntries(
      ISSUE_1456_ENV_KEYS.flatMap((key) => {
        const value = environment[key];
        return value === undefined ? [] : [[key, value]];
      }),
    ),
  );
}

function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
}

function createSeatbeltHarness(cwd: string = process.cwd()): SeatbeltHarness {
  const restoreHarnessState = captureSeatbeltHarnessProcessState();
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-1456-'));

  try {
    const argsFile = path.join(fixtureDir, 'args');
    const envFile = path.join(fixtureDir, 'env');
    const sandboxMarker = path.join(fixtureDir, 'sandbox-spawned');
    const sandboxExitMarker = path.join(fixtureDir, 'sandbox-exit');
    const proxyMarker = path.join(fixtureDir, 'proxy-listening');
    const proxyPidFile = path.join(fixtureDir, 'proxy-pid');
    const proxyServer = path.join(fixtureDir, 'proxy.cjs');

    writeExecutable(
      path.join(fixtureDir, 'sandbox-exec'),
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\nenv > "${envFile}"\ntouch "${sandboxMarker}"\nif [ -n "${'$'}{LLXPRT_SANDBOX_PROXY_COMMAND-}" ]; then attempts=0; while [ ! -f "${sandboxExitMarker}" ]; do attempts=$((attempts + 1)); [ "$attempts" -ge 1000 ] && exit 124; sleep 0.01; done; fi\n`,
    );
    fs.writeFileSync(
      proxyServer,
      [
        "const fs = require('node:fs');",
        "const http = require('node:http');",
        `const server = http.createServer((_request, response) => response.end('ok'));`,
        `server.listen(8877, '127.0.0.1', () => {`,
        `  fs.writeFileSync(${JSON.stringify(proxyPidFile)}, String(process.pid));`,
        `  fs.writeFileSync(${JSON.stringify(proxyMarker)}, 'listening');`,
        `  const interval = setInterval(() => {`,
        `    if (fs.existsSync(${JSON.stringify(sandboxMarker)})) {`,
        `      clearInterval(interval);`,
        `      fs.writeFileSync(${JSON.stringify(sandboxExitMarker)}, 'exit');`,
        `      server.close(() => process.exit(0));`,
        `    }`,
        `  }, 10);`,
        '});',
        "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
      ].join('\n'),
    );
    writeExecutable(
      path.join(fixtureDir, 'timeout'),
      ['#!/bin/sh', 'shift', 'exec "$@"'].join('\n'),
    );
    writeExecutable(
      path.join(fixtureDir, 'curl'),
      `#!/bin/sh\ncase "${'$'}{LLXPRT_SANDBOX_PROXY_COMMAND-}" in *proxy.cjs*) attempts=0; while [ ! -f "${proxyMarker}" ]; do attempts=$((attempts + 1)); [ "$attempts" -ge 1000 ] && exit 124; sleep 0.01; done;; esac\nexit 0\n`,
    );
    process.env.PATH = `${fixtureDir}:${process.env.PATH ?? ''}`;

    Object.defineProperty(process, 'kill', {
      configurable: true,
      value: () => {
        const error = new Error('kill ESRCH');
        Object.assign(error, { code: 'ESRCH' });
        throw error;
      },
      writable: true,
    });
    Object.defineProperty(process, 'exit', {
      configurable: true,
      value: () => undefined,
      writable: true,
    });

    const proxyCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(proxyServer)}`;
    const cleanup = async (): Promise<void> => {
      const proxyPid = fs.existsSync(proxyPidFile)
        ? Number(fs.readFileSync(proxyPidFile, 'utf8').trim())
        : undefined;
      await cleanupSeatbeltHarnessFixture(
        fixtureDir,
        restoreHarnessState,
        proxyPid,
      );
    };
    return {
      cwd,
      argsFile,
      envFile,
      sandboxMarker,
      proxyMarker,
      proxyCommand,
      cleanup,
    };
  } catch (error) {
    restoreSeatbeltHarnessFixture(fixtureDir, restoreHarnessState);
    throw error;
  }
}

async function executeSeatbeltHarness(
  harness: SeatbeltHarness,
  environment: Issue1456Environment,
): Promise<number> {
  applyEnvironment(environment);
  process.chdir(harness.cwd);
  return runSeatbeltSandbox(
    { command: 'sandbox-exec', image: 'test' },
    [],
    undefined,
    [],
  );
}

function assertSelectedProfile(
  harness: SeatbeltHarness,
  expectedProfile: string,
): void {
  const args = fs.readFileSync(harness.argsFile, 'utf8').trim().split('\n');
  const profileFlagIndex = args.indexOf('-f');
  expect(profileFlagIndex).toBeGreaterThanOrEqual(0);
  const selectedProfile = args[profileFlagIndex + 1] ?? '';
  expect(selectedProfile).toBe(expectedProfile);
  expect(fs.existsSync(path.resolve(harness.cwd, selectedProfile))).toBe(true);
}

function assertScrubbedEnvironment(harness: SeatbeltHarness): void {
  const childEnvironment = fs.readFileSync(harness.envFile, 'utf8');
  expect(childEnvironment).not.toContain('LLXPRT_CAPABILITY_TOKEN=');
  expect(childEnvironment).not.toContain('LLXPRT_CAPABILITY_FD=');
  expect(childEnvironment).not.toContain('LLXPRT_CREDENTIAL_SOCKET=');
}

describe.sequential('#1456 Seatbelt network policy', () => {
  let environmentSnapshot: Record<string, string | undefined>;
  let originalCwd: string;

  beforeEach(() => {
    environmentSnapshot = Object.fromEntries(
      ISSUE_1456_ENV_KEYS.map((key) => [key, process.env[key]]),
    );
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    restoreEnvironment(environmentSnapshot);
  });

  it.skipIf(process.platform === 'win32').each([
    ['off', undefined, 'permissive-closed'],
    ['on', undefined, 'permissive-open'],
    ['unexpected', undefined, 'permissive-open'],
    [undefined, undefined, 'permissive-open'],
    [undefined, 'off', 'permissive-closed'],
    ['on', 'off', 'permissive-open'],
    ['', 'off', 'permissive-open'],
  ])(
    'maps primary=%s and legacy=%s to %s',
    async (primary, legacy, profile) => {
      const harness = createSeatbeltHarness();
      try {
        await executeSeatbeltHarness(harness, {
          LLXPRT_SANDBOX_NETWORK: primary,
          SANDBOX_NETWORK: legacy,
        });
        assertSelectedProfile(
          harness,
          path.join(BUILTIN_PROFILE_DIRECTORY, `sandbox-macos-${profile}.sb`),
        );
        expect(fs.existsSync(harness.sandboxMarker)).toBe(true);
        expect(fs.existsSync(harness.proxyMarker)).toBe(false);
      } finally {
        await harness.cleanup();
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'uses an empty explicit profile as automatic network selection',
    async () => {
      const harness = createSeatbeltHarness();
      try {
        await executeSeatbeltHarness(harness, {
          SEATBELT_PROFILE: '',
          LLXPRT_SANDBOX_NETWORK: 'off',
        });
        assertSelectedProfile(
          harness,
          path.join(
            BUILTIN_PROFILE_DIRECTORY,
            'sandbox-macos-permissive-closed.sb',
          ),
        );
        expect(fs.existsSync(harness.sandboxMarker)).toBe(true);
      } finally {
        await harness.cleanup();
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'honors a conflicting non-empty explicit profile',
    async () => {
      const harness = createSeatbeltHarness();
      try {
        await executeSeatbeltHarness(harness, {
          SEATBELT_PROFILE: 'permissive-closed',
          LLXPRT_SANDBOX_NETWORK: 'proxied',
        });
        assertSelectedProfile(
          harness,
          path.join(
            BUILTIN_PROFILE_DIRECTORY,
            'sandbox-macos-permissive-closed.sb',
          ),
        );
        expect(fs.existsSync(harness.proxyMarker)).toBe(false);
      } finally {
        await harness.cleanup();
      }
    },
  );

  it
    .skipIf(process.platform === 'win32')
    .each(['custom-policy', 'custom-proxied-policy'])(
    'loads real custom profile %s from an isolated cwd',
    async (profile) => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-cwd-1456-'));
      const profileDirectory = path.join(cwd, '.llxprt');
      const profilePath = path.join(
        profileDirectory,
        `sandbox-macos-${profile}.sb`,
      );
      fs.mkdirSync(profileDirectory, { recursive: true });
      fs.writeFileSync(profilePath, '(version 1)\n(deny default)\n');
      const harness = createSeatbeltHarness(cwd);
      try {
        await executeSeatbeltHarness(harness, {
          SEATBELT_PROFILE: profile,
          LLXPRT_SANDBOX_NETWORK: 'proxied',
        });
        assertSelectedProfile(
          harness,
          path.join('.llxprt', `sandbox-macos-${profile}.sb`),
        );
        expect(fs.existsSync(harness.proxyMarker)).toBe(false);
      } finally {
        await harness.cleanup();
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'allocates both proxy listener and sandbox for valid proxied mode and scrubs child credentials',
    async () => {
      await assertSeatbeltProxyPortAvailable();
      const harness = createSeatbeltHarness();
      try {
        await executeSeatbeltHarness(harness, {
          LLXPRT_SANDBOX_NETWORK: 'proxied',
          LLXPRT_SANDBOX_PROXY_COMMAND: harness.proxyCommand,
          LLXPRT_CAPABILITY_TOKEN: 'd'.repeat(64),
          LLXPRT_CAPABILITY_FD: '3',
          LLXPRT_CREDENTIAL_SOCKET: '/tmp/credential.sock',
        });
        assertSelectedProfile(
          harness,
          path.join(
            BUILTIN_PROFILE_DIRECTORY,
            'sandbox-macos-permissive-proxied.sb',
          ),
        );
        expect(fs.existsSync(harness.proxyMarker)).toBe(true);
        expect(fs.existsSync(harness.sandboxMarker)).toBe(true);
        assertScrubbedEnvironment(harness);
      } finally {
        await harness.cleanup();
      }
    },
  );

  it.skipIf(process.platform === 'win32').each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])(
    'rejects automatic proxied mode with %s command before allocation',
    async (_label, command) => {
      const harness = createSeatbeltHarness();
      try {
        const result = executeSeatbeltHarness(harness, {
          LLXPRT_SANDBOX_NETWORK: 'proxied',
          LLXPRT_SANDBOX_PROXY_COMMAND: command,
        });
        await expect(result).rejects.toBeInstanceOf(FatalSandboxError);
        await expect(result).rejects.toThrowError(PROXIED_PROFILE_ERROR);
        expect(fs.existsSync(harness.proxyMarker)).toBe(false);
        expect(fs.existsSync(harness.sandboxMarker)).toBe(false);
      } finally {
        await harness.cleanup();
      }
    },
  );

  it
    .skipIf(process.platform === 'win32')
    .each(['permissive-proxied', 'restrictive-proxied'])(
    'rejects explicit built-in %s without a proxy command',
    async (profile) => {
      const harness = createSeatbeltHarness();
      try {
        const result = executeSeatbeltHarness(harness, {
          SEATBELT_PROFILE: profile,
        });
        await expect(result).rejects.toBeInstanceOf(FatalSandboxError);
        await expect(result).rejects.toThrowError(PROXIED_PROFILE_ERROR);
        expect(fs.existsSync(harness.proxyMarker)).toBe(false);
        expect(fs.existsSync(harness.sandboxMarker)).toBe(false);
      } finally {
        await harness.cleanup();
      }
    },
  );
});

describe('wireSeatbeltProxyCloseHandler', () => {
  /**
   * The credential proxy is a child of this process and closes as part of
   * normal teardown once the sandbox has exited. Treating every close as fatal
   * called process.exit(1) at the end of an otherwise successful session, which
   * surfaced in CI as an unhandled "process.exit unexpectedly called with 1".
   */
  function makeEmitterPair() {
    const proxyProcess = new EventEmitter() as unknown as ChildProcess;
    const sandboxProcess = new EventEmitter() as unknown as ChildProcess;
    Object.defineProperty(sandboxProcess, 'pid', { value: 0 });
    return { proxyProcess, sandboxProcess };
  }

  it('does not terminate the CLI when the proxy closes after the sandbox exited', () => {
    const { proxyProcess, sandboxProcess } = makeEmitterPair();
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    try {
      wireSeatbeltProxyCloseHandler(proxyProcess, sandboxProcess, 'proxy-cmd');

      (sandboxProcess as unknown as EventEmitter).emit('exit', 0, null);
      (proxyProcess as unknown as EventEmitter).emit('close', 0, null);

      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('terminates the CLI when the proxy dies while the sandbox is still running', () => {
    const { proxyProcess, sandboxProcess } = makeEmitterPair();
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    try {
      wireSeatbeltProxyCloseHandler(proxyProcess, sandboxProcess, 'proxy-cmd');

      (proxyProcess as unknown as EventEmitter).emit('close', 1, null);

      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });
});
