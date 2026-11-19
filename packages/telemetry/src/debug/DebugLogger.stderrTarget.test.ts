/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4128: the `stderr` output target must write to stderr. Headless
 * runs reserve stdout for structured session output, so debug lines that
 * reached stdout corrupted it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import process from 'node:process';

const LEVELS = ['log', 'debug', 'warn', 'error'] as const;

describe('DebugLogger stderr output target', () => {
  let configHome: string;

  beforeEach(() => {
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-stderr-'));
  });

  afterEach(() => {
    fs.rmSync(configHome, { recursive: true, force: true });
  });

  function logEveryLevel(): { stdout: string; stderr: string } {
    const loggerUrl = new URL('./DebugLogger.ts', import.meta.url).href;
    const calls = LEVELS.map((level) => `logger.${level}('probe-${level}');`);
    const script = [
      `const { DebugLogger } = await import(${JSON.stringify(loggerUrl)});`,
      `const logger = new DebugLogger('llxprt:probe');`,
      ...calls,
    ].join('\n');
    const result = spawnSync(process.execPath, ['--eval', script], {
      cwd: configHome,
      encoding: 'utf8',
      env: {
        ...process.env,
        DEBUG: 'llxprt:probe',
        DEBUG_OUTPUT: 'stderr',
        LLXPRT_CONFIG_HOME: configHome,
      },
    });
    return { stdout: result.stdout, stderr: result.stderr };
  }

  it('writes nothing to stdout', () => {
    expect(logEveryLevel().stdout).toBe('');
  });

  it('writes every level to stderr', () => {
    const { stderr } = logEveryLevel();

    for (const level of LEVELS) {
      expect(stderr).toContain(`probe-${level}`);
    }
  });
});
