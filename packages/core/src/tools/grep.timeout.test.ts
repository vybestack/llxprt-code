/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GrepTool, GrepToolParams } from './grep.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { Config } from '../config/config.js';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
import { ToolErrorType } from './tool-error.js';
import * as glob from 'glob';

// We'll use selective mocking to control timing
vi.mock('glob', { spy: true });

// Mock child_process to force JS fallback
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    on: (event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'error' || event === 'close') {
        setTimeout(() => cb(1), 0);
      }
    },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  })),
}));

describe('GrepTool timeout functionality', () => {
  let tempRootDir: string;
  let grepTool: GrepTool;

  const createMockConfig = (dir: string) =>
    ({
      getTargetDir: () => dir,
      getWorkspaceContext: () => createMockWorkspaceContext(dir),
      getEphemeralSettings: () => ({}),
      getFileExclusions: () => ({
        getGlobExcludes: () => [],
      }),
    }) as unknown as Config;

  beforeEach(async () => {
    tempRootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'grep-timeout-test-'),
    );
    grepTool = new GrepTool(createMockConfig(tempRootDir));

    // Create test files
    await fs.writeFile(
      path.join(tempRootDir, 'testFile.txt'),
      'hello world\ntest content',
    );
  });

  afterEach(async () => {
    await fs.rm(tempRootDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('timeout_ms parameter validation', () => {
    it('should accept valid timeout_ms parameter', () => {
      const params: GrepToolParams = {
        pattern: 'test',
        timeout_ms: 30000,
      };
      expect(grepTool.validateToolParams(params)).toBeNull();
    });

    it('should accept timeout_ms at max value (300000ms)', () => {
      const params: GrepToolParams = {
        pattern: 'test',
        timeout_ms: 300000,
      };
      expect(grepTool.validateToolParams(params)).toBeNull();
    });

    it('should accept timeout_ms at min reasonable value (1000ms)', () => {
      const params: GrepToolParams = {
        pattern: 'test',
        timeout_ms: 1000,
      };
      expect(grepTool.validateToolParams(params)).toBeNull();
    });
  });

  describe('timeout enforcement', () => {
    it('should return TIMEOUT error when operation exceeds timeout_ms', async () => {
      // Mock glob to be slow - simulates a directory traversal that takes too long
      vi.mocked(glob.globStream).mockImplementation((_pattern, options) => {
        // Return an async iterator that delays before yielding
        // This simulates a slow file system traversal
        const signal = options?.signal as AbortSignal | undefined;
        return {
          // eslint-disable-next-line require-yield
          async *[Symbol.asyncIterator]() {
            // Delay long enough to trigger timeout
            await new Promise<void>((resolve, reject) => {
              const timeoutId = setTimeout(resolve, 200);
              if (signal) {
                signal.addEventListener('abort', () => {
                  clearTimeout(timeoutId);
                  reject(new Error('This operation was aborted'));
                });
              }
            });
            // Never actually yields - timeout fires first
          },
        } as ReturnType<typeof glob.globStream>;
      });

      const params: GrepToolParams = {
        pattern: 'hello',
        timeout_ms: 50, // 50ms timeout - will be exceeded by the 200ms delay
      };

      const invocation = grepTool.build(params);
      const abortController = new AbortController();

      const result = await invocation.execute(abortController.signal);

      // Should return a timeout error with helpful message
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.TIMEOUT);
      expect(result.llmContent).toContain('timed out');
      expect(result.llmContent).toContain('timeout_ms');

      vi.mocked(glob.globStream).mockRestore();
    });

    it('should complete successfully before timeout expires', async () => {
      const abortController = new AbortController();

      const params: GrepToolParams = {
        pattern: 'hello',
        timeout_ms: 60000, // 1 minute - plenty of time
      };

      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortController.signal);

      // Should complete successfully
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Found');
    });

    it('should use default timeout (60s) when timeout_ms is not specified', async () => {
      const abortController = new AbortController();

      const params: GrepToolParams = {
        pattern: 'hello',
        // No timeout_ms - should use default of 60000ms
      };

      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortController.signal);

      // Should complete successfully with default timeout
      expect(result.error).toBeUndefined();
    });

    it('should cap timeout at MAX_TIMEOUT_MS (5 minutes) even if larger value provided', async () => {
      const abortController = new AbortController();

      const params: GrepToolParams = {
        pattern: 'hello',
        timeout_ms: 600000, // 10 minutes - exceeds max
      };

      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortController.signal);

      // Should complete successfully - the timeout is capped internally
      expect(result.error).toBeUndefined();
    });
  });

  describe('timeout error message', () => {
    it('should provide helpful suggestions in timeout error message', async () => {
      // Mock glob to be slow
      vi.mocked(glob.globStream).mockImplementation((_pattern, options) => {
        const signal = options?.signal as AbortSignal | undefined;
        return {
          // eslint-disable-next-line require-yield
          async *[Symbol.asyncIterator]() {
            await new Promise<void>((resolve, reject) => {
              const timeoutId = setTimeout(resolve, 200);
              if (signal) {
                signal.addEventListener('abort', () => {
                  clearTimeout(timeoutId);
                  reject(new Error('This operation was aborted'));
                });
              }
            });
          },
        } as ReturnType<typeof glob.globStream>;
      });

      const params: GrepToolParams = {
        pattern: 'hello',
        timeout_ms: 50,
      };

      const invocation = grepTool.build(params);
      const abortController = new AbortController();

      const result = await invocation.execute(abortController.signal);

      // Should be a timeout error
      expect(result.error?.type).toBe(ToolErrorType.TIMEOUT);
      // Verify helpful suggestions are included
      expect(result.llmContent).toContain('timeout_ms');
      expect(result.llmContent).toMatch(/300000|max/i);

      vi.mocked(glob.globStream).mockRestore();
    });
  });

  describe('timeout vs user abort distinction', () => {
    it('should handle user abort without returning TIMEOUT error', async () => {
      const abortController = new AbortController();

      const params: GrepToolParams = {
        pattern: 'hello',
        timeout_ms: 60000,
      };

      // Abort immediately
      abortController.abort();

      const invocation = grepTool.build(params);
      const result = await invocation.execute(abortController.signal);

      // User abort should not be a TIMEOUT error - should be EXECUTION_FAILED
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.error?.type).not.toBe(ToolErrorType.TIMEOUT);
    });
  });
});
