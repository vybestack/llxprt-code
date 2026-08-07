/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3083 AC9 — `--jsp-bootstrap <path>` surfaces on parsed args as
 * `jspBootstrap`, and absence yields `undefined`. Also covers strict validation
 * of the public flag and the hidden internal env-path transport option.
 *
 * Bun-native (registered in scripts/bun-test-manifest.ts and excluded from the
 * Vitest selection in packages/cli/vitest.test-groups.ts). Drives the REAL
 * `parseArguments` by mutating `process.argv`, so the assertion exercises the
 * real yargs wiring and the real `mapParsedArgsToCliArgs` mapping rather than a
 * hand-rolled substitute.
 */

import { describe, it, expect, afterEach, vi } from 'bun:test';
import { parseArguments } from './cliArgParser.js';
import type { Settings } from './settings.js';

const ORIGINAL_ARGV = [...process.argv];
const ORIGINAL_ENV = { ...process.env };

function settings(): Settings {
  return {} as Settings;
}

async function parseArgv(
  args: readonly string[],
): ReturnType<typeof parseArguments> {
  process.argv = ['node', 'llxprt-code', ...args];
  return parseArguments(settings());
}

function restoreEnv(): void {
  // Restore the full original env snapshot so any JSP/SANDBOX vars mutated by
  // a test (including LLXPRT_SANDBOX and LLXPRT_JSP_BOOTSTRAP_FILE) are cleared.
  process.env = { ...ORIGINAL_ENV };
}

describe('parseArguments --jsp-bootstrap (AC9)', () => {
  afterEach(() => {
    process.argv = [...ORIGINAL_ARGV];
    restoreEnv();
  });

  it('surfaces --jsp-bootstrap <path> as argv.jspBootstrap', async () => {
    const argv = await parseArgv(['--jsp-bootstrap', '/tmp/bootstrap.json']);
    expect(argv.jspBootstrap).toBe('/tmp/bootstrap.json');
  });

  it('surfaces --jsp-bootstrap=<path> as argv.jspBootstrap', async () => {
    const argv = await parseArgv(['--jsp-bootstrap=/tmp/bootstrap.json']);
    expect(argv.jspBootstrap).toBe('/tmp/bootstrap.json');
  });

  it('yields undefined when --jsp-bootstrap is absent', async () => {
    const argv = await parseArgv([]);
    expect(argv.jspBootstrap).toBeUndefined();
  });
});

describe('parseArguments --sandbox false / --no-sandbox (AC2)', () => {
  afterEach(() => {
    process.argv = [...ORIGINAL_ARGV];
    restoreEnv();
  });

  it('parses --sandbox false as explicit boolean false', async () => {
    process.env.LLXPRT_SANDBOX = 'docker';
    const argv = await parseArgv(['--sandbox', 'false']);
    expect(argv.sandbox).toBe(false);
  });

  it('parses --no-sandbox as explicit boolean false', async () => {
    process.env.LLXPRT_SANDBOX = '1';
    const argv = await parseArgv(['--no-sandbox']);
    expect(argv.sandbox).toBe(false);
  });

  it('leaves sandbox undefined when neither flag nor env is present', async () => {
    delete process.env.LLXPRT_SANDBOX;
    const argv = await parseArgv([]);
    expect(argv.sandbox).toBeUndefined();
  });
});

describe('parseArguments --jsp-bootstrap-internal-env-path (transport)', () => {
  afterEach(() => {
    process.argv = [...ORIGINAL_ARGV];
    restoreEnv();
  });

  it('surfaces the hidden internal env-path option', async () => {
    const argv = await parseArgv([
      '--jsp-bootstrap-internal-env-path',
      '/tmp/boot.json',
    ]);
    expect(argv.jspBootstrapInternalEnvPath).toBe('/tmp/boot.json');
  });

  it('yields undefined for the option when absent', async () => {
    const argv = await parseArgv(['--jsp-bootstrap', '/tmp/boot.json']);
    expect(argv.jspBootstrapInternalEnvPath).toBeUndefined();
  });
});

/**
 * yargs calls process.exit(1) on .check() failures by default. The established
 * pattern (config.test.ts) mocks exit to throw so parseAsync rejects. This
 * helper wraps the try/catch to avoid await-thenable lint issues with
 * expect().rejects in bun:test type definitions.
 */
async function expectParseExit(args: readonly string[]): Promise<void> {
  try {
    await parseArgv(args);
    throw new Error('parseArgv should have triggered process.exit');
  } catch (error) {
    if ((error as Error).message !== 'process.exit called') {
      throw error;
    }
  }
}

let mockExit: ReturnType<typeof vi.spyOn>;
let mockConsoleError: ReturnType<typeof vi.spyOn>;

function mockProcessExitForYargsValidation(): void {
  mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
  mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
}

function restoreMocks(): void {
  process.argv = [...ORIGINAL_ARGV];
  restoreEnv();
  mockConsoleError?.mockRestore();
  mockExit?.mockRestore();
}

describe('strict validation: --jsp-bootstrap (Finding 4)', () => {
  afterEach(() => restoreMocks());

  it('rejects a bare --jsp-bootstrap with no value', async () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '/env/fallback.json';
    mockProcessExitForYargsValidation();
    await expectParseExit(['--sandbox', '--jsp-bootstrap']);
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('requires a non-empty value'),
    );
  });

  it('rejects a repeated --jsp-bootstrap', async () => {
    mockProcessExitForYargsValidation();
    await expectParseExit([
      '--jsp-bootstrap',
      '/first.json',
      '--jsp-bootstrap',
      '/second.json',
    ]);
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('can only be specified once'),
    );
  });

  it('does NOT silently fall back to env when the flag is malformed', async () => {
    process.env.LLXPRT_SANDBOX = 'true';
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '/env/fallback.json';
    mockProcessExitForYargsValidation();
    // A bare --jsp-bootstrap must error, not silently use the env fallback.
    await expectParseExit(['--sandbox', '--jsp-bootstrap']);
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('requires a non-empty value'),
    );
  });
});

describe('strict validation: --jsp-bootstrap-internal-env-path (Finding 4)', () => {
  afterEach(() => restoreMocks());

  it('rejects a bare --jsp-bootstrap-internal-env-path with no value', async () => {
    mockProcessExitForYargsValidation();
    await expectParseExit(['--jsp-bootstrap-internal-env-path']);
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('requires a non-empty value'),
    );
  });

  it('rejects a repeated --jsp-bootstrap-internal-env-path', async () => {
    mockProcessExitForYargsValidation();
    await expectParseExit([
      '--jsp-bootstrap-internal-env-path',
      '/first.json',
      '--jsp-bootstrap-internal-env-path',
      '/second.json',
    ]);
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('can only be specified once'),
    );
  });

  it('is accepted at root scope alongside a positional prompt (launch path)', async () => {
    // The hidden option is root-scoped so memory/sandbox hops into any command
    // accept it. This verifies the launch ($0) command path accepts and maps
    // it without breaking positional semantics.
    const argv = await parseArgv([
      '--jsp-bootstrap-internal-env-path',
      '/env/path.json',
      'hello',
    ]);
    expect(argv.jspBootstrapInternalEnvPath).toBe('/env/path.json');
    expect(argv.prompt).toBe('hello');
  });
});
