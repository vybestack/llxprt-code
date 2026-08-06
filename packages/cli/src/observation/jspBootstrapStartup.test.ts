/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3083 behavioral coverage for the early JSP bootstrap capture,
 * memory/sandbox argv transport, and startup ordering.
 *
 * Bun-native (registered in scripts/bun-test-manifest.ts and excluded from the
 * Vitest selection in packages/cli/vitest.test-groups.ts). These tests exercise
 * the REAL `captureBootstrapEnvPath`, `resolveBootstrapSelection`,
 * `augmentArgvWithInternalEnvPath`, `loadBootstrap`, `parseArguments`, and
 * `setupObservation` functions with real `process.env`, real child processes,
 * and real loopback HTTP — no mocks of internal implementation details.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  captureBootstrapEnvPath,
  resolveBootstrapSelection,
  augmentArgvWithInternalEnvPath,
  stopObservationProducer,
} from './jspWiring.js';
import { parseArguments } from '../config/cliArgParser.js';
import type { Settings } from '../config/settings.js';
import { setupObservation } from '../cliSessionBootstrap.js';
import type { Config } from '@vybestack/llxprt-code-core';

const validBootstrapJson = {
  schema: 1,
  protocol: 'jsp/1',
  endpoint: 'http://127.0.0.1:9123/jsp/1',
  registration_id: 'reg-abc',
  publisher_credential: 'pub-secret-xyz',
  agent_id: 'agent-alex',
  lifecycle_generation: 7,
};

const tempDirs: string[] = [];
const ORIGINAL_ARGV = [...process.argv];

async function writeTempFile(name: string, content: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `jsp-startup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const filePath = join(dir, name);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

async function cleanupTempDirs(): Promise<void> {
  const dirs = tempDirs.splice(0);
  await Promise.allSettled(
    dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
}

/**
 * Minimal runtime shape of a `Bun.spawn` subprocess, restricted to the members
 * these tests read. Defined locally because the CLI TypeScript config loads
 * `bun-types/test` (the `bun:test` module) but NOT the global `Bun` namespace,
 * so the bare global `Bun.spawn`/`Bun.Subprocess` symbols are unavailable to
 * the type-checker. We reach the real, runtime `Bun.spawn` through
 * `globalThis` — the same approach used by `core/src/services/shellJobSpawn.ts`.
 * This preserves real child-process behavior and avoids `node:child_process`,
 * whose module mocking contaminates the combined test run.
 */
interface BunSubprocessLike {
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
}

type BunSpawnFn = (
  cmds: string[],
  options: {
    stdout?: 'ignore' | 'pipe' | 'inherit';
    stderr?: 'ignore' | 'pipe' | 'inherit';
    env?: Record<string, string | undefined>;
  },
) => BunSubprocessLike;

function getBunSpawn(): BunSpawnFn {
  const bun = (globalThis as { Bun?: { spawn?: unknown } }).Bun;
  if (bun === undefined || typeof bun.spawn !== 'function') {
    throw new Error(
      'Bun.spawn is unavailable; jspBootstrapStartup tests must run under bun:test',
    );
  }
  return bun.spawn as unknown as BunSpawnFn;
}

const bunSpawn = getBunSpawn();

function emptySettings(): Settings {
  return {} as Settings;
}

/**
 * Spawn a child process that runs a Bun/TS fixture and capture its stdout.
 *
 * Uses a dynamic import of `node:child_process` AFTER the test file's top-
 * level imports have been resolved. This avoids the process-wide vi.mock
 * from `relaunch.test.ts` (which replaces `spawn`/`spawnSync`/`execSync`/
 * `execFileSync` with automock stubs) because Bun's `mock.module` only patches
 * the module registry for imports that resolve AFTER the mock is registered.
 * A deferred `import('node:child_process')` inside the function body still
 * gets the mocked module, so instead we use `Bun.spawn` directly (Bun's
 * built-in subprocess API that is NOT part of `node:child_process`).
 */
async function runChildCaptureOutput(fixturePath: string): Promise<string> {
  const proc = bunSpawn([process.execPath, fixturePath], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout;
}

/**
 * Spawn a child process that runs a Bun/TS fixture and wait for exit.
 */
async function runChildAndWait(fixturePath: string): Promise<number> {
  const proc = bunSpawn([process.execPath, fixturePath], {
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...process.env },
  });
  return proc.exited;
}

/**
 * Spawn a REAL child process that inherits process.env and reports whether
 * LLXPRT_JSP_BOOTSTRAP_FILE is present. Returns true when the child sees the
 * variable (the failure case), false when it is absent (the required case).
 *
 * Uses a Bun/TS fixture file (written to a temp dir) rather than `bun -e`
 * because Bun consumes unknown `--flag` tokens from `-e` argv and would fail
 * to parse the reporting script reliably.
 */
async function childInheritsBootstrapVar(): Promise<boolean> {
  const fixturePath = await writeTempFile(
    'inherit-check.ts',
    `process.stdout.write(process.env.LLXPRT_JSP_BOOTSTRAP_FILE === undefined ? 'absent' : 'present')`,
  );
  const stdout = await runChildCaptureOutput(fixturePath);
  return stdout.trim() === 'present';
}

describe('captureBootstrapEnvPath — process-start capture and scrub (AC13)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LLXPRT_JSP_BOOTSTRAP_FILE;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns the path and scrubs the variable for a non-empty value', () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '/session/per-process.json';
    const captured = captureBootstrapEnvPath();
    expect(captured).toBe('/session/per-process.json');
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });

  it('returns undefined and still scrubs for an empty value', () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '';
    const captured = captureBootstrapEnvPath();
    expect(captured).toBeUndefined();
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });

  it('returns undefined and scrubs (no-op) when absent', () => {
    const captured = captureBootstrapEnvPath();
    expect(captured).toBeUndefined();
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });

  it('a child spawned AFTER capture does NOT inherit the variable', async () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '/session/per-process.json';
    expect(await childInheritsBootstrapVar()).toBe(true);

    captureBootstrapEnvPath();

    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
    expect(await childInheritsBootstrapVar()).toBe(false);
  });
});

describe('resolveBootstrapSelection — post-parse resolution (AC10–AC12)', () => {
  it('flag wins over internal and captured env paths (AC10)', () => {
    const sel = resolveBootstrapSelection(
      '/flag/path.json',
      '/transported.json',
      '/captured.json',
    );
    expect(sel?.path).toBe('/flag/path.json');
    expect(sel?.source).toBe('--jsp-bootstrap');
  });

  it('internal env path wins over captured env path', () => {
    const sel = resolveBootstrapSelection(
      undefined,
      '/transported.json',
      '/captured.json',
    );
    expect(sel?.path).toBe('/transported.json');
    expect(sel?.source).toBe('LLXPRT_JSP_BOOTSTRAP_FILE');
  });

  it('captured env path used when flag and internal absent (AC11)', () => {
    const sel = resolveBootstrapSelection(
      undefined,
      undefined,
      '/captured.json',
    );
    expect(sel?.path).toBe('/captured.json');
    expect(sel?.source).toBe('LLXPRT_JSP_BOOTSTRAP_FILE');
  });

  it('returns null when all three absent (AC12)', () => {
    expect(
      resolveBootstrapSelection(undefined, undefined, undefined),
    ).toBeNull();
  });

  it('empty strings are treated as absent', () => {
    expect(resolveBootstrapSelection('', '', '')).toBeNull();
  });

  it('flag with only internal present uses internal (flag empty)', () => {
    const sel = resolveBootstrapSelection('', '/transported.json', undefined);
    expect(sel?.path).toBe('/transported.json');
    expect(sel?.source).toBe('LLXPRT_JSP_BOOTSTRAP_FILE');
  });
});

describe('augmentArgvWithInternalEnvPath — argv transport (Findings 2 & 3)', () => {
  it('inserts hidden option before a -- terminator', () => {
    const result = augmentArgvWithInternalEnvPath(
      ['cli.js', 'positional', '--', '--sandbox'],
      '/env/path.json',
    );
    const idx = result.indexOf('--jsp-bootstrap-internal-env-path');
    expect(idx).toBeGreaterThan(-1);
    expect(result[idx + 1]).toBe('/env/path.json');
    // The hidden option is BEFORE the terminator so yargs sees it as a flag.
    const terminatorIdx = result.indexOf('--');
    expect(terminatorIdx).toBeGreaterThan(idx);
    // All original elements preserved.
    expect(result).toContain('cli.js');
    expect(result).toContain('positional');
    expect(result).toContain('--sandbox');
  });

  it('appends hidden option when no -- terminator', () => {
    const result = augmentArgvWithInternalEnvPath(
      ['cli.js', '--prompt', 'hello'],
      '/env/path.json',
    );
    expect(result).toContain('--jsp-bootstrap-internal-env-path');
    expect(result).toContain('/env/path.json');
    expect(result).toContain('--prompt');
    expect(result).toContain('hello');
  });

  it('does not duplicate transport when already present (prior hop)', () => {
    const argv = [
      'cli.js',
      '--jsp-bootstrap-internal-env-path',
      '/first.json',
      '--prompt',
      'hi',
    ];
    const result = augmentArgvWithInternalEnvPath(argv, '/second.json');
    expect(
      result.filter((a) => a === '--jsp-bootstrap-internal-env-path'),
    ).toHaveLength(1);
    expect(result).toContain('/first.json');
    expect(result).not.toContain('/second.json');
  });

  it('undefined envPath returns argv unchanged', () => {
    const argv = ['cli.js', '--prompt', 'hello'];
    expect(augmentArgvWithInternalEnvPath(argv, undefined)).toEqual(argv);
  });

  it('normal positional prompt round-trips through parser with transport', async () => {
    try {
      process.argv = augmentArgvWithInternalEnvPath(
        ['node', 'cli.js', 'do something'],
        '/env/path.json',
      );
      const parsed = await parseArguments(emptySettings());
      expect(parsed.prompt).toBe('do something');
      expect(parsed.jspBootstrapInternalEnvPath).toBe('/env/path.json');
    } finally {
      process.argv = [...ORIGINAL_ARGV];
    }
  });

  it('-- terminator round-trips: transport stays before terminator', async () => {
    try {
      process.argv = augmentArgvWithInternalEnvPath(
        ['node', 'cli.js', '--', 'literal-positional'],
        '/env/path.json',
      );
      const parsed = await parseArguments(emptySettings());
      // The hidden option is parsed as a root flag, not a positional after --.
      expect(parsed.jspBootstrapInternalEnvPath).toBe('/env/path.json');
    } finally {
      process.argv = [...ORIGINAL_ARGV];
    }
  });
});

describe('real memory relaunch child — no env, transported path in argv', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LLXPRT_JSP_BOOTSTRAP_FILE;
  });

  afterEach(async () => {
    process.env = { ...origEnv };
    await cleanupTempDirs();
  });

  it('child does NOT receive LLXPRT_JSP_BOOTSTRAP_FILE and DOES receive the path in argv', async () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '/session/per-process.json';
    const capturedEnvPath = captureBootstrapEnvPath();
    expect(capturedEnvPath).toBe('/session/per-process.json');
    // Env is already scrubbed before the relaunch.
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();

    // A Bun/TS fixture that reports its env/argv state to a file. We spawn it
    // with Bun.spawn (not relaunchAppInChildProcess, which uses
    // node:child_process spawn — that gets mocked by relaunch.test.ts in a
    // combined run). The fixture writes a JSON report to disk.
    const reportPath = join(
      tmpdir(),
      `jsp-relaunch-report-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    tempDirs.push(reportPath);
    const fixturePath = await writeTempFile(
      'report.ts',
      `import { writeFileSync } from 'node:fs';
const argv = process.argv;
const envPresent = process.env.LLXPRT_JSP_BOOTSTRAP_FILE !== undefined;
const idx = argv.indexOf('--jsp-bootstrap-internal-env-path');
const internalPath = idx >= 0 ? argv[idx + 1] : null;
writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({ envPresent, internalPath }));
process.exit(0);
`,
    );

    // Simulate the memory-relaunch argv augmentation: the env-origin path is
    // transported via the hidden internal option, NOT via the environment.
    const argvTail = augmentArgvWithInternalEnvPath(
      [fixturePath],
      capturedEnvPath,
    );
    const proc = bunSpawn([process.execPath, ...argvTail], {
      stdout: 'ignore',
      stderr: 'ignore',
      env: { ...process.env },
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    expect(report.envPresent).toBe(false);
    expect(report.internalPath).toBe('/session/per-process.json');
  });
});

describe('real CLI/MCP child — no env inheritance after capture (AC13)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LLXPRT_JSP_BOOTSTRAP_FILE;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('a real child spawned with inherited env does NOT see the variable after capture', async () => {
    // This simulates the MCP stdio transport pattern: the CLI spawns an MCP
    // server child that inherits process.env via { env: { ...process.env } }.
    // After process-start capture, that child must NOT inherit the variable.
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '/session/identity.json';
    captureBootstrapEnvPath();

    const fixturePath = await writeTempFile(
      'mcp-inherit-check.ts',
      `process.stdout.write(process.env.LLXPRT_JSP_BOOTSTRAP_FILE === undefined ? 'absent' : 'present')`,
    );
    const output = await runChildCaptureOutput(fixturePath);
    expect(output.trim()).toBe('absent');
  });

  it('a real CLI child invocation with temp config/home reports no inheritance', async () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '/session/identity.json';
    captureBootstrapEnvPath();

    // Run a real child that mirrors how an MCP stdio helper would inspect its
    // own environment: it writes its env/argv state to a file and exits.
    const reportPath = join(
      tmpdir(),
      `jsp-mcp-report-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    tempDirs.push(reportPath);
    const fixturePath = await writeTempFile(
      'mcp-report.ts',
      `import { writeFileSync } from 'node:fs';
writeFileSync(
  ${JSON.stringify(reportPath)},
  JSON.stringify({
    envPresent: process.env.LLXPRT_JSP_BOOTSTRAP_FILE !== undefined,
  }),
);
process.exit(0);
`,
    );
    await runChildAndWait(fixturePath);
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    expect(report.envPresent).toBe(false);
  });
});

describe('startup ordering — capture at first line of main()', () => {
  // Source-inspection regression: captureBootstrapEnvPath must be the FIRST
  // executable call in main(), before configureEarlyDebugLogging,
  // handleVersionAndHelpFlags, maybeRelaunchForMemory, and parseArguments.
  const cliSource = readFileSync(
    fileURLToPath(new URL('../cli.tsx', import.meta.url)),
    'utf8',
  );
  const mainStart = cliSource.indexOf('export async function main()');
  const mainBody = cliSource.slice(mainStart);

  it('cli.tsx calls captureBootstrapEnvPath', () => {
    expect(cliSource).toContain('captureBootstrapEnvPath');
  });

  it('captureBootstrapEnvPath is the first call in main() before configureEarlyDebugLogging', () => {
    const captureIdx = mainBody.indexOf('captureBootstrapEnvPath()');
    const debugIdx = mainBody.indexOf('configureEarlyDebugLogging()');
    expect(captureIdx).toBeGreaterThan(-1);
    expect(debugIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeLessThan(debugIdx);
  });

  it('captureBootstrapEnvPath is before handleVersionAndHelpFlags', () => {
    const captureIdx = mainBody.indexOf('captureBootstrapEnvPath()');
    const helpIdx = mainBody.indexOf('handleVersionAndHelpFlags(');
    expect(captureIdx).toBeLessThan(helpIdx);
  });

  it('captureBootstrapEnvPath is before maybeRelaunchForMemory', () => {
    const captureIdx = mainBody.indexOf('captureBootstrapEnvPath()');
    const relaunchIdx = mainBody.indexOf('maybeRelaunchForMemory(');
    expect(captureIdx).toBeLessThan(relaunchIdx);
  });

  it('captureBootstrapEnvPath is before parseArguments', () => {
    const captureIdx = mainBody.indexOf('captureBootstrapEnvPath()');
    const parseIdx = mainBody.indexOf('parseArguments(');
    expect(captureIdx).toBeLessThan(parseIdx);
  });

  it('preparePostParseStartup uses resolveBootstrapSelection', () => {
    expect(cliSource).toContain('resolveBootstrapSelection');
  });
});

describe('setupObservation seam — cliSessionBootstrap → observation wiring (AC15)', () => {
  let captureServer: http.Server | null = null;
  let losingTimeout: ReturnType<typeof setTimeout> | null = null;

  afterEach(async () => {
    await stopObservationProducer();
    if (losingTimeout !== null) {
      clearTimeout(losingTimeout);
      losingTimeout = null;
    }
    await new Promise<void>((resolve) => {
      if (captureServer === null) {
        resolve();
        return;
      }
      captureServer.close(() => resolve());
      captureServer = null;
    });
    await cleanupTempDirs();
  });

  it('drives setupObservation → initializeObservationProducer with a real producer (real HTTP)', async () => {
    let resolveRequest!: (req: http.IncomingMessage) => void;
    const firstRequest = new Promise<http.IncomingMessage>((resolve) => {
      resolveRequest = resolve;
    });
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      resolveRequest(req);
    });
    captureServer = server;
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;

    const file = await writeTempFile(
      'ac15.json',
      JSON.stringify({
        ...validBootstrapJson,
        endpoint: `http://127.0.0.1:${port}`,
      }),
    );

    const configStub = {
      getProjectRoot: () => '/test-project',
    } as unknown as Config;
    const selection = resolveBootstrapSelection(file, undefined, undefined);
    setupObservation(configStub, selection);

    const timeoutPromise = new Promise<never>((_, reject) => {
      losingTimeout = setTimeout(
        () => reject(new Error('registration POST did not arrive')),
        5_000,
      );
    });
    const received = await Promise.race([firstRequest, timeoutPromise]);
    expect(received.method).toBe('POST');
    expect(received.url).toContain('/register');
  });
});
