/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShellExecutionService } from './shellExecutionService.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('ShellExecutionService with LLXPRT_CODE environment variables', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a dedicated directory for this test suite
    testDir = path.join(
      process.env['INTEGRATION_TEST_FILE_DIR'] || '/tmp',
      'shell-service-env-tests',
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  it('should use LLXPRT_CODE environment variable instead of GEMINI_CLI when executed in child_process mode', async () => {
    const command = process.platform === 'win32' ? 'set LLXPRT_CODE' : 'env';
    const onOutputEvent = vi.fn();
    const abortController = new AbortController();

    const handle = await ShellExecutionService.execute(
      command,
      testDir,
      onOutputEvent,
      abortController.signal,
      false, // Use child_process mode
    );

    const result = await handle.result;

    expect(result.error).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/LLXPRT_CODE=1/);
  });

  it('should use LLXPRT_CODE environment variable instead of GEMINI_CLI when executed with pty', async () => {
    const command = process.platform === 'win32' ? 'set LLXPRT_CODE' : 'env';
    const onOutputEvent = vi.fn();
    const abortController = new AbortController();

    const handle = await ShellExecutionService.execute(
      command,
      testDir,
      onOutputEvent,
      abortController.signal,
      true, // Use node-pty mode if available
    );

    const result = await handle.result;

    expect(result.error).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/LLXPRT_CODE=1/);
  });

  it('should not set GEMINI_CLI environment variable', async () => {
    const command = process.platform === 'win32' ? 'set GEMINI_CLI' : 'env';
    const onOutputEvent = vi.fn();
    const abortController = new AbortController();

    const handle = await ShellExecutionService.execute(
      command,
      testDir,
      onOutputEvent,
      abortController.signal,
      false,
    );

    const result = await handle.result;

    expect(result.error).toBeNull();
    expect(result.exitCode).toBe(0);
    if (process.platform === 'win32') {
      expect(result.output.toLowerCase()).not.toContain('gemini_cli=');
      expect(result.output.trim().length).toBe(0);
    } else {
      expect(result.output).not.toContain('GEMINI_CLI=');
    }
  });
});
