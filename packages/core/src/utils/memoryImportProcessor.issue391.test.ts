/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { processImports } from './memoryImportProcessor.js';

// Mock fs/promises
vi.mock('fs/promises');
const mockedFs = vi.mocked(fs);

// Mock console methods to capture error messages
const originalConsoleError = console.error;

describe('memoryImportProcessor - Issue #391', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console methods
    console.error = vi.fn();
  });

  afterEach(() => {
    // Restore console methods
    console.error = originalConsoleError;
  });

  it('should gracefully handle missing files without logging errors', async () => {
    // Test case for issue #391: When a file doesn't exist, it should not log an error
    // message that will confuse users
    const content = 'Some content @commitlint/config-conventional more content';
    const basePath = path.resolve('/test/path');

    // Mock fs.access to reject (simulating file not found)
    mockedFs.access.mockRejectedValue(
      new Error('ENOENT: no such file or directory'),
    );

    const result = await processImports(content, basePath, false);

    // Should have an error comment in the result
    expect(result.content).toContain(
      '<!-- Import failed: commitlint/config-conventional',
    );

    // The key point for issue #391: The error should NOT be logged to console.error
    // when debug mode is false (default)
    expect(console.error).not.toHaveBeenCalled();

    // Verify the error is included in the content
    expect(result.content).toContain('ENOENT');
  });

  it('should log errors in debug mode but not in normal mode', async () => {
    const content = 'Some content @commitlint/config-conventional more content';
    const basePath = path.resolve('/test/path');

    // Mock fs.access to reject
    const error = new Error('ENOENT: no such file or directory');
    mockedFs.access.mockRejectedValue(error);

    // Test with debug mode false (default)
    const resultNormal = await processImports(content, basePath, false);
    expect(console.error).not.toHaveBeenCalled();

    // Reset console mock
    vi.clearAllMocks();

    // Test with debug mode true
    const resultDebug = await processImports(content, basePath, true);
    expect(console.error).toHaveBeenCalledWith(
      '[ERROR] [ImportProcessor]',
      'Failed to import commitlint/config-conventional: ENOENT: no such file or directory',
    );

    // Both results should contain the error comment
    expect(resultNormal.content).toContain(
      '<!-- Import failed: commitlint/config-conventional',
    );
    expect(resultDebug.content).toContain(
      '<!-- Import failed: commitlint/config-conventional',
    );
  });

  it('should handle multiple missing imports gracefully', async () => {
    const content =
      'Content @commitlint/config-conventional and @nonexistent/file.md';
    const basePath = path.resolve('/test/path');

    // Mock fs.access to reject for all files
    mockedFs.access.mockRejectedValue(
      new Error('ENOENT: no such file or directory'),
    );

    const result = await processImports(content, basePath, false);

    // Should contain error comments for both missing imports
    expect(result.content).toContain(
      '<!-- Import failed: commitlint/config-conventional',
    );
    expect(result.content).toContain('<!-- Import failed: nonexistent/file.md');

    // But should not log any errors to console when debug mode is false
    expect(console.error).not.toHaveBeenCalled();
  });

  it('should handle ENOENT errors specifically and avoid logging', async () => {
    const content = 'Some content @commitlint/config-conventional more content';
    const basePath = path.resolve('/test/path');

    // Create an ENOENT error specifically
    const enoentError = new Error(
      'ENOENT: no such file or directory',
    ) as Error & { code: string };
    enoentError.code = 'ENOENT';
    mockedFs.access.mockRejectedValue(enoentError);

    const result = await processImports(content, basePath, false);

    // Should contain the error comment but not log to console
    expect(result.content).toContain(
      '<!-- Import failed: commitlint/config-conventional',
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it('should fail fast in flat mode when encountering missing files', async () => {
    const content = 'Content @commitlint/config-conventional';
    const basePath = path.resolve('/test/path');

    // Mock fs.access to reject
    mockedFs.access.mockRejectedValue(
      new Error('ENOENT: no such file or directory'),
    );

    const result = await processImports(
      content,
      basePath,
      false,
      undefined,
      undefined,
      'flat',
    );

    // Should contain the original content
    expect(result.content).toContain('Content @commitlint/config-conventional');

    // Should not log errors when debug mode is false
    expect(console.error).not.toHaveBeenCalled();
  });
});
