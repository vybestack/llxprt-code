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

  const createNodeCommand = async (
    fileName: string,
    contents: string,
  ): Promise<string> => {
    const scriptPath = path.join(testDir, fileName);
    await fs.writeFile(scriptPath, contents, 'utf-8');
    return `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`;
  };

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
    const command = await createNodeCommand(
      'print-llxprt-child.js',
      "console.log(`LLXPRT_CODE=${process.env.LLXPRT_CODE ?? ''}`);",
    );
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
    expect(result.output).toBe('LLXPRT_CODE=1');
  });

  it('should use LLXPRT_CODE environment variable instead of GEMINI_CLI when executed with pty', async () => {
    const command = await createNodeCommand(
      'print-llxprt-pty.js',
      "console.log(`LLXPRT_CODE=${process.env.LLXPRT_CODE ?? ''}`);",
    );
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
    expect(result.output).toBe('LLXPRT_CODE=1');
  });

  it('should not set GEMINI_CLI environment variable', async () => {
    const command = await createNodeCommand(
      'print-gemini-cli.js',
      "console.log(`GEMINI_CLI=${process.env.GEMINI_CLI ?? 'NOT_DEFINED'}`);",
    );
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
    expect(result.output).toBe('GEMINI_CLI=NOT_DEFINED');
  });
});
