/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the trusted sandbox entrypoint and host-only capability
 * env-file producer (issue #1954). Exercises the REAL generated entrypoint
 * command array against adversarial BASH_ENV and project sandbox.bashrc, using
 * a PATH-discoverable fixture recorder.
 *
 * @plan project-plans/issue-1954-sandbox-hardening.md (AC1-AC3, AC5, F1, F7, F10)
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { entrypoint } from './sandbox-entrypoint.js';
import {
  setupCredentialProxy,
  wireCleanupHandlers,
} from './sandbox-containers.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { LLXPRT_PLATFORM_PATHS } from '@vybestack/llxprt-code-storage/config/path-resolver.js';
import { STORAGE_ENV_KEYS } from '@vybestack/llxprt-code-storage/testing';

// Hoisted mocks for auth module — used by AC12 setupCredentialProxy/wireCleanupHandlers tests
const authMocks = {
  createAndStartProxy: vi.fn(),
  getProxySocketPath: vi.fn(),
  stopProxy: vi.fn(),
  getProxyCapabilityToken: vi.fn(),
};

void vi.mock('@vybestack/llxprt-code-providers/auth.js', () => ({
  createAndStartProxy: authMocks.createAndStartProxy,
  getProxySocketPath: authMocks.getProxySocketPath,
  stopProxy: authMocks.stopProxy,
  getProxyCapabilityToken: authMocks.getProxyCapabilityToken,
}));

const VALID_TOKEN = 'a'.repeat(64);
const BASH_CAP_REF = '${' + 'LLXPRT_CAPABILITY_TOKEN-}';
const realHome = os.homedir();
let realHomeCapabilityArtifacts = new Set<string>();

function legacyCapabilityArtifacts(home: string): string[] {
  return fs
    .readdirSync(home)
    .filter((entry) => entry.startsWith('.llxprt-code-cap-'))
    .sort();
}

beforeAll(() => {
  realHomeCapabilityArtifacts = new Set(legacyCapabilityArtifacts(realHome));
});

afterAll(() => {
  const newRealHomeArtifacts = legacyCapabilityArtifacts(realHome).filter(
    (entry) => !realHomeCapabilityArtifacts.has(entry),
  );
  expect(newRealHomeArtifacts).toStrictEqual([]);
});

function useTempDir(
  registerBefore: (fn: () => void) => void,
  registerAfter: (fn: () => void) => void,
): () => string {
  let tmpDir = '';
  registerBefore(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sep-'));
  });
  registerAfter(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  return () => tmpDir;
}

const realOsTmpdir: () => string = os.tmpdir;

/**
 * Overrides os.tmpdir for the code under test. Bun exposes os.tmpdir as an
 * accessor property, which vi.spyOn cannot wrap, and once TMPDIR is deleted
 * after being set, os.tmpdir keeps returning the stale value for the rest of
 * the process. Redefining the property avoids both pitfalls.
 */
function overrideOsTmpdir(value: string): void {
  Object.defineProperty(os, 'tmpdir', {
    value: () => value,
    configurable: true,
  });
}

function restoreOsTmpdir(): void {
  Object.defineProperty(os, 'tmpdir', {
    value: realOsTmpdir,
    configurable: true,
  });
}

/**
 * Produces the environment every spawned child runs with. spawnSync with an
 * inherited environment snapshots the process's ORIGINAL environment (see
 * packages/storage/src/config/assertTestStorageIsolation.ts), so the storage
 * isolation preload's post-startup assignments never reach children and they
 * resolve the real user config dir. Carrying the isolated roots explicitly
 * closes that gap; the key list comes from STORAGE_ENV_KEYS so a future
 * storage root cannot silently escape isolation.
 */
function withIsolatedStorageRoots(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  for (const key of STORAGE_ENV_KEYS) {
    const isolated = process.env[key];
    if (isolated === undefined) {
      throw new Error(
        `${key} is unset: the storage isolation preload must run before this suite spawns children`,
      );
    }
    childEnv[key] = isolated;
  }
  return childEnv;
}

/**
 * Path form safe to compare across the macOS /var -> /private/var symlink:
 * resolved through realpath when the path exists, plainly resolved otherwise
 * (a fresh runner may not have created the platform default config dir).
 */
function comparablePath(target: string): string {
  return fs.existsSync(target) ? fs.realpathSync(target) : path.resolve(target);
}

function runCmd(
  cmd: string[],
  env: NodeJS.ProcessEnv,
  options: { cwd?: string } = {},
): { stdout: string; stderr: string; exit: number } {
  const r = spawnSync(cmd[0], cmd.slice(1), {
    encoding: 'utf8',
    env: withIsolatedStorageRoots(env),
    cwd: options.cwd,
  });
  return { stdout: r.stdout, stderr: r.stderr, exit: r.status ?? -1 };
}

/** Runs a bash script with BASH_ENV unset and no profile/rc. */
function runBash(
  script: string,
  env: NodeJS.ProcessEnv,
  options: { cwd?: string } = {},
): { stdout: string; stderr: string; exit: number } {
  return runCmd(
    ['env', '-u', 'BASH_ENV', 'bash', '--noprofile', '--norc', '-c', script],
    env,
    options,
  );
}

function writeStealer(sentinelPath: string): string {
  const marker = 'STOLEN_' + Math.random().toString(36).slice(2);
  const file = path.join(path.dirname(sentinelPath), 'stealer.bashrc');
  fs.writeFileSync(
    file,
    [
      '#!/usr/bin/env bash',
      `if [ -n "${'$'}{LLXPRT_CAPABILITY_TOKEN-}" ]; then`,
      `  echo "${marker}:${'$'}LLXPRT_CAPABILITY_TOKEN" > "${sentinelPath}"`,
      `fi`,
      `if [ -e /dev/fd/3 ] && { echo probe <&3; } 2>/dev/null; then`,
      `  TOKEN_FROM_FD=$(cat <&3 2>/dev/null || true)`,
      `  echo "${marker}:FD:${'$'}TOKEN_FROM_FD" >> "${sentinelPath}"`,
      `fi`,
    ].join('\n'),
  );
  return file;
}

/**
 * Interpreter and module URL for the recorder's config-root probe. The
 * recorder fixture runs under whatever `node` is on PATH (standing in for an
 * installed CLI), and plain node can neither execute the TypeScript entry
 * bun resolves for `@vybestack/llxprt-code-storage` nor depend on a built
 * dist being present. The fixture therefore spawns this test process's bun
 * — the same interpreter the direct-child isolation test below uses — to run
 * the REAL resolver, `Storage.getGlobalConfigDir()`, in the recorder's own
 * (post-entrypoint) environment.
 */
const RESOLVER_EXECUTABLE = process.execPath;
const STORAGE_ENTRY_URL = import.meta.resolve('@vybestack/llxprt-code-storage');

/**
 * Installs a PATH-discoverable recorder that reads fd 3 and writes a JSON
 * report. Besides the token/env/fd fields, the report carries `configDir`,
 * the config root `Storage.getGlobalConfigDir()` resolves in the recorder's
 * environment, and `configDirError` (resolver stderr) when that probe fails.
 */
function installRecorder(
  binDir: string,
  sentinelPath: string,
  name = 'llxprt-fake-recorder',
): string {
  fs.mkdirSync(binDir, { recursive: true });
  const recorderPath = path.join(binDir, name);
  fs.writeFileSync(
    recorderPath,
    [
      '#!/usr/bin/env node',
      'const fs = require("node:fs");',
      'const fd = Number(process.env.LLXPRT_CAPABILITY_FD || "3");',
      'let token = "";',
      'try { const b = Buffer.alloc(256); const n = fs.readSync(fd, b, 0, 256, null); token = b.slice(0, n).toString("utf8"); } catch (e) {}',
      'try { fs.closeSync(fd); } catch (e) {}',
      `const resolution = require("node:child_process").spawnSync(${JSON.stringify(RESOLVER_EXECUTABLE)}, ["-e", ${JSON.stringify(`import(${JSON.stringify(STORAGE_ENTRY_URL)}).then((m) => process.stdout.write(String(m.Storage.getGlobalConfigDir())))`)}], { encoding: "utf8" });`,
      'const out = { tokenValid: /^[0-9a-f]{64}\\n$/.test(token), envToken: process.env.LLXPRT_CAPABILITY_TOKEN === undefined ? "UNSET" : "LEAKED", fdMarker: process.env.LLXPRT_CAPABILITY_FD, configDir: resolution.stdout || "", configDirError: resolution.status === 0 ? null : String(resolution.stderr || "") };',
      `fs.writeFileSync(${JSON.stringify(sentinelPath)}, JSON.stringify(out));`,
    ].join('\n'),
  );
  fs.chmodSync(recorderPath, 0o755);
  return name;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

/** Writes the inner trusted script to a temp file (preserving real newlines). */
function writeInnerScript(tmpDir: string, script: string): string {
  const p = path.join(tmpDir, 'inner-trusted-body.sh');
  fs.writeFileSync(p, script, 'utf8');
  fs.chmodSync(p, 0o700);
  return p;
}

describe('sandbox-entrypoint: trusted entrypoint security (AC2, AC3, F1, F7, F10)', () => {
  const getTmpDir = useTempDir(beforeEach, afterEach);

  beforeEach(() => {
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    delete process.env.LLXPRT_CAPABILITY_TOKEN;
    delete process.env.LLXPRT_CAPABILITY_FD;
    delete process.env.DEBUG;
    delete process.env.NODE_ENV;
  });

  function buildRecorderEntrypoint(
    tmpDir: string,
    sentinel: string,
    binDir: string,
    prefixes?: string[],
  ): string[] {
    installRecorder(binDir, sentinel, 'llxprt');
    return entrypoint(tmpDir, [], undefined, prefixes);
  }

  /** Builds the env for recorder entrypoint tests: inherits process.env,
   *  unsets BASH_ENV, and prepends binDir to PATH. */
  function recorderEnv(
    binDir: string,
    overrides: NodeJS.ProcessEnv = {},
  ): NodeJS.ProcessEnv {
    return {
      ...process.env,
      BASH_ENV: '',
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      ...overrides,
    };
  }

  it('spawned children resolve the isolated config dir, not the real user config dir', () => {
    const isolatedConfigHome = process.env.LLXPRT_CONFIG_HOME;
    if (isolatedConfigHome === undefined) {
      throw new Error(
        'LLXPRT_CONFIG_HOME is unset: the storage isolation preload must run before this suite spawns children',
      );
    }
    const probe = runCmd(
      [
        process.execPath,
        '-e',
        "import { Storage } from '@vybestack/llxprt-code-storage'; process.stdout.write(Storage.getGlobalConfigDir());",
      ],
      {},
    );
    if (probe.exit !== 0) {
      throw new Error(`config dir probe failed: ${probe.stderr.trim()}`);
    }
    // macOS reports the temp root as /var/folders/... while realpath resolves
    // /private/var/folders/...; resolve both sides before comparing.
    const resolvedConfigDir = comparablePath(probe.stdout.trim());
    expect(resolvedConfigDir).toBe(comparablePath(isolatedConfigHome));
    expect(resolvedConfigDir).not.toBe(
      comparablePath(LLXPRT_PLATFORM_PATHS.config),
    );
  });

  it.skipIf(process.platform === 'win32')(
    'captures and unsets the token; passes it on fd 3 to the final CLI (PATH recorder)',
    () => {
      const tmpDir = getTmpDir();
      const binDir = path.join(tmpDir, 'bin');
      const sentinel = path.join(tmpDir, 'rec.json');
      const cmd = buildRecorderEntrypoint(tmpDir, sentinel, binDir);
      const result = runCmd(
        cmd,
        recorderEnv(binDir, { LLXPRT_CAPABILITY_TOKEN: VALID_TOKEN }),
      );
      expect(result.exit).toBe(0);
      const rec = readJson<{
        tokenValid: boolean;
        envToken: string;
        fdMarker: string;
        configDir: string;
      }>(sentinel);
      expect(rec.tokenValid).toBe(true);
      expect(rec.envToken).toBe('UNSET');
      expect(rec.fdMarker).toBe('3');
      // The direct-child test above proves `runCmd` injects the isolated
      // root; this proves it SURVIVES the real generated entrypoint chain
      // (`env -u BASH_ENV` -> `bash --noprofile --norc` -> `exec` recorder).
      // A future entrypoint change that scrubs the child environment would
      // otherwise drop the final CLI onto the user's platform config dir
      // while the direct-child probe stays green. The recorder resolves the
      // root with the real `Storage.getGlobalConfigDir()` in its own
      // environment, so an empty `configDir` (probe failed) cannot pass
      // vacuously either.
      const isolatedConfigHome = process.env.LLXPRT_CONFIG_HOME;
      if (isolatedConfigHome === undefined) {
        throw new Error(
          'LLXPRT_CONFIG_HOME is unset: the storage isolation preload must run before this suite spawns children',
        );
      }
      const resolvedConfigDir = comparablePath(rec.configDir);
      expect(resolvedConfigDir).toBe(comparablePath(isolatedConfigHome));
      expect(resolvedConfigDir).not.toBe(
        comparablePath(LLXPRT_PLATFORM_PATHS.config),
      );
    },
  );

  it.skipIf(process.platform === 'win32').each([
    [
      'BASH_ENV',
      (tmpDir: string, stealerSentinel: string): NodeJS.ProcessEnv => {
        const stealer = writeStealer(stealerSentinel);
        return { BASH_ENV: stealer };
      },
    ],
    [
      'project sandbox.bashrc',
      (tmpDir: string, stealerSentinel: string): NodeJS.ProcessEnv => {
        fs.mkdirSync(path.join(tmpDir, '.llxprt'), { recursive: true });
        fs.copyFileSync(
          writeStealer(stealerSentinel),
          path.join(tmpDir, '.llxprt', 'sandbox.bashrc'),
        );
        return {};
      },
    ],
  ])(
    'adversarial %s cannot steal the token before the final CLI consumes it',
    (_label, setup) => {
      const tmpDir = getTmpDir();
      const binDir = path.join(tmpDir, 'bin');
      const sentinel = path.join(tmpDir, 'rec.json');
      const stealerSentinel = path.join(tmpDir, 'stolen.json');
      const cmd = buildRecorderEntrypoint(tmpDir, sentinel, binDir);
      const overrides = setup(tmpDir, stealerSentinel);
      const result = runCmd(
        cmd,
        recorderEnv(binDir, {
          LLXPRT_CAPABILITY_TOKEN: VALID_TOKEN,
          ...overrides,
        }),
        overrides.BASH_ENV !== undefined ? {} : { cwd: tmpDir },
      );
      expect(result.exit).toBe(0);
      const rec = readJson<{ tokenValid: boolean; envToken: string }>(sentinel);
      expect(rec.tokenValid).toBe(true);
      expect(rec.envToken).toBe('UNSET');
      expect(fs.existsSync(stealerSentinel)).toBe(false);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'F7: always unsets the env token even when fd 3 is pre-opened (su path)',
    () => {
      const tmpDir = getTmpDir();
      const binDir = path.join(tmpDir, 'bin');
      const sentinel = path.join(tmpDir, 'rec.json');
      const cmd = buildRecorderEntrypoint(tmpDir, sentinel, binDir);
      const innerScriptPath = writeInnerScript(tmpDir, cmd[cmd.length - 1]);
      const rootWrapper = [
        `__cap="${BASH_CAP_REF}"`,
        `exec 3<<<"${'$'}{__cap}"`,
        'unset __cap LLXPRT_CAPABILITY_TOKEN',
        `LLXPRT_CAPABILITY_FD=3 env -u BASH_ENV bash --noprofile --norc ${innerScriptPath}`,
      ].join('\n');
      const result = runBash(
        rootWrapper,
        recorderEnv(binDir, { LLXPRT_CAPABILITY_TOKEN: VALID_TOKEN }),
      );
      expect(result.exit).toBe(0);
      const rec = readJson<{ tokenValid: boolean; envToken: string }>(sentinel);
      expect(rec.tokenValid).toBe(true);
      expect(rec.envToken).toBe('UNSET');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'F7: tokenless path never sets the marker and never touches an unrelated pre-opened fd 3',
    () => {
      const tmpDir = getTmpDir();
      const binDir = path.join(tmpDir, 'bin');
      const sentinel = path.join(tmpDir, 'rec.json');
      const cmd = buildRecorderEntrypoint(tmpDir, sentinel, binDir);
      const innerScriptPath = writeInnerScript(tmpDir, cmd[cmd.length - 1]);
      const rootWrapper = [
        'exec 3<<<"UNRELATED_PREOPENED_CONTENT"',
        `env -u BASH_ENV bash --noprofile --norc ${innerScriptPath}`,
      ].join('\n');
      const result = runBash(rootWrapper, recorderEnv(binDir));
      expect(result.exit).toBe(0);
      const rec = readJson<{
        tokenValid: boolean;
        envToken: string;
        fdMarker: string | undefined;
      }>(sentinel);
      expect(rec.tokenValid).toBe(false);
      expect(rec.envToken).toBe('UNSET');
      expect(rec.fdMarker).toBeUndefined();
    },
  );

  it.skipIf(process.platform === 'win32')(
    'F1: prefixes compose AFTER capability capture into the script body (not into the BASH_ENV argv element)',
    () => {
      const tmpDir = getTmpDir();
      const binDir = path.join(tmpDir, 'bin');
      const sentinel = path.join(tmpDir, 'rec.json');
      const prefixSentinel = path.join(tmpDir, 'prefix-env.json');
      const fakePrefix = `python3 - > ${JSON.stringify(prefixSentinel)} 2>/dev/null <<'LLXPRT_PREFIX_PROBE_EOF'\nimport os, json, sys\nout = {"tokenPresent": os.environ.get("LLXPRT_CAPABILITY_TOKEN") is not None}\nsys.stdout.write(json.dumps(out))\nLLXPRT_PREFIX_PROBE_EOF`;
      const cmd = buildRecorderEntrypoint(tmpDir, sentinel, binDir, [
        fakePrefix,
      ]);
      const result = runCmd(
        cmd,
        recorderEnv(binDir, { LLXPRT_CAPABILITY_TOKEN: VALID_TOKEN }),
      );
      expect(result.exit).toBe(0);
      expect(
        readJson<{ tokenPresent: boolean }>(prefixSentinel).tokenPresent,
      ).toBe(false);
      const rec = readJson<{ tokenValid: boolean; envToken: string }>(sentinel);
      expect(rec.tokenValid).toBe(true);
      expect(rec.envToken).toBe('UNSET');
    },
  );

  it('F1: command array structure is [env,-u,BASH_ENV,bash,--noprofile,--norc,-c,SCRIPT] with prefix in SCRIPT', () => {
    const cmd = entrypoint(getTmpDir(), [], undefined, ['echo PREFIX_MARKER']);
    expect(cmd).toStrictEqual([
      'env',
      '-u',
      'BASH_ENV',
      'bash',
      '--noprofile',
      '--norc',
      '-c',
      cmd[7],
    ]);
    const script = cmd[7];
    expect(script).toContain('PREFIX_MARKER');
    expect(script.indexOf('unset LLXPRT_CAPABILITY_TOKEN')).toBeLessThan(
      script.indexOf('PREFIX_MARKER'),
    );
  });

  it('F10: uses the numeric DEBUG_PORT in the debug command (not the literal template string)', () => {
    const origDebug = process.env.DEBUG;
    const origPort = process.env.DEBUG_PORT;
    const origNodeEnv = process.env.NODE_ENV;
    process.env.DEBUG = 'true';
    process.env.DEBUG_PORT = '9231';
    try {
      const script = entrypoint(getTmpDir(), ['llxprt'])[7];
      expect(script).toContain('9231');
      expect(script).not.toContain('resolveDebugPort()');
    } finally {
      if (origDebug !== undefined) process.env.DEBUG = origDebug;
      else delete process.env.DEBUG;
      if (origPort !== undefined) process.env.DEBUG_PORT = origPort;
      else delete process.env.DEBUG_PORT;
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });

  it.skipIf(process.platform === 'win32')(
    'O21: fails fast when marker 3 is set but fd 3 cannot be read (with/without token)',
    () => {
      const cmd = entrypoint(getTmpDir(), ['llxprt']);
      const baseEnv = {
        ...process.env,
        LLXPRT_CAPABILITY_FD: '3',
        BASH_ENV: '',
      };
      for (const env of [
        baseEnv,
        { ...baseEnv, LLXPRT_CAPABILITY_TOKEN: VALID_TOKEN },
      ]) {
        const result = runCmd(cmd, env);
        expect(result.exit).not.toBe(0);
        expect(result.stderr).toMatch(/cannot be read|fd 3/i);
      }
    },
  );
});

/**
 * AC10/AC12 hardening tests (issue #1954). Behavioral tests exercising the real
 * production code paths in sandbox-containers.ts with a mocked auth module and
 * a fake ChildProcess (EventEmitter-based stub).
 */
describe('setupCredentialProxy: fail-fast when socket path is undefined (AC12)', () => {
  const getTmpDir = useTempDir(beforeEach, afterEach);
  let environmentSnapshot: NodeJS.ProcessEnv;
  let runtimeRoot = '';
  let isolatedHome = '';
  let sessionTmpdir = '';

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    runtimeRoot = path.join(getTmpDir(), 'runtime');
    isolatedHome = path.join(getTmpDir(), 'home');
    sessionTmpdir = path.join(getTmpDir(), 'session');
    fs.mkdirSync(runtimeRoot);
    fs.mkdirSync(isolatedHome);
    fs.mkdirSync(sessionTmpdir);
    delete process.env.XDG_RUNTIME_DIR;
    vi.resetAllMocks();
    overrideOsTmpdir(runtimeRoot);
    vi.spyOn(os, 'homedir').mockReturnValue(isolatedHome);
    authMocks.createAndStartProxy.mockResolvedValue({ stop: vi.fn() });
    authMocks.getProxySocketPath.mockReturnValue(undefined);
    authMocks.stopProxy.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    restoreOsTmpdir();
    vi.restoreAllMocks();
  });

  function callSetupCredentialProxy(): Promise<unknown> {
    return setupCredentialProxy(
      [],
      { command: 'docker', image: 'test' },
      sessionTmpdir,
      new Set<number>(),
      [],
    );
  }

  it('throws FatalSandboxError when getProxySocketPath returns undefined after createAndStartProxy succeeds', () =>
    expect(callSetupCredentialProxy()).rejects.toThrow(/socket path/i));

  it('attempts stopProxy and removes the session directory when socket path is undefined', async () => {
    try {
      await callSetupCredentialProxy();
    } catch {
      /* expected */
    }
    expect(authMocks.stopProxy).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(sessionTmpdir)).toBe(false);
  });

  it('surfaces both invariant and stopProxy failures via AggregateError when socket path is undefined and stopProxy rejects', async () => {
    authMocks.stopProxy.mockRejectedValue(new Error('stopProxy failed'));
    let caught: unknown;
    try {
      await callSetupCredentialProxy();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    if (!(caught instanceof AggregateError)) {
      throw new Error('Expected AggregateError');
    }
    const messages = caught.errors.map((error) =>
      error instanceof Error ? error.message : String(error),
    );
    expect(messages.some((message) => /socket path/i.test(message))).toBe(true);
    expect(messages.some((message) => /stopProxy failed/i.test(message))).toBe(
      true,
    );
    expect(fs.existsSync(sessionTmpdir)).toBe(false);
  });

  it('does not silently return unprotected sandbox (args unchanged)', async () => {
    const args: string[] = [];
    await expect(
      setupCredentialProxy(
        args,
        { command: 'docker', image: 'test' },
        sessionTmpdir,
        new Set<number>(),
        [],
      ),
    ).rejects.toThrow(/socket path/i);
    expect(args.some((arg) => arg.includes('LLXPRT_CREDENTIAL_SOCKET'))).toBe(
      false,
    );
    expect(args.some((arg) => arg.includes('--env-file'))).toBe(false);
    expect(fs.existsSync(sessionTmpdir)).toBe(false);
  });

  it('removes the session directory when capability env-file setup fails', async () => {
    authMocks.getProxySocketPath.mockReturnValue(
      path.join(sessionTmpdir, 'credential-proxy.sock'),
    );
    authMocks.getProxyCapabilityToken.mockReturnValue(VALID_TOKEN);
    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw new Error('simulated env-file write failure');
    });

    await expect(callSetupCredentialProxy()).rejects.toThrow(
      /env-file write failure/i,
    );
    expect(authMocks.stopProxy).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(sessionTmpdir)).toBe(false);
    expect(
      fs
        .readdirSync(runtimeRoot)
        .filter((entry) => entry.startsWith('llxprt-code-cap-')),
    ).toStrictEqual([]);
  });
});

describe('wireCleanupHandlers: stopProxy rejection is observable (AC12)', () => {
  let fakeProcess: ChildProcess;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const noop = () => {};

  /** Microtask settle helper for the void stopProxy().catch(...) path. */
  const flushMicrotasks = () =>
    new Promise<void>((resolve) => setImmediate(resolve));

  beforeEach(() => {
    vi.resetAllMocks();
    authMocks.stopProxy.mockReset();
    fakeProcess = new EventEmitter() as unknown as ChildProcess;
    Object.defineProperty(fakeProcess, 'pid', { value: 12345 });
    errorSpy = vi
      .spyOn(DebugLogger.prototype, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    fakeProcess.removeAllListeners();
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function wire(): void {
    wireCleanupHandlers(
      fakeProcess,
      undefined,
      {
        tunnelProcess: undefined,
        cleanup: undefined,
        entrypointPrefix: undefined,
      },
      undefined,
      undefined,
      noop,
    );
  }

  function wireAndClose(): void {
    wire();
    fakeProcess.emit('close', 0, null);
  }

  it('logs stopProxy rejection via debugLogger.error instead of swallowing', async () => {
    const stopErr = new Error('proxy stop failed');
    authMocks.stopProxy.mockRejectedValue(stopErr);
    wireAndClose();
    await flushMicrotasks();
    expect(authMocks.stopProxy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('proxy stop'),
      stopErr,
    );
  });

  it('preserves idempotency: stopProxy called only once across multiple signals', async () => {
    authMocks.stopProxy.mockResolvedValue(undefined);
    wire();
    fakeProcess.emit('close', 0, null);
    fakeProcess.emit('close', 0, null);
    fakeProcess.emit('close', 0, null);
    await flushMicrotasks();
    expect(authMocks.stopProxy).toHaveBeenCalledTimes(1);
  });

  it('removes all listeners after cleanup', async () => {
    authMocks.stopProxy.mockResolvedValue(undefined);
    wire();
    const beforeCount = fakeProcess.listenerCount('close');
    fakeProcess.emit('close', 0, null);
    await flushMicrotasks();
    expect(fakeProcess.listenerCount('close')).toBeLessThan(beforeCount);
  });

  it('runBridgeCleanup: sets idempotency, detaches listeners, clears stored cleanup, and re-surfaces the error when the cleanup callback throws', () => {
    authMocks.stopProxy.mockResolvedValue(undefined);
    const cleanupErr = new Error('bridge cleanup EIO');
    const cleanupFn = vi.fn(() => {
      throw cleanupErr;
    });
    let stored: (() => void) | undefined = cleanupFn;
    const setStored = vi.fn((c: (() => void) | undefined) => {
      stored = c;
    });
    wireCleanupHandlers(
      fakeProcess,
      undefined,
      {
        tunnelProcess: undefined,
        cleanup: undefined,
        entrypointPrefix: undefined,
      },
      undefined,
      cleanupFn,
      setStored,
    );
    const closeListenersBefore = fakeProcess.listenerCount('close');
    expect(() => fakeProcess.emit('close', 0, null)).toThrow(cleanupErr);
    // Idempotency: a second close emission must not call cleanup again.
    fakeProcess.emit('close', 0, null);
    expect(cleanupFn).toHaveBeenCalledTimes(1);
    // Listeners detached.
    expect(fakeProcess.listenerCount('close')).toBeLessThan(
      closeListenersBefore,
    );
    // Stored cleanup cleared.
    expect(setStored).toHaveBeenCalledWith(undefined);
    expect(stored).toBeUndefined();
  });
});
