/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiagnosticsSink, logVerbose } from './diagnostics.js';

describe('diagnostics sink', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes warnings and dumps to the harness diagnostics log', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'test-utils-diagnostics-'));
    tempDirs.push(testDir);
    const sink = createDiagnosticsSink(testDir);

    sink.warn('Cleanup warning:', 'permission denied');
    sink.dump('result preview', 'hello world');

    const log = readFileSync(join(testDir, 'harness-diagnostics.log'), 'utf-8');
    expect(log).toContain('--- Cleanup warning: ---');
    expect(log).toContain('permission denied');
    expect(log).toContain('--- result preview ---');
    expect(log).toContain('hello world');
  });

  it('keeps process streams quiet unless verbose output is enabled', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const sink = createDiagnosticsSink(null);

    sink.verbose('hidden');
    sink.warn('hidden warning');
    sink.error('hidden error');
    logVerbose('also hidden');

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it('emits to process streams when VERBOSE is true', () => {
    vi.stubEnv('VERBOSE', 'true');
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const sink = createDiagnosticsSink(null);

    sink.verbose('visible');
    sink.error('visible error', 'detail');
    logVerbose('standalone');

    expect(stdout).toHaveBeenCalledWith('visible\n');
    expect(stdout).toHaveBeenCalledWith('standalone\n');
    expect(stderr).toHaveBeenCalledWith('visible error\n');
    expect(stderr).toHaveBeenCalledWith('detail\n');
  });
});
