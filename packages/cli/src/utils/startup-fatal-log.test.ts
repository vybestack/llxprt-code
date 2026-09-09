/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3566 behavioral coverage for the startup fatal log: durable JSONL
 * persistence of FatalError reports under <logHome>/fatal.log, argv credential
 * redaction, the saved-to path line, and the pre-exit pause. Filesystem
 * assertions use the real fs against isolated temp log homes; pause timing is
 * injected so no test sleeps for real. The end-to-end case spawns the real CLI
 * entry with LLXPRT_SANDBOX=bogus, which deterministically throws
 * FatalSandboxError ("Invalid sandbox command") from loadSandboxConfig during
 * bootstrap, before provider activation or network access.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FatalError, FatalSandboxError } from '@vybestack/llxprt-code-core';
import {
  appendStartupFatalLog,
  buildStartupFatalRecord,
  formatStartupFatalMessage,
  pauseBeforeExitIfNeeded,
  redactArgvForLog,
  resolveStartupFatalLogPath,
  shouldPauseBeforeExit,
  STARTUP_FATAL_PAUSE_MS,
  type StartupFatalRecord,
} from './startup-fatal-log.js';

const ORIGINAL_LOG_HOME = process.env.LLXPRT_LOG_HOME;
const tempRoots: string[] = [];

/**
 * Per-suite setup: points LLXPRT_LOG_HOME at a per-test temp dir that does
 * not exist yet (so appendStartupFatalLog must create it).
 */
function setupIsolatedLogHome(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'startup-fatal-'));
  tempRoots.push(root);
  const logHome = path.join(root, 'log-home');
  process.env.LLXPRT_LOG_HOME = logHome;
  return logHome;
}

/**
 * Per-suite teardown: removes every temp tree and restores the original env.
 * Env is restored first and each rmSync is individually guarded so one
 * unremovable root cannot skip the rest of the cleanup or leak the
 * LLXPRT_LOG_HOME override into later tests.
 */
function cleanupTempRootsAndRestoreEnv(): void {
  if (ORIGINAL_LOG_HOME === undefined) {
    delete process.env.LLXPRT_LOG_HOME;
  } else {
    process.env.LLXPRT_LOG_HOME = ORIGINAL_LOG_HOME;
  }
  for (const root of tempRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Keep removing the remaining roots; leaked temp dirs beat a poisoned
      // test environment.
    }
  }
}

function sampleRecord(message: string, exitCode: number): StartupFatalRecord {
  return {
    timestamp: '2026-09-08T12:00:00.000Z',
    cwd: '/tmp/project',
    argv: ['llxprt', '--sandbox'],
    exitCode,
    message,
  };
}

describe('resolveStartupFatalLogPath (AC1)', () => {
  let logHome = '';
  beforeEach(() => {
    logHome = setupIsolatedLogHome();
  });
  afterEach(cleanupTempRootsAndRestoreEnv);

  it('resolves fatal.log inside the isolated log home', () => {
    expect(resolveStartupFatalLogPath()).toBe(path.join(logHome, 'fatal.log'));
  });
});

describe('appendStartupFatalLog (AC1)', () => {
  let logHome = '';
  beforeEach(() => {
    logHome = setupIsolatedLogHome();
  });
  afterEach(cleanupTempRootsAndRestoreEnv);

  it('creates the missing log dir and file and writes one valid JSON line with all five fields', () => {
    expect(existsSync(logHome)).toBe(false);

    const result = appendStartupFatalLog(sampleRecord('sandbox boom', 44));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(
        'appendStartupFatalLog unexpectedly returned { ok: false }',
      );
    }
    expect(result.path).toBe(path.join(logHome, 'fatal.log'));
    const logPath = path.join(logHome, 'fatal.log');
    expect(existsSync(logPath)).toBe(true);
    const rawLines = readFileSync(logPath, 'utf8').split('\n');
    expect(rawLines).toHaveLength(2);
    expect(rawLines[1]).toBe('');
    const parsed: unknown = JSON.parse(rawLines[0]);
    if (!isFatalRecordShape(parsed)) {
      throw new Error(`fatal.log record shape mismatch: ${rawLines[0]}`);
    }
    expect(!isNaN(Date.parse(parsed.timestamp))).toBe(true);
    expect(parsed.cwd).toBe('/tmp/project');
    expect(parsed.argv).toStrictEqual(['llxprt', '--sandbox']);
    expect(parsed.exitCode).toBe(44);
    expect(parsed.message).toBe('sandbox boom');
  });

  it('accumulates a second fatal as an additional JSONL line', () => {
    appendStartupFatalLog(sampleRecord('first fatal', 44));
    appendStartupFatalLog(sampleRecord('second fatal', 52));

    const lines = readFileSync(path.join(logHome, 'fatal.log'), 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    expect(lines).toHaveLength(2);
    const first: unknown = JSON.parse(lines[0]);
    const second: unknown = JSON.parse(lines[1]);
    if (!isFatalRecordShape(first) || !isFatalRecordShape(second)) {
      throw new Error(`fatal.log record shape mismatch: ${lines.join(' | ')}`);
    }
    expect(first.message).toBe('first fatal');
    expect(second.message).toBe('second fatal');
    expect(second.exitCode).toBe(52);
  });

  // Root ignores directory mode bits, so the read-only setup cannot fail there.
  it.skipIf(process.getuid?.() === 0)(
    'returns { ok: false } and does not throw when the log home is unwritable',
    () => {
      const readOnlyParent = mkdtempSync(
        path.join(tmpdir(), 'startup-fatal-ro-'),
      );
      tempRoots.push(readOnlyParent);
      chmodSync(readOnlyParent, 0o500);
      process.env.LLXPRT_LOG_HOME = path.join(readOnlyParent, 'log-home');
      // A throw here fails the test; reaching the result assertion proves the
      // crash-reporting path tolerated the unwritable log home.
      const result = appendStartupFatalLog(sampleRecord('cannot write', 44));
      expect(result.ok).toBe(false);
    },
  );
});

describe('buildStartupFatalRecord (AC1)', () => {
  it('derives the record from the error and context with injectable clock', () => {
    const fixedDate = new Date('2026-09-08T00:00:00.000Z');
    const record = buildStartupFatalRecord(
      new FatalSandboxError("Invalid sandbox command 'bogus'"),
      {
        cwd: '/work/project',
        argv: ['bun', 'index.ts', '--key', 'SECRET', '--key=SECRET2'],
        now: () => fixedDate,
      },
    );
    expect(record.timestamp).toBe('2026-09-08T00:00:00.000Z');
    expect(record.cwd).toBe('/work/project');
    expect(record.argv).toStrictEqual([
      'bun',
      'index.ts',
      '--key',
      '[REDACTED]',
      '--key=[REDACTED]',
    ]);
    expect(record.exitCode).toBe(44);
    expect(record.message).toBe("Invalid sandbox command 'bogus'");
  });

  it('uses the real current time when now is not injected', () => {
    const before = new Date();
    const record = buildStartupFatalRecord(new FatalError('boom', 1), {
      cwd: '/cwd',
      argv: [],
    });
    const after = new Date();
    const parsedTime = Date.parse(record.timestamp);
    expect(parsedTime).toBeGreaterThanOrEqual(before.getTime());
    expect(parsedTime).toBeLessThanOrEqual(after.getTime());
  });
});

describe('redactArgvForLog (AC1)', () => {
  it('redacts the value after a --key token', () => {
    expect(
      redactArgvForLog(['llxprt', '--key', 'SECRET', '--sandbox']),
    ).toStrictEqual(['llxprt', '--key', '[REDACTED]', '--sandbox']);
  });

  it('redacts the value inside --key=<value>', () => {
    expect(redactArgvForLog(['llxprt', '--key=SECRET'])).toStrictEqual([
      'llxprt',
      '--key=[REDACTED]',
    ]);
  });

  it('passes non-key tokens through verbatim and leaves the input unmutated', () => {
    // -q (quiet alias) is not a value-taking flag, so its following token is
    // a positional, not a credential; -p/-i are covered by their own tests.
    const argv = ['llxprt', 'prompt-words', '-q', 'value', '--sandbox'];
    const redacted = redactArgvForLog(argv);
    expect(redacted).toStrictEqual(argv);
    expect(argv).toStrictEqual([
      'llxprt',
      'prompt-words',
      '-q',
      'value',
      '--sandbox',
    ]);
  });

  it('redacts the value after the -p prompt alias', () => {
    expect(redactArgvForLog(['llxprt', '-p', 'SECRET'])).toStrictEqual([
      'llxprt',
      '-p',
      '[REDACTED]',
    ]);
  });

  it('redacts the value after the -i prompt-interactive alias', () => {
    expect(redactArgvForLog(['llxprt', '-i', 'SECRET'])).toStrictEqual([
      'llxprt',
      '-i',
      '[REDACTED]',
    ]);
  });

  it('redacts the value inside -p=<value>', () => {
    expect(redactArgvForLog(['llxprt', '-p=SECRET'])).toStrictEqual([
      'llxprt',
      '-p=[REDACTED]',
    ]);
  });

  it('redacts the value inside -i=<value>', () => {
    expect(redactArgvForLog(['llxprt', '-i=SECRET'])).toStrictEqual([
      'llxprt',
      '-i=[REDACTED]',
    ]);
  });

  it('does not eat a following flag after the -p alias', () => {
    expect(redactArgvForLog(['llxprt', '-p', '--sandbox'])).toStrictEqual([
      'llxprt',
      '-p',
      '--sandbox',
    ]);
  });

  it('keeps a trailing bare flag verbatim', () => {
    expect(redactArgvForLog(['llxprt', '--sandbox'])).toStrictEqual([
      'llxprt',
      '--sandbox',
    ]);
  });

  it('treats a bare flag followed by another flag as consecutive flags, not a value', () => {
    expect(
      redactArgvForLog(['bun', 'index.ts', '--sandbox', '--prompt', 'x']),
    ).toStrictEqual(['bun', 'index.ts', '--sandbox', '--prompt', '[REDACTED]']);
  });

  it('keeps --prompt verbatim after --no-pause and redacts only its value', () => {
    expect(
      redactArgvForLog(['llxprt', '--no-pause', '--prompt', 'hi']),
    ).toStrictEqual(['llxprt', '--no-pause', '--prompt', '[REDACTED]']);
  });
});

describe('formatStartupFatalMessage (AC2)', () => {
  it('appends the saved-to path line to the message with no trailing newline', () => {
    expect(formatStartupFatalMessage('fatal boom', '/logs/fatal.log')).toBe(
      'fatal boom\nFull error details saved to: /logs/fatal.log',
    );
  });
});

describe('shouldPauseBeforeExit (AC3)', () => {
  it('pauses on a TTY without --no-pause', () => {
    expect(shouldPauseBeforeExit(['llxprt'], true)).toBe(true);
  });

  it('does not pause on a TTY with --no-pause', () => {
    expect(shouldPauseBeforeExit(['llxprt', '--no-pause'], true)).toBe(false);
  });

  it('does not pause off-TTY', () => {
    expect(shouldPauseBeforeExit(['llxprt'], false)).toBe(false);
  });

  it('does not pause off-TTY with --no-pause', () => {
    expect(shouldPauseBeforeExit(['llxprt', '--no-pause'], false)).toBe(false);
  });
});

describe('pauseBeforeExitIfNeeded (AC3)', () => {
  interface SleepSpy {
    calls: number[];
    sleep: (ms: number) => Promise<void>;
  }

  function makeSleepSpy(): SleepSpy {
    const calls: number[] = [];
    return {
      calls,
      sleep: (ms: number): Promise<void> => {
        calls.push(ms);
        return Promise.resolve();
      },
    };
  }

  it('awaits the injected sleep and writes a notice mentioning --no-pause on the TTY path', async () => {
    const spy = makeSleepSpy();
    const notices: string[] = [];
    await pauseBeforeExitIfNeeded(['llxprt'], true, {
      pauseMs: 25,
      sleep: spy.sleep,
      writeNotice: (line) => notices.push(line),
    });
    expect(spy.calls).toStrictEqual([25]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('--no-pause');
  });

  it('defaults to the exported pause interval when none is injected', async () => {
    const spy = makeSleepSpy();
    await pauseBeforeExitIfNeeded(['llxprt'], true, {
      sleep: spy.sleep,
      writeNotice: () => {},
    });
    expect(spy.calls).toStrictEqual([STARTUP_FATAL_PAUSE_MS]);
  });

  it('never calls sleep or writeNotice off-TTY', async () => {
    const spy = makeSleepSpy();
    const notices: string[] = [];
    await pauseBeforeExitIfNeeded(['llxprt'], false, {
      pauseMs: 25,
      sleep: spy.sleep,
      writeNotice: (line) => notices.push(line),
    });
    expect(spy.calls).toStrictEqual([]);
    expect(notices).toStrictEqual([]);
  });

  it('never calls sleep or writeNotice when --no-pause is present', async () => {
    const spy = makeSleepSpy();
    const notices: string[] = [];
    await pauseBeforeExitIfNeeded(['llxprt', '--no-pause'], true, {
      pauseMs: 25,
      sleep: spy.sleep,
      writeNotice: (line) => notices.push(line),
    });
    expect(spy.calls).toStrictEqual([]);
    expect(notices).toStrictEqual([]);
  });

  it('swallows a rejecting sleep instead of failing the crash path', async () => {
    const notices: string[] = [];
    await pauseBeforeExitIfNeeded(['llxprt'], true, {
      pauseMs: 1,
      sleep: () => Promise.reject(new Error('sleep broke')),
      writeNotice: (line) => notices.push(line),
    });
    // The notice proves the function ran its full body and resolved.
    expect(notices).toHaveLength(1);
  });

  it('routes the default notice through core writeToStderr when no writer is injected', async () => {
    // writeToStderr deliberately bypasses monkey-patched process.stderr.write
    // (crash-path output must survive UI stdio redirection), so a property spy
    // cannot observe it; the default path is asserted at the writeToStderr
    // seam instead, and the module mock is restored on every exit path.
    const realCore = await import('@vybestack/llxprt-code-core');
    const notices: string[] = [];
    void mock.module('@vybestack/llxprt-code-core', () => ({
      ...realCore,
      writeToStderr: (chunk: string): boolean => {
        notices.push(chunk);
        return true;
      },
    }));
    try {
      await pauseBeforeExitIfNeeded(['llxprt'], true, {
        pauseMs: 1,
        sleep: (): Promise<void> => Promise.resolve(),
      });
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('--no-pause');
    } finally {
      void mock.module('@vybestack/llxprt-code-core', () => realCore);
    }
  });
});

/**
 * Minimal runtime shape of a `Bun.spawn` subprocess, restricted to the members
 * this test reads. Defined locally because the CLI TypeScript config loads
 * `bun-types/test` but NOT the global `Bun` namespace, so the bare
 * `Bun.spawn` symbol is unavailable to the type-checker. Reached through
 * `globalThis` — the same approach as jspBootstrapStartup.test.ts.
 */
interface BunSubprocessLike {
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
}

type BunSpawnFn = (
  cmds: string[],
  options: {
    cwd?: string;
    stdout?: 'ignore' | 'pipe' | 'inherit';
    stderr?: 'ignore' | 'pipe' | 'inherit';
    env?: Record<string, string | undefined>;
  },
) => BunSubprocessLike;

function getBunSpawn(): BunSpawnFn {
  const bun = (globalThis as { Bun?: { spawn?: unknown } }).Bun;
  if (bun === undefined || typeof bun.spawn !== 'function') {
    throw new Error(
      'Bun.spawn is unavailable; startup-fatal-log e2e tests must run under bun:test',
    );
  }
  return bun.spawn as unknown as BunSpawnFn;
}

function isFatalRecordShape(value: unknown): value is StartupFatalRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const timestamp = Reflect.get(value, 'timestamp');
  if (typeof timestamp !== 'string') {
    return false;
  }
  const cwd = Reflect.get(value, 'cwd');
  if (typeof cwd !== 'string') {
    return false;
  }
  const argv = Reflect.get(value, 'argv');
  if (!Array.isArray(argv) || !argv.every((t) => typeof t === 'string')) {
    return false;
  }
  const exitCode = Reflect.get(value, 'exitCode');
  if (typeof exitCode !== 'number') {
    return false;
  }
  const message = Reflect.get(value, 'message');
  return typeof message === 'string';
}

describe('end-to-end: CLI entry persists startup fatals (AC1/AC2/AC5)', () => {
  let logHome = '';
  beforeEach(() => {
    logHome = setupIsolatedLogHome();
  });
  afterEach(cleanupTempRootsAndRestoreEnv);

  it('writes fatal.log and prints the saved-to path when LLXPRT_SANDBOX is invalid', async () => {
    const bunSpawn = getBunSpawn();
    const entryPath = path.join(import.meta.dir, '..', '..', 'index.ts');
    const childCwd = mkdtempSync(path.join(tmpdir(), 'startup-fatal-e2e-'));
    tempRoots.push(childCwd);
    const configHome = mkdtempSync(path.join(tmpdir(), 'startup-fatal-cfg-'));
    tempRoots.push(configHome);
    const dataHome = mkdtempSync(path.join(tmpdir(), 'startup-fatal-data-'));
    tempRoots.push(dataHome);
    const cacheHome = mkdtempSync(path.join(tmpdir(), 'startup-fatal-cache-'));
    tempRoots.push(cacheHome);

    const env: Record<string, string | undefined> = { ...process.env };
    delete env['SANDBOX'];
    env['LLXPRT_SANDBOX'] = 'bogus';
    env['LLXPRT_LOG_HOME'] = logHome;
    env['LLXPRT_CONFIG_HOME'] = configHome;
    env['LLXPRT_DATA_HOME'] = dataHome;
    env['LLXPRT_CACHE_HOME'] = cacheHome;

    const proc = bunSpawn([process.execPath, entryPath, '--prompt', 'x'], {
      cwd: childCwd,
      stdout: 'ignore',
      stderr: 'pipe',
      env,
    });
    if (proc.stderr === null) {
      throw new Error('stderr pipe unavailable for e2e child');
    }
    const stderrText = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    const logPath = path.join(logHome, 'fatal.log');
    const rawLog = existsSync(logPath)
      ? readFileSync(logPath, 'utf8')
      : '<fatal.log missing>';
    if (exitCode !== 44) {
      throw new Error(
        `expected exit 44, got ${exitCode}; stderr:\n${stderrText}\nfatal.log:\n${rawLog}`,
      );
    }
    expect(existsSync(logPath)).toBe(true);
    const lines = rawLog.split('\n').filter((line) => line !== '');
    expect(lines).toHaveLength(1);
    const parsed: unknown = JSON.parse(lines[0]);
    if (!isFatalRecordShape(parsed)) {
      throw new Error(`fatal.log record shape mismatch: ${lines[0]}`);
    }
    expect(parsed.message).toContain('Invalid sandbox command');
    expect(parsed.argv).toContain('--prompt');
    // The prompt value follows a --key token, so it must be redacted.
    expect(parsed.argv[parsed.argv.indexOf('--prompt') + 1]).toBe('[REDACTED]');
    expect(parsed.cwd).toBe(childCwd);
    expect(parsed.exitCode).toBe(44);
    expect(!isNaN(Date.parse(parsed.timestamp))).toBe(true);
    expect(stderrText).toContain('Invalid sandbox command');
    expect(stderrText).toContain('fatal.log');
  }, 60_000);
});
