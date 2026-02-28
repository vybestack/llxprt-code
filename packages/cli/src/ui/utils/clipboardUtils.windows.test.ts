/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import { saveClipboardImage } from './clipboardUtils.js';

// Mock dependencies
vi.mock('fs/promises');

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

// Must use a synchronous factory — async factories with importOriginal cause
// the module under test to capture the real spawn before the mock resolves.
// We also provide a promisify-compatible exec to keep secure-browser-launcher
// (imported transitively via @vybestack/llxprt-code-core) from throwing.
vi.mock('child_process', () => {
  const execFn = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: vi.fn(),
  });
  const mod = {
    spawn: mockSpawn,
    exec: execFn,
    execSync: vi.fn(),
    execFile: vi.fn(),
    fork: vi.fn(),
    spawnSync: vi.fn(),
  };
  return { ...mod, default: mod };
});

describe('saveClipboardImage Windows Path Escaping', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
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

    mockSpawn.mockReturnValue(mockProc);

    const targetDir = "C:\\User's Files";
    await saveClipboardImage(targetDir);

    expect(mockSpawn).toHaveBeenCalled();
    const args = mockSpawn.mock.calls[0][1] as string[];
    const script = args[2];

    // The path should have single quotes escaped for PowerShell ('' instead of ')
    expect(script).toMatch(/'C:\\User''s Files/);
  });
});
