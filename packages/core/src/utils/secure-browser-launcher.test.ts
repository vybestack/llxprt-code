/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecFileOptions } from 'node:child_process';
import {
  openBrowserSecurely,
  shouldLaunchBrowser,
} from './secure-browser-launcher.js';

type ExecFilePromise = (
  command: string,
  args: string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

// Create mock function using vi.hoisted
const mockExecFile = vi.hoisted(() => vi.fn<ExecFilePromise>());

// Mock modules
vi.mock('node:child_process');
vi.mock('node:util', () => ({
  promisify: () => mockExecFile,
}));

describe('secure-browser-launcher', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, 'platform', {
      value: platform,
      configurable: true,
    });
  }

  function requireWindowsDirectory(
    windowsDirectory: string | undefined,
  ): asserts windowsDirectory is string {
    if (windowsDirectory === undefined) {
      throw new Error(
        'Windows integration test requires SystemRoot or windir to locate System32\\where.exe.',
      );
    }
  }

  describe('URL validation', () => {
    it('should allow valid HTTP URLs', async () => {
      setPlatform('darwin');
      await openBrowserSecurely('http://example.com');
      expect(mockExecFile).toHaveBeenCalledWith(
        'open',
        ['http://example.com'],
        expect.any(Object),
      );
    });

    it('should allow valid HTTPS URLs', async () => {
      setPlatform('darwin');
      await openBrowserSecurely('https://example.com');
      expect(mockExecFile).toHaveBeenCalledWith(
        'open',
        ['https://example.com'],
        expect.any(Object),
      );
    });

    it('should reject non-HTTP(S) protocols', async () => {
      await expect(openBrowserSecurely('file:///etc/passwd')).rejects.toThrow(
        'Unsafe protocol',
      );
      await expect(openBrowserSecurely('javascript:alert(1)')).rejects.toThrow(
        'Unsafe protocol',
      );
      await expect(openBrowserSecurely('ftp://example.com')).rejects.toThrow(
        'Unsafe protocol',
      );
    });

    it('should reject invalid URLs', async () => {
      await expect(openBrowserSecurely('not-a-url')).rejects.toThrow(
        'Invalid URL',
      );
      await expect(openBrowserSecurely('')).rejects.toThrow('Invalid URL');
    });

    it('should reject URLs with control characters', async () => {
      await expect(
        openBrowserSecurely('http://example.com\nmalicious-command'),
      ).rejects.toThrow('invalid characters');
      await expect(
        openBrowserSecurely('http://example.com\rmalicious-command'),
      ).rejects.toThrow('invalid characters');
      await expect(
        openBrowserSecurely('http://example.com\x00'),
      ).rejects.toThrow('invalid characters');
    });
  });

  describe('Command injection prevention', () => {
    it('keeps the exact Windows URL in the environment and out of constant PowerShell source', async () => {
      setPlatform('win32');
      const url =
        'https://example.com/callback path?name=O\'Brien&quote="double quotes"&state=$(whoami);pipe|tick`&redirect=>out#fragment';

      await openBrowserSecurely(url);

      expect(mockExecFile).toHaveBeenCalledWith(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$browserUrl = $env:LLXPRT_BROWSER_URL; Remove-Item Env:LLXPRT_BROWSER_URL; Start-Process -FilePath $browserUrl',
        ],
        {
          env: {
            ...process.env,
            SHELL: undefined,
            LLXPRT_BROWSER_URL: url,
          },
          shell: false,
          windowsHide: true,
        },
      );

      const args = mockExecFile.mock.calls[0]?.[1] ?? [];
      expect(args.join(' ')).not.toContain(url);
      expect(args.join(' ')).not.toContain('-WindowStyle');
      expect(args.join(' ')).not.toContain('Hidden');
    });

    it.runIf(process.platform === 'win32')(
      'executes the production PowerShell launch with where.exe and remains usable afterward',
      async () => {
        const windowsDirectory = process.env.SystemRoot ?? process.env.windir;
        requireWindowsDirectory(windowsDirectory);
        const harmlessTarget = join(windowsDirectory, 'System32', 'where.exe');
        const directory = await mkdtemp(
          join(tmpdir(), 'llxprt-browser-launch-'),
        );
        const sentinelPath = join(directory, 'parent-sentinel.txt');
        const { execFile: executeFile } =
          await vi.importActual<typeof import('node:child_process')>(
            'node:child_process',
          );

        mockExecFile.mockImplementationOnce(async (command, args, options) => {
          await new Promise<void>((resolve, reject) => {
            executeFile(
              command,
              args,
              {
                ...options,
                env: {
                  ...options.env,
                  LLXPRT_BROWSER_URL: harmlessTarget,
                },
              },
              (error) => {
                if (error) {
                  reject(error);
                  return;
                }
                resolve();
              },
            );
          });
          return { stdout: '', stderr: '' };
        });

        try {
          setPlatform('win32');
          await openBrowserSecurely('https://example.com/safe-integration');
          expect(mockExecFile).toHaveBeenCalledTimes(1);
          await writeFile(sentinelPath, 'parent remains usable', 'utf8');

          await expect(readFile(sentinelPath, 'utf8')).resolves.toBe(
            'parent remains usable',
          );
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
      10_000,
    );

    it('should handle URLs with special shell characters safely', async () => {
      setPlatform('darwin');

      const urlsWithSpecialChars = [
        'http://example.com/path?param=value&other=$value',
        'http://example.com/path#fragment;command',
        'http://example.com/$(whoami)',
        'http://example.com/`command`',
        'http://example.com/|pipe',
        'http://example.com/>redirect',
      ];

      for (const url of urlsWithSpecialChars) {
        await openBrowserSecurely(url);
        // Verify the URL is passed as an argument, not interpreted by shell
        expect(mockExecFile).toHaveBeenCalledWith(
          'open',
          [url],
          expect.any(Object),
        );
      }
    });
  });

  describe('Platform-specific behavior', () => {
    it('should use correct command on macOS', async () => {
      setPlatform('darwin');
      await openBrowserSecurely('https://example.com');
      expect(mockExecFile).toHaveBeenCalledWith(
        'open',
        ['https://example.com'],
        expect.any(Object),
      );
    });

    it('should use xdg-open on Linux', async () => {
      setPlatform('linux');
      await openBrowserSecurely('https://example.com');
      expect(mockExecFile).toHaveBeenCalledWith(
        'xdg-open',
        ['https://example.com'],
        expect.any(Object),
      );
    });

    it('should throw on unsupported platforms', async () => {
      setPlatform('aix');
      await expect(openBrowserSecurely('https://example.com')).rejects.toThrow(
        'Unsupported platform',
      );
    });
  });

  describe('Error handling', () => {
    it('should handle browser launch failures gracefully', async () => {
      setPlatform('darwin');
      mockExecFile.mockRejectedValueOnce(new Error('Command not found'));

      await expect(openBrowserSecurely('https://example.com')).rejects.toThrow(
        'Failed to open browser',
      );
    });

    it('should try fallback browsers on Linux', async () => {
      setPlatform('linux');

      // First call to xdg-open fails
      mockExecFile.mockRejectedValueOnce(new Error('Command not found'));
      // Second call to gnome-open succeeds
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

      await openBrowserSecurely('https://example.com');

      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile).toHaveBeenNthCalledWith(
        1,
        'xdg-open',
        ['https://example.com'],
        expect.any(Object),
      );
      expect(mockExecFile).toHaveBeenNthCalledWith(
        2,
        'gnome-open',
        ['https://example.com'],
        expect.any(Object),
      );
    });
  });

  describe('shouldLaunchBrowser', () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      savedEnv = { ...process.env };
      delete process.env.CI;
      delete process.env.BROWSER;
      delete process.env.DEBIAN_FRONTEND;
      delete process.env.SSH_CONNECTION;
      delete process.env.DISPLAY;
      delete process.env.WAYLAND_DISPLAY;
      delete process.env.MIR_SOCKET;
    });

    afterEach(() => {
      process.env = savedEnv;
    });

    it('returns false when forceManual is true', () => {
      setPlatform('darwin');
      expect(shouldLaunchBrowser({ forceManual: true })).toBe(false);
    });

    it('returns true when forceManual is false on a desktop environment', () => {
      setPlatform('darwin');
      expect(shouldLaunchBrowser({ forceManual: false })).toBe(true);
    });

    it('returns true when no options are provided on a desktop environment', () => {
      setPlatform('darwin');
      expect(shouldLaunchBrowser()).toBe(true);
    });

    it('returns true when options is undefined on a desktop environment', () => {
      setPlatform('darwin');
      expect(shouldLaunchBrowser(undefined)).toBe(true);
    });

    it('returns false when forceManual is true even if environment allows browser', () => {
      setPlatform('darwin');
      expect(shouldLaunchBrowser({ forceManual: true })).toBe(false);
    });

    it('returns false in CI even without forceManual', () => {
      setPlatform('darwin');
      process.env.CI = 'true';
      expect(shouldLaunchBrowser()).toBe(false);
    });
  });
});
