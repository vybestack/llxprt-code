/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3566 AC4 — `--no-pause` must parse without an unknown-argument
 * failure in both the root scope and the launch-command scope (yargs strict
 * mode exits on unrecognized options). Drives the REAL `parseArguments` by
 * mutating `process.argv`, so the assertions exercise the real yargs wiring
 * and both option tables. `process.exit` is mocked to throw for the duration
 * of each parse so a validation exit fails the test loudly instead of killing
 * the runner.
 */

import { describe, it, expect, afterEach, vi } from 'bun:test';
import { parseArguments } from './cliArgParser.js';
import { innerCommandOptions, rootOptions } from './yargsOptions.js';
import type { Settings } from './settings.js';

const ORIGINAL_ARGV = [...process.argv];
const ORIGINAL_ENV = { ...process.env };

function emptySettings(): Settings {
  return {};
}

async function parseArgv(
  args: readonly string[],
): ReturnType<typeof parseArguments> {
  process.argv = ['node', 'llxprt-code', ...args];
  return parseArguments(emptySettings());
}

let mockExit: ReturnType<typeof vi.spyOn> | undefined;
let mockConsoleError: ReturnType<typeof vi.spyOn> | undefined;

function mockProcessExitForYargsValidation(): void {
  mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
  mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('parseArguments --no-pause acceptance (AC4)', () => {
  afterEach(() => {
    process.argv = [...ORIGINAL_ARGV];
    process.env = { ...ORIGINAL_ENV };
    mockConsoleError?.mockRestore();
    mockExit?.mockRestore();
    mockExit = undefined;
    mockConsoleError = undefined;
  });

  it('accepts --no-pause at root scope without a yargs validation exit', async () => {
    mockProcessExitForYargsValidation();
    const argv = await parseArgv(['--no-pause']);
    expect(argv.promptWords ?? []).toStrictEqual([]);
  });

  it('accepts --no-pause alongside the launch-command --sandbox flag', async () => {
    mockProcessExitForYargsValidation();
    const argv = await parseArgv(['--sandbox', '--no-pause']);
    expect(argv.sandbox).toBe(true);
  });
});

describe('pause option registration (AC4)', () => {
  afterEach(() => {
    process.argv = [...ORIGINAL_ARGV];
    process.env = { ...ORIGINAL_ENV };
    mockConsoleError?.mockRestore();
    mockExit?.mockRestore();
    mockExit = undefined;
    mockConsoleError = undefined;
  });

  it('registers a boolean pause option in rootOptions (help documents it)', () => {
    expect(Object.hasOwn(rootOptions, 'pause')).toBe(true);
    expect(rootOptions['pause'].type).toBe('boolean');
    expect(
      typeof rootOptions['pause'].description === 'string' &&
        rootOptions['pause'].description.length > 0,
    ).toBe(true);
  });

  it('registers a boolean pause option in innerCommandOptions (help documents it)', () => {
    expect(Object.hasOwn(innerCommandOptions, 'pause')).toBe(true);
    expect(innerCommandOptions['pause'].type).toBe('boolean');
    expect(
      typeof innerCommandOptions['pause'].description === 'string' &&
        innerCommandOptions['pause'].description.length > 0,
    ).toBe(true);
  });
});
