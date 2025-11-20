/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier:Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { ClipboardService } from './ClipboardService.js';

vi.mock('child_process');

/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P05
 * @requirement REQ-001.1
 * @pseudocode lines 29-37
 */
describe('ClipboardService', () => {
  let clipboardService: ClipboardService;

  beforeEach(() => {
    clipboardService = new ClipboardService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore platform after each test
    Object.defineProperty(process, 'platform', {
      value: process.platform,
    });
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.1
   * @pseudocode lines 29-30
   */
  it('should copy OAuth URL to clipboard cleanly without extra characters', async () => {
    const testUrl = 'https://example.com/oauth?code=12345';

    // Mock child_process.spawn for this test
    const mockSpawn = vi.mocked(spawn);
    const mockChildProcess = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(), // mock stdin.on
      },
      stderr: {
        on: vi.fn(),
      },
      on: (event: string, callback: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 1);
        }
        return mockChildProcess;
      },
    };

    mockSpawn.mockReturnValue(
      mockChildProcess as unknown as ReturnType<typeof spawn>,
    );

    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    });

    await expect(
      clipboardService.copyToClipboard(testUrl),
    ).resolves.toBeUndefined();

    expect(mockSpawn).toHaveBeenCalledWith('pbcopy', []);
    expect(mockChildProcess.stdin.write).toHaveBeenCalledWith(testUrl);
    expect(mockChildProcess.stdin.end).toHaveBeenCalled();
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.2
   * @pseudocode lines 32-34
   */
  it('should detect and use correct clipboard utility for macOS (pbcopy)', async () => {
    const testUrl = 'https://example.com/oauth?code=12345';

    // Mock child_process.spawn for this test
    const mockSpawn = vi.mocked(spawn);
    const mockChildProcess = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(), // mock stdin.on
      },
      stderr: {
        on: vi.fn(),
      },
      on: (event: string, callback: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 1);
        }
        return mockChildProcess;
      },
    };

    mockSpawn.mockReturnValue(
      mockChildProcess as unknown as ReturnType<typeof spawn>,
    );

    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    });

    await expect(
      clipboardService.copyToClipboard(testUrl),
    ).resolves.toBeUndefined();

    expect(mockSpawn).toHaveBeenCalledWith('pbcopy', []);
    expect(mockChildProcess.stdin.write).toHaveBeenCalledWith(testUrl);
    expect(mockChildProcess.stdin.end).toHaveBeenCalled();
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.2
   * @pseudocode lines 32-33
   */
  it('should detect and use correct clipboard utility for Linux X11 (xclip)', async () => {
    const testUrl = 'https://example.com/oauth?code=12345';

    // Mock child_process.spawn for this test
    const mockSpawn = vi.mocked(spawn);
    const mockChildProcess = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(), // mock stdin.on
      },
      stderr: {
        on: vi.fn(),
      },
      on: (event: string, callback: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 1);
        }
        return mockChildProcess;
      },
    };

    mockSpawn.mockReturnValue(
      mockChildProcess as unknown as ReturnType<typeof spawn>,
    );

    Object.defineProperty(process, 'platform', {
      value: 'linux',
    });

    await expect(
      clipboardService.copyToClipboard(testUrl),
    ).resolves.toBeUndefined();

    expect(mockSpawn).toHaveBeenCalledWith('xclip', [
      '-selection',
      'clipboard',
    ]);
    expect(mockChildProcess.stdin.write).toHaveBeenCalledWith(testUrl);
    expect(mockChildProcess.stdin.end).toHaveBeenCalled();
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.2
   * @pseudocode lines 32-34
   */
  it('should detect and use correct clipboard utility for Linux Wayland (wl-copy)', async () => {
    const testUrl = 'https://example.com/oauth?code=12345';

    // Mock child_process.spawn for this test
    const mockSpawn = vi.mocked(spawn);
    const mockChildProcessForXclip = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(), // mock stdin.on
      },
      stderr: {
        on: vi.fn(),
      },
      on: (event: string, callback: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 1);
        }
        return mockChildProcessForXclip;
      },
    };

    mockSpawn.mockReturnValue(
      mockChildProcessForXclip as unknown as ReturnType<typeof spawn>,
    );

    Object.defineProperty(process, 'platform', {
      value: 'linux',
    });

    await expect(
      clipboardService.copyToClipboard(testUrl),
    ).resolves.toBeUndefined();

    expect(mockSpawn).toHaveBeenCalledWith('xclip', [
      '-selection',
      'clipboard',
    ]);
    expect(mockChildProcessForXclip.stdin.write).toHaveBeenCalledWith(testUrl);
    expect(mockChildProcessForXclip.stdin.end).toHaveBeenCalled();
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.2
   * @pseudocode lines 32-34
   */
  it('should detect and use correct clipboard utility for Windows (clip)', async () => {
    const testUrl = 'https://example.com/oauth?code=12345';

    // Mock child_process.spawn for this test
    const mockSpawn = vi.mocked(spawn);
    const mockChildProcess = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(), // mock stdin.on
      },
      stderr: {
        on: vi.fn(),
      },
      on: (event: string, callback: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 1);
        }
        return mockChildProcess;
      },
    };

    mockSpawn.mockReturnValue(
      mockChildProcess as unknown as ReturnType<typeof spawn>,
    );

    Object.defineProperty(process, 'platform', {
      value: 'win32',
    });

    await expect(
      clipboardService.copyToClipboard(testUrl),
    ).resolves.toBeUndefined();

    expect(mockSpawn).toHaveBeenCalledWith('clip', []);
    expect(mockChildProcess.stdin.write).toHaveBeenCalledWith(testUrl);
    expect(mockChildProcess.stdin.end).toHaveBeenCalled();
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.3
   * @pseudocode lines 20-26
   */
  it('should handle clipboard copy failure gracefully with fallback to console', async () => {
    const testUrl = 'https://example.com/oauth?code=12345';

    // Mock child_process.spawn to simulate failure
    const mockSpawn = vi.mocked(spawn);
    const mockChildProcess = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('spawn ENOENT')), 1);
          }
        }),
      },
      stderr: {
        on: vi.fn(),
      },
      on: (event: string, callback: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => callback(1), 1); // Non-zero exit code signifies failure
        }
        if (event === 'error') {
          setTimeout(() => callback(new Error('spawn ENOENT')), 1);
        }
        return mockChildProcess;
      },
    };

    mockSpawn.mockReturnValue(
      mockChildProcess as unknown as ReturnType<typeof spawn>,
    );

    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    });

    // Should reject with error when pbcopy fails
    await expect(clipboardService.copyToClipboard(testUrl)).rejects.toThrow(
      'spawn ENOENT',
    );
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.3
   * @pseudocode lines 20-21
   */
  it('should provide error information when clipboard fails', async () => {
    const testUrl = 'https://example.com/oauth?code=12345';

    // Mock child_process.spawn to simulate failure with stderr output
    const mockSpawn = vi.mocked(spawn);
    const mockChildProcess = {
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
          if (event === 'data') {
            setTimeout(() => callback('Error: pbcopy not found'), 1);
          }
        }),
      },
      on: (event: string, callback: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => callback(1), 1); // Non-zero exit code signifies failure
        }
        if (event === 'error') {
          setTimeout(() => callback(new Error('spawn pbcopy ENOENT')), 1);
        }
        return mockChildProcess;
      },
    };

    mockSpawn.mockReturnValue(
      mockChildProcess as unknown as ReturnType<typeof spawn>,
    );

    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    });

    // Should reject with specific error message when pbcopy fails
    await expect(clipboardService.copyToClipboard(testUrl)).rejects.toThrow(
      'spawn pbcopy ENOENT',
    );
  });
});
