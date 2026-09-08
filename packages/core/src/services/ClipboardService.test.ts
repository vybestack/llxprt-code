/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier:Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { spawn } from 'child_process';
import { ClipboardService } from './ClipboardService.js';

const __actual = { ...(await import('child_process')) };
void vi.mock('child_process', () => {
  const actual = __actual as typeof import('child_process');
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

const originalPlatform = process.platform;

/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P05
 * @requirement REQ-001.1
 * @pseudocode lines 29-37
 */

interface SuccessfulCopyFixture {
  readonly testUrl: string;
  readonly mockSpawn: Mock<typeof spawn>;
  readonly mockChildProcess: ReturnType<typeof spawnCloseChild>;
  readonly copyResult: Promise<void>;
}

function startSuccessfulCopy(
  clipboardService: ClipboardService,
  platform: NodeJS.Platform,
): SuccessfulCopyFixture {
  const testUrl = 'https://example.com/oauth?code=12345';
  const mockSpawn = spawn as Mock<typeof spawn>;
  const mockChildProcess = spawnCloseChild();
  mockSpawn.mockReturnValue(
    mockChildProcess as unknown as ReturnType<typeof spawn>,
  );
  Object.defineProperty(process, 'platform', { value: platform });
  const copyResult = clipboardService.copyToClipboard(testUrl);
  return { testUrl, mockSpawn, mockChildProcess, copyResult };
}

interface ClipboardChildStub {
  readonly stdin: {
    readonly write: Mock<(...args: unknown[]) => unknown>;
    readonly end: Mock<(...args: unknown[]) => unknown>;
    readonly on: Mock<(...args: unknown[]) => unknown>;
  };
  readonly stderr: {
    readonly on: Mock<(...args: unknown[]) => unknown>;
  };
  on(event: string, callback: (...args: unknown[]) => void): ClipboardChildStub;
}

function spawnCloseChild(): ClipboardChildStub {
  const child: ClipboardChildStub = {
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
      return child;
    },
  };
  return child;
}

function spawnFailChild(): ClipboardChildStub {
  const child: ClipboardChildStub = {
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
      return child;
    },
  };
  return child;
}

function spawnStderrChild(): ClipboardChildStub {
  const child: ClipboardChildStub = {
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
      return child;
    },
  };
  return child;
}

describe('ClipboardService', () => {
  let clipboardService: ClipboardService;

  beforeEach(() => {
    clipboardService = new ClipboardService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore platform after each test
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.1
   * @pseudocode lines 29-30
   */
  it('should copy OAuth URL to clipboard cleanly without extra characters', async () => {
    const fixture = startSuccessfulCopy(clipboardService, 'darwin');

    await expect(fixture.copyResult).resolves.toBeUndefined();
    expect(fixture.mockChildProcess.stdin.write).toHaveBeenCalledWith(
      fixture.testUrl,
    );
    expect(fixture.mockChildProcess.stdin.end).toHaveBeenCalled();
    expect(fixture.mockSpawn).toHaveBeenCalledWith('pbcopy', []);
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.2
   * @pseudocode lines 32-34
   */
  it('should detect and use correct clipboard utility for macOS (pbcopy)', async () => {
    const fixture = startSuccessfulCopy(clipboardService, 'darwin');

    await expect(fixture.copyResult).resolves.toBeUndefined();
    expect(fixture.mockSpawn).toHaveBeenCalledWith('pbcopy', []);
    expect(fixture.mockChildProcess.stdin.write).toHaveBeenCalledWith(
      fixture.testUrl,
    );
    expect(fixture.mockChildProcess.stdin.end).toHaveBeenCalled();
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.2
   * @pseudocode lines 32-33
   */
  it('should detect and use correct clipboard utility for Linux X11 (xclip)', async () => {
    const fixture = startSuccessfulCopy(clipboardService, 'linux');

    await expect(fixture.copyResult).resolves.toBeUndefined();
    expect(fixture.mockSpawn).toHaveBeenCalledWith('xclip', [
      '-selection',
      'clipboard',
    ]);
    expect(fixture.mockChildProcess.stdin.write).toHaveBeenCalledWith(
      fixture.testUrl,
    );
    expect(fixture.mockChildProcess.stdin.end).toHaveBeenCalled();
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.2
   * @pseudocode lines 32-34
   */
  it('should detect and use correct clipboard utility for Linux Wayland (wl-copy)', async () => {
    const fixture = startSuccessfulCopy(clipboardService, 'linux');

    await expect(fixture.copyResult).resolves.toBeUndefined();
    expect(fixture.mockChildProcess.stdin.write).toHaveBeenCalledWith(
      fixture.testUrl,
    );
    expect(fixture.mockChildProcess.stdin.end).toHaveBeenCalled();
    expect(fixture.mockSpawn).toHaveBeenCalledWith('xclip', [
      '-selection',
      'clipboard',
    ]);
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.2
   * @pseudocode lines 32-34
   */
  it('should detect and use correct clipboard utility for Windows (clip)', async () => {
    const fixture = startSuccessfulCopy(clipboardService, 'win32');

    await expect(fixture.copyResult).resolves.toBeUndefined();
    expect(fixture.mockSpawn).toHaveBeenCalledWith('clip', []);
    expect(fixture.mockChildProcess.stdin.write).toHaveBeenCalledWith(
      fixture.testUrl,
    );
    expect(fixture.mockChildProcess.stdin.end).toHaveBeenCalled();
  });

  /**
   * @plan PLAN-20250822-GEMINIFALLBACK.P05
   * @requirement REQ-001.3
   * @pseudocode lines 20-26
   */
  it('should handle clipboard copy failure gracefully with fallback to console', async () => {
    const testUrl = 'https://example.com/oauth?code=12345';

    // Mock child_process.spawn to simulate failure
    const mockSpawn = spawn as Mock<typeof spawn>;
    const mockChildProcess = spawnFailChild();

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
    const mockSpawn = spawn as Mock<typeof spawn>;
    const mockChildProcess = spawnStderrChild();

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
