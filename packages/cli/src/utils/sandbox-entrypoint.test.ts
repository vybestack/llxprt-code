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

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { entrypoint } from './sandbox-entrypoint.js';
import {
  createHostOnlyCapabilityEnvFile,
  type HostOnlyCapabilityResult,
} from './sandbox-capability.js';
import {
  setupCredentialProxy,
  wireCleanupHandlers,
} from './sandbox-containers.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';

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
const NODE = process.execPath;
const BASH_CAP_REF = '${' + 'LLXPRT_CAPABILITY_TOKEN-}';

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

function runCmd(
  cmd: string[],
  env: NodeJS.ProcessEnv,
  options: { cwd?: string } = {},
): { stdout: string; stderr: string; exit: number } {
  const r = spawnSync(cmd[0], cmd.slice(1), {
    encoding: 'utf8',
    env,
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

/** Installs a PATH-discoverable recorder that reads fd 3 and writes a JSON report. */
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
      'const out = { tokenValid: /^[0-9a-f]{64}\\n$/.test(token), envToken: process.env.LLXPRT_CAPABILITY_TOKEN === undefined ? "UNSET" : "LEAKED", fdMarker: process.env.LLXPRT_CAPABILITY_FD };',
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

function recorderWorkingDirectory(
  overrides: NodeJS.ProcessEnv,
  tmpDir: string,
): { cwd?: string } {
  return overrides.BASH_ENV !== undefined ? {} : { cwd: tmpDir };
}

function restoreEnvironmentValue(
  key: string,
  originalValue: string | undefined,
): void {
  if (originalValue !== undefined) {
    process.env[key] = originalValue;
  } else {
    delete process.env[key];
  }
}

function aggregateErrorMessages(error: AggregateError): string[] {
  return error.errors.map((entry) =>
    entry instanceof Error ? entry.message : String(entry),
  );
}

function failFirstOpen(
  realOpenSync: typeof fs.openSync,
): (...args: Parameters<typeof fs.openSync>) => ReturnType<typeof fs.openSync> {
  let openCallCount = 0;
  return (...args) => {
    openCallCount++;
    if (openCallCount === 1) {
      throw new Error('simulated open failure');
    }
    return realOpenSync(...args);
  };
}

describe('sandbox-entrypoint: host-only capability env-file (AC1, F4)', () => {
  const getTmpDir = useTempDir(beforeEach, afterEach);
  let origToken: string | undefined;
  let origSocket: string | undefined;
  let origHome: string | undefined;
  let origUserProfile: string | undefined;

  beforeEach(() => {
    origToken = process.env.LLXPRT_CAPABILITY_TOKEN;
    origSocket = process.env.LLXPRT_CREDENTIAL_SOCKET;
    origHome = process.env.HOME;
    origUserProfile = process.env.USERPROFILE;
    process.env.LLXPRT_CAPABILITY_TOKEN = VALID_TOKEN;
  });

  afterEach(() => {
    if (origToken !== undefined)
      process.env.LLXPRT_CAPABILITY_TOKEN = origToken;
    else delete process.env.LLXPRT_CAPABILITY_TOKEN;
    if (origSocket !== undefined)
      process.env.LLXPRT_CREDENTIAL_SOCKET = origSocket;
    else delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    // #10: restore HOME correctly when it was originally undefined.
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
    if (origUserProfile !== undefined)
      process.env.USERPROFILE = origUserProfile;
    else delete process.env.USERPROFILE;
  });

  describe.skipIf(process.platform === 'win32')('POSIX behavior', () => {
    it('writes in a host-only dir under host HOME (outside mounts) with mode 0700 dir / 0600 file; raw token not in argv', () => {
      const result = createHostOnlyCapabilityEnvFile(
        VALID_TOKEN,
      ) as HostOnlyCapabilityResult;
      const hostDir = path.dirname(result.envFilePath);
      expect(hostDir.startsWith(os.homedir())).toBe(true);
      expect(result.envFilePath.startsWith(getTmpDir())).toBe(false);
      expect(fs.statSync(hostDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(result.envFilePath).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(result.envFilePath, 'utf8')).toContain(
        VALID_TOKEN,
      );
      for (const arg of result.args) expect(arg).not.toContain(VALID_TOKEN);
      expect(result.args[result.args.indexOf('--env-file') + 1]).toBe(
        result.envFilePath,
      );
    });
  });

  it('returns undefined when no capability token (tokenless path)', () => {
    expect(createHostOnlyCapabilityEnvFile(undefined)).toBeUndefined();
  });

  describe.skipIf(process.platform === 'win32')('POSIX behavior', () => {
    it('cleanup removes file+dir and is idempotent', () => {
      const result = createHostOnlyCapabilityEnvFile(
        VALID_TOKEN,
      ) as HostOnlyCapabilityResult;
      expect(fs.existsSync(result.envFilePath)).toBe(true);
      result.cleanup();
      expect(fs.existsSync(result.envFilePath)).toBe(false);
      expect(fs.existsSync(path.dirname(result.envFilePath))).toBe(false);
      expect(() => result.cleanup()).not.toThrow();
    });
  });

  describe.skipIf(process.platform === 'win32')('POSIX behavior', () => {
    it('a concurrent attacker cannot discover the host-only file via the mounted temp dir', () => {
      const result = createHostOnlyCapabilityEnvFile(
        VALID_TOKEN,
      ) as HostOnlyCapabilityResult;
      const mount = getTmpDir();
      const probe = spawnSync(
        NODE,
        [
          '-e',
          `
      const fs=require('node:fs'); let found=false;
      try{for(const e of fs.readdirSync(${JSON.stringify(mount)}))if(e.includes('capability')||e.includes('env'))found=true;}catch{}
      process.stdout.write(JSON.stringify({found}));
    `,
        ],
        { encoding: 'utf8' },
      );
      void result;
      expect(JSON.parse(probe.stdout.trim()).found).toBe(false);
    });
  });

  it('fail-fast: directory-creation failure surfaces', () => {
    const blockedHome = path.join(getTmpDir(), 'not-a-directory');
    fs.writeFileSync(blockedHome, 'file blocks child directory creation');
    process.env.HOME = blockedHome;
    process.env.USERPROFILE = blockedHome;
    // The code under test resolves the home directory with os.homedir(), which
    // honours process.env.HOME on Node but not on Bun. Spy on it directly so
    // the redirection works regardless of runtime.
    vi.spyOn(os, 'homedir').mockReturnValue(blockedHome);

    expect(() => createHostOnlyCapabilityEnvFile(VALID_TOKEN)).toThrow(
      /host-only directory/i,
    );
  });
});

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
    marker: string,
    binDir: string,
    prefixes?: string[],
  ): string[] {
    installRecorder(binDir, marker, 'llxprt');
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

  describe.skipIf(process.platform === 'win32')('POSIX behavior', () => {
    it('captures and unsets the token; passes it on fd 3 to the final CLI (PATH recorder)', () => {
      const tmpDir = getTmpDir();
      const binDir = path.join(tmpDir, 'bin');
      const marker = path.join(tmpDir, 'rec.json');
      const cmd = buildRecorderEntrypoint(tmpDir, marker, binDir);
      const result = runCmd(
        cmd,
        recorderEnv(binDir, { LLXPRT_CAPABILITY_TOKEN: VALID_TOKEN }),
      );
      expect(result.exit).toBe(0);
      const rec = readJson<{
        tokenValid: boolean;
        envToken: string;
        fdMarker: string;
      }>(marker);
      expect(rec.tokenValid).toBe(true);
      expect(rec.envToken).toBe('UNSET');
      expect(rec.fdMarker).toBe('3');
    });
  });

  describe.skipIf(process.platform === 'win32')('POSIX behavior', () => {
    it.each([
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
        const marker = path.join(tmpDir, 'rec.json');
        const stealerSentinel = path.join(tmpDir, 'stolen.json');
        const cmd = buildRecorderEntrypoint(tmpDir, marker, binDir);
        const overrides = setup(tmpDir, stealerSentinel);
        const result = runCmd(
          cmd,
          recorderEnv(binDir, {
            LLXPRT_CAPABILITY_TOKEN: VALID_TOKEN,
            ...overrides,
          }),
          recorderWorkingDirectory(overrides, tmpDir),
        );
        expect(result.exit).toBe(0);
        const rec = readJson<{ tokenValid: boolean; envToken: string }>(marker);
        expect(rec.tokenValid).toBe(true);
        expect(rec.envToken).toBe('UNSET');
        expect(fs.existsSync(stealerSentinel)).toBe(false);
      },
    );
  });

  describe.skipIf(process.platform === 'win32')('POSIX behavior', () => {
    it('F7: always unsets the env token even when fd 3 is pre-opened (su path)', () => {
      const tmpDir = getTmpDir();
      const binDir = path.join(tmpDir, 'bin');
      const marker = path.join(tmpDir, 'rec.json');
      const cmd = buildRecorderEntrypoint(tmpDir, marker, binDir);
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
      const rec = readJson<{ tokenValid: boolean; envToken: string }>(marker);
      expect(rec.tokenValid).toBe(true);
      expect(rec.envToken).toBe('UNSET');
    });
  });

  describe.skipIf(process.platform === 'win32')('POSIX behavior', () => {
    it('F7: tokenless path never sets the marker and never touches an unrelated pre-opened fd 3', () => {
      const tmpDir = getTmpDir();
      const binDir = path.join(tmpDir, 'bin');
      const marker = path.join(tmpDir, 'rec.json');
      const cmd = buildRecorderEntrypoint(tmpDir, marker, binDir);
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
      }>(marker);
      expect(rec.tokenValid).toBe(false);
      expect(rec.envToken).toBe('UNSET');
      expect(rec.fdMarker).toBeUndefined();
    });
  });

  describe.skipIf(process.platform === 'win32')('POSIX behavior', () => {
    it('F1: prefixes compose AFTER capability capture into the script body (not into the BASH_ENV argv element)', () => {
      const tmpDir = getTmpDir();
      const binDir = path.join(tmpDir, 'bin');
      const marker = path.join(tmpDir, 'rec.json');
      const prefixSentinel = path.join(tmpDir, 'prefix-env.json');
      const fakePrefix = `python3 - > ${JSON.stringify(prefixSentinel)} 2>/dev/null <<'LLXPRT_PREFIX_PROBE_EOF'\nimport os, json, sys\nout = {"tokenPresent": os.environ.get("LLXPRT_CAPABILITY_TOKEN") is not None}\nsys.stdout.write(json.dumps(out))\nLLXPRT_PREFIX_PROBE_EOF`;
      const cmd = buildRecorderEntrypoint(tmpDir, marker, binDir, [fakePrefix]);
      const result = runCmd(
        cmd,
        recorderEnv(binDir, { LLXPRT_CAPABILITY_TOKEN: VALID_TOKEN }),
      );
      expect(result.exit).toBe(0);
      expect(
        readJson<{ tokenPresent: boolean }>(prefixSentinel).tokenPresent,
      ).toBe(false);
      const rec = readJson<{ tokenValid: boolean; envToken: string }>(marker);
      expect(rec.tokenValid).toBe(true);
      expect(rec.envToken).toBe('UNSET');
    });
  });

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
      restoreEnvironmentValue('DEBUG', origDebug);
      restoreEnvironmentValue('DEBUG_PORT', origPort);
      restoreEnvironmentValue('NODE_ENV', origNodeEnv);
    }
  });

  describe.skipIf(process.platform === 'win32')('POSIX behavior', () => {
    it('O21: fails fast when marker 3 is set but fd 3 cannot be read (with/without token)', () => {
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
    });
  });
});

/**
 * AC10/AC12 hardening tests (issue #1954). Behavioral tests exercising the real
 * production code paths in sandbox-containers.ts with a mocked auth module and
 * a fake ChildProcess (EventEmitter-based stub).
 */
describe('setupCredentialProxy: fail-fast when socket path is undefined (AC12)', () => {
  const getTmpDir = useTempDir(beforeEach, afterEach);

  beforeEach(() => {
    vi.resetAllMocks();
    authMocks.createAndStartProxy.mockResolvedValue({ stop: vi.fn() });
    authMocks.stopProxy.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Shared invocation with the production signature. */
  function callSetupCredentialProxy(): Promise<unknown> {
    return setupCredentialProxy(
      [],
      { command: 'docker', image: 'test' },
      getTmpDir(),
      new Set<number>(),
      [],
    );
  }

  beforeEach(() => {
    authMocks.getProxySocketPath.mockReturnValue(undefined);
  });

  it('throws FatalSandboxError when getProxySocketPath returns undefined after createAndStartProxy succeeds', () =>
    expect(callSetupCredentialProxy()).rejects.toThrow(/socket path/i));

  it('attempts stopProxy when socket path is undefined', async () => {
    try {
      await callSetupCredentialProxy();
    } catch {
      /* expected */
    }
    expect(authMocks.stopProxy).toHaveBeenCalledTimes(1);
  });

  it('surfaces both invariant and stopProxy failures via AggregateError when socket path is undefined and stopProxy rejects', async () => {
    authMocks.stopProxy.mockRejectedValue(new Error('stopProxy failed'));
    // Captured explicitly rather than with rejects.toSatisfy, which hands the
    // pending promise to the predicate instead of the rejection value.
    let caught: unknown;
    try {
      await callSetupCredentialProxy();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    const messages = aggregateErrorMessages(caught as AggregateError);
    expect(messages.some((m) => /socket path/i.test(m))).toBe(true);
    expect(messages.some((m) => /stopProxy failed/i.test(m))).toBe(true);
  });

  it('does not silently return unprotected sandbox (args unchanged)', async () => {
    const args: string[] = [];
    await expect(
      setupCredentialProxy(
        args,
        { command: 'docker', image: 'test' },
        getTmpDir(),
        new Set<number>(),
        [],
      ),
    ).rejects.toThrow(/socket path/i);
    expect(args.some((a) => a.includes('LLXPRT_CREDENTIAL_SOCKET'))).toBe(
      false,
    );
    expect(args.some((a) => a.includes('--env-file'))).toBe(false);
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

describe('createHostOnlyDir: cleans up directory on setup failure (AC10)', () => {
  const getTmpDir = useTempDir(beforeEach, afterEach);
  let origHome: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    process.env.HOME = getTmpDir();
    vi.spyOn(os, 'homedir').mockReturnValue(getTmpDir());
  });

  afterEach(() => {
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
  });

  it('removes the created directory when open/fchmod/close fails after mkdir', () => {
    const realOpenSync = fs.openSync;
    const openSpy = vi
      .spyOn(fs, 'openSync')
      .mockImplementation(failFirstOpen(realOpenSync));
    try {
      expect(() => createHostOnlyCapabilityEnvFile(VALID_TOKEN)).toThrow(
        /host-only directory/i,
      );
      expect(
        fs
          .readdirSync(getTmpDir())
          .filter((e) => e.startsWith('.llxprt-code-cap-')),
      ).toHaveLength(0);
    } finally {
      openSpy.mockRestore();
    }
  });

  it('aggregates primary and cleanup failures when both fail', () => {
    const openSpy = vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw new Error('simulated open failure');
    });
    const rmdirSpy = vi.spyOn(fs, 'rmdirSync').mockImplementation(() => {
      throw new Error('simulated rmdir failure');
    });
    try {
      let thrown: unknown;
      try {
        createHostOnlyCapabilityEnvFile(VALID_TOKEN);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AggregateError);
      const messages = aggregateErrorMessages(thrown as AggregateError);
      expect(messages.some((m) => /open failure/i.test(m))).toBe(true);
      expect(messages.some((m) => /rmdir failure/i.test(m))).toBe(true);
    } finally {
      openSpy.mockRestore();
      rmdirSpy.mockRestore();
    }
  });
});
