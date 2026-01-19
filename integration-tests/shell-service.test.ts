/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ShellExecutionService } from '../packages/core/src/services/shellExecutionService.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { vi } from 'vitest';

describe('ShellExecutionService programmatic integration tests', () => {
  let testDir: string;

  beforeAll(async () => {
    // Create a dedicated directory for this test suite to avoid conflicts.
    testDir = path.join(
      process.env['INTEGRATION_TEST_FILE_DIR']!,
      'shell-service-tests',
    );
    await fs.mkdir(testDir, { recursive: true });
  });

  it('should execute a simple cross-platform command (echo)', async () => {
    const command = 'echo "hello from the service"';
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
    // Output can vary slightly between shells (e.g., quotes), so check for inclusion.
    expect(result.output).toContain('hello from the service');
  });

  it.runIf(process.platform === 'win32')(
    'should execute "dir" on Windows',
    async () => {
      const testFile = 'test-file-windows.txt';
      await fs.writeFile(path.join(testDir, testFile), 'windows test');

      const command = 'dir';
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
      expect(result.output).toContain(testFile);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'should execute "ls -l" on Unix',
    async () => {
      const testFile = 'test-file-unix.txt';
      await fs.writeFile(path.join(testDir, testFile), 'unix test');

      const command = 'ls -l';
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
      expect(result.output).toContain(testFile);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'should abort a running process on Unix',
    async () => {
      const command = 'sleep 20';
      const onOutputEvent = vi.fn();
      const abortController = new AbortController();

      const handle = await ShellExecutionService.execute(
        command,
        testDir,
        onOutputEvent,
        abortController.signal,
        false,
      );

      // Abort shortly after starting
      setTimeout(() => abortController.abort(), 50);

      const result = await handle.result;

      expect(result.aborted).toBe(true);
      // Unix: Should not have exited cleanly
      const exitedCleanly = result.exitCode === 0 && result.signal === null;
      expect(exitedCleanly, 'Process should not have exited cleanly').toBe(
        false,
      );
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'should abort a running process on Windows',
    async () => {
      const command = 'ping -n 20 127.0.0.1'; // Ping localhost 20 times (~20 seconds)
      const onOutputEvent = vi.fn();
      const abortController = new AbortController();

      const handle = await ShellExecutionService.execute(
        command,
        testDir,
        onOutputEvent,
        abortController.signal,
        false,
      );

      // Abort shortly after starting
      setTimeout(() => abortController.abort(), 50);

      const result = await handle.result;

      // Windows: Just verify it was marked as aborted
      expect(result.aborted).toBe(true);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'should propagate environment variables to the child process on Unix',
    async () => {
      const varName = 'LLXPRT_CODE_TEST_VAR';
      const varValue = `test-value`;
      process.env[varName] = varValue;

      try {
        const command = `echo $${varName}`;
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
        expect(result.output).toContain(varValue);
      } finally {
        // Clean up the env var to prevent side-effects on other tests.
        delete process.env[varName];
      }
    },
  );

  it.skipIf(process.platform !== 'win32')(
    'should propagate environment variables to the child process on Windows',
    async () => {
      const varName = 'LLXPRT_CODE_TEST_VAR';
      const varValue = `test-value`;
      process.env[varName] = varValue;

      try {
        const command = `cmd /c echo %${varName}%`;
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
        expect(result.output).toContain(varValue);
      } finally {
        // Clean up the env var to prevent side-effects on other tests.
        delete process.env[varName];
      }
    },
  );
});
