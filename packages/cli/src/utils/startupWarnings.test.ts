/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import { getStartupWarnings } from './startupWarnings';
import fs from 'fs/promises';
import { getErrorMessage } from '@vybestack/llxprt-code-core';

vi.mock('fs/promises');
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getErrorMessage: vi.fn(),
  };
});

/**
 * Tests for startup warnings functionality.
 * These tests verify the behavior of reading and deleting temporary warning files
 * that may be created during CLI startup to communicate issues to the user.
 */
describe('startupWarnings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return warnings from the file and delete it', async () => {
    const mockWarnings = 'Warning 1\nWarning 2';
    (fs.access as Mock<typeof fs.access>).mockResolvedValue();
    (fs.readFile as Mock<typeof fs.readFile>).mockResolvedValue(mockWarnings);
    (fs.unlink as Mock<typeof fs.unlink>).mockResolvedValue();

    const warnings = await getStartupWarnings();

    expect(fs.access).toHaveBeenCalled();
    expect(fs.readFile).toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalled();
    expect(warnings).toStrictEqual(['Warning 1', 'Warning 2']);
  });

  it('should return an empty array if the file does not exist', async () => {
    const error = new Error('File not found');
    (error as Error & { code: string }).code = 'ENOENT';
    (fs.access as Mock<typeof fs.access>).mockRejectedValue(error);

    const warnings = await getStartupWarnings();

    expect(warnings).toStrictEqual([]);
  });

  it('should return an error message if reading the file fails', async () => {
    const error = new Error('Permission denied');
    (fs.access as Mock<typeof fs.access>).mockRejectedValue(error);
    (getErrorMessage as Mock<typeof getErrorMessage>).mockReturnValue(
      'Permission denied',
    );

    const warnings = await getStartupWarnings();

    expect(warnings).toStrictEqual([
      'Error checking/reading warnings file: Permission denied',
    ]);
  });

  it('should return a warning if deleting the file fails', async () => {
    const mockWarnings = 'Warning 1';
    (fs.access as Mock<typeof fs.access>).mockResolvedValue();
    (fs.readFile as Mock<typeof fs.readFile>).mockResolvedValue(mockWarnings);
    (fs.unlink as Mock<typeof fs.unlink>).mockRejectedValue(
      new Error('Permission denied'),
    );

    const warnings = await getStartupWarnings();

    expect(warnings).toStrictEqual([
      'Warning 1',
      'Warning: Could not delete temporary warnings file.',
    ]);
  });
});
