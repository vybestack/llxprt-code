/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { spawn } from 'child_process';
import { saveClipboardImage } from './clipboardUtils.js';

// Mock dependencies
vi.mock('node:fs/promises');
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
}));

describe('saveClipboardImage Windows Path Escaping', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(process, 'platform', {
      value: 'win32',
    });

    // Mock fs calls to succeed
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as any);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
  });

  it('should escape single quotes in path for PowerShell script', async () => {
    // Mock spawn to simulate successful PowerShell execution
    const mockStdout = {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from('success')), 0);
        }
      }),
    };

    const mockStderr = {
      on: vi.fn(),
    };

    const mockProc = {
      stdout: mockStdout,
      stderr: mockStderr,
      on: vi.fn((event: string, callback: (code: number) => void) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 0);
        }
      }),
    };

    vi.mocked(spawn).mockReturnValue(mockProc as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const targetDir = "C:\\User's Files";
    await saveClipboardImage(targetDir);

    expect(spawn).toHaveBeenCalled();
    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const script = args[2];

    // The path C:\User's Files\.llxprt-clipboard\clipboard-....png
    // should be escaped in the script as 'C:\User''s Files\...'

    // Check if the script contains the escaped path
    expect(script).toMatch(/'C:\\User''s Files/);
  });
});
