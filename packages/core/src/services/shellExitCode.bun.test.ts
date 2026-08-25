/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ShellExecutionConfig,
  ShellExecutionResult,
} from './shellExecutionService.js';
import { ShellExecutionService } from './shellExecutionService.js';
import { getShellConfiguration } from '../utils/shell-utils.js';
import { ensureNativeExitCodePropagated } from './shellOutputUtils.js';

describe('ensureNativeExitCodePropagated', () => {
  it('wraps a powershell command with the exit-code ladder on its own lines', () => {
    expect(ensureNativeExitCodePropagated('node -v', 'powershell')).toBe(
      '$global:LASTEXITCODE = 0;\n' +
        'node -v\n' +
        'if ($?) { exit 0 }\n' +
        'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n' +
        'exit 1',
    );
  });

  it('composes with newline separators so a trailing semicolon never forms ;;', () => {
    expect(
      ensureNativeExitCodePropagated('echo hi;', 'powershell'),
    ).not.toContain(';;');
  });

  it('returns the input unchanged for bash', () => {
    expect(ensureNativeExitCodePropagated('node -v', 'bash')).toBe('node -v');
  });

  it('returns the input unchanged for cmd', () => {
    expect(ensureNativeExitCodePropagated('node -v', 'cmd')).toBe('node -v');
  });
});

/**
 * Cross-platform fixture that exits with the code given as argv[2].
 * Written to a temp file so the command avoids shell-quoting issues.
 */
let fixtureDir = '';
let fixtureScript = '';

const FIXTURE_CODE = `
process.exitCode = parseInt(process.argv[2] || '0', 10);
process.stdout.write('LLXPRT_EXIT_FIXTURE_MARKER');
`;

// Guarded: this afterAll is file-scoped but fixtureDir is assigned in a
// describe-scoped beforeAll, which does not run under test-name filtering.
afterAll(() => {
  if (fixtureDir !== '') {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

function fixtureCommand(exitCode: number): string {
  const invocation = `"${process.execPath}" "${fixtureScript}" ${exitCode}`;
  // A command line beginning with a quoted string parses in expression mode in
  // PowerShell; `&` forces command mode.
  return getShellConfiguration().shell === 'powershell'
    ? `& ${invocation}`
    : invocation;
}

async function executeAndCollect(
  command: string,
  config: ShellExecutionConfig = {},
): Promise<ShellExecutionResult> {
  const controller = new AbortController();
  const handle = await ShellExecutionService.execute(
    command,
    '.',
    () => {},
    controller.signal,
    false,
    config,
  );
  return handle.result;
}

describe('native exit code propagation through ShellExecutionService', () => {
  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'llxprt-exit-code-tests-'));
    fixtureScript = join(fixtureDir, 'exitFixture.mjs');
    writeFileSync(fixtureScript, FIXTURE_CODE);
  });

  it('reports a native exit code of 42', async () => {
    const result = await executeAndCollect(fixtureCommand(42));
    expect(result.exitCode).toBe(42);
  });

  it('reports exit code 0 for a successful command', async () => {
    const result = await executeAndCollect(fixtureCommand(0));
    expect(result.exitCode).toBe(0);
  });
});

describe.skipIf(process.platform !== 'win32')(
  'PowerShell-level failures and explicit exits',
  () => {
    it('reports a PowerShell-level failure (Write-Error) as exit 1', async () => {
      const result = await executeAndCollect(
        'Write-Error LLXPRT_PS_FAIL_MARKER',
      );
      expect(result.exitCode).toBe(1);
    });

    it('lets a user command that exits 7 win over the appended suffix', async () => {
      const result = await executeAndCollect('exit 7');
      expect(result.exitCode).toBe(7);
    });
  },
);
