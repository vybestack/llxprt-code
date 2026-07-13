/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as nodePath from 'node:path';
import {
  openBrowserSecurely,
  shouldLaunchBrowser,
} from './secure-browser-launcher.js';

// Create mock function using vi.hoisted
const mockExecFile = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());

// Mock modules
vi.mock('node:child_process');
vi.mock('node:util', () => ({
  promisify: () => mockExecFile,
}));
vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
}));

describe('secure-browser-launcher', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });
    mockExistsSync.mockReturnValue(false);
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
    it('should prevent PowerShell command injection on Windows', async () => {
      setPlatform('win32');

      // The POC from the vulnerability report
      const maliciousUrl =
        "http://127.0.0.1:8080/?param=example#$(Invoke-Expression([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('Y2FsYy5leGU='))))";

      await openBrowserSecurely(maliciousUrl);

      // Verify that execFile was called (not exec) and the URL is passed safely
      expect(mockExecFile).toHaveBeenCalledWith(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-Command',
          `Start-Process '${maliciousUrl.replace(/'/g, "''")}'`,
        ],
        expect.any(Object),
      );
    });

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

    it('should properly escape single quotes in URLs on Windows', async () => {
      setPlatform('win32');

      const urlWithSingleQuotes =
        "http://example.com/path?name=O'Brien&test='value'";
      await openBrowserSecurely(urlWithSingleQuotes);

      // Verify that single quotes are escaped by doubling them
      expect(mockExecFile).toHaveBeenCalledWith(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-WindowStyle',
          'Hidden',
          '-Command',
          `Start-Process 'http://example.com/path?name=O''Brien&test=''value'''`,
        ],
        expect.any(Object),
      );
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

    it('should use PowerShell on Windows', async () => {
      setPlatform('win32');
      await openBrowserSecurely('https://example.com');
      expect(mockExecFile).toHaveBeenCalledWith(
        'powershell.exe',
        expect.arrayContaining([
          '-Command',
          `Start-Process 'https://example.com'`,
        ]),
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

  describe('Browser-specific launch with profile directory', () => {
    it('launches Chrome with profile directory on macOS', async () => {
      setPlatform('darwin');
      await openBrowserSecurely('https://example.com', {
        browser: 'chrome',
        profileDirectory: 'Profile 1',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'open',
        [
          '-a',
          'Google Chrome',
          '--args',
          '--profile-directory=Profile 1',
          'https://example.com',
        ],
        expect.any(Object),
      );
    });

    it('launches Chrome with profile directory on Linux', async () => {
      setPlatform('linux');
      await openBrowserSecurely('https://example.com', {
        browser: 'chrome',
        profileDirectory: 'Default',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'google-chrome',
        ['--profile-directory=Default', 'https://example.com'],
        expect.any(Object),
      );
    });

    it('launches Chrome with profile directory on Windows', async () => {
      setPlatform('win32');
      await openBrowserSecurely('https://example.com', {
        browser: 'chrome',
        profileDirectory: 'Default',
      });

      // Windows invokes the Chrome binary directly via execFileAsync — no
      // PowerShell, no Start-Process command string.
      expect(mockExecFile).toHaveBeenCalledWith(
        'chrome.exe',
        ['--profile-directory=Default', 'https://example.com'],
        expect.any(Object),
      );
    });

    it('preserves spaces in Chrome profile directory on Windows', async () => {
      setPlatform('win32');
      await openBrowserSecurely('https://example.com', {
        browser: 'chrome',
        profileDirectory: 'Profile 1',
      });

      // Each argument is a distinct argv element, so the space in
      // "Profile 1" is preserved without any shell quoting.
      expect(mockExecFile).toHaveBeenCalledWith(
        'chrome.exe',
        ['--profile-directory=Profile 1', 'https://example.com'],
        expect.any(Object),
      );
    });

    it('launches Firefox with profile on macOS', async () => {
      setPlatform('darwin');
      await openBrowserSecurely('https://example.com', {
        browser: 'firefox',
        profileDirectory: 'myprofile',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'open',
        ['-a', 'Firefox', '--args', '-P', 'myprofile', 'https://example.com'],
        expect.any(Object),
      );
    });

    it('launches Firefox with profile on Linux', async () => {
      setPlatform('linux');
      await openBrowserSecurely('https://example.com', {
        browser: 'firefox',
        profileDirectory: 'dev-profile',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'firefox',
        ['-P', 'dev-profile', 'https://example.com'],
        expect.any(Object),
      );
    });

    it('launches Firefox with profile on Windows', async () => {
      setPlatform('win32');
      await openBrowserSecurely('https://example.com', {
        browser: 'firefox',
        profileDirectory: 'dev-profile',
      });

      // Windows invokes the Firefox binary directly via execFileAsync — no
      // PowerShell, no Start-Process command string.
      expect(mockExecFile).toHaveBeenCalledWith(
        'firefox.exe',
        ['-P', 'dev-profile', 'https://example.com'],
        expect.any(Object),
      );
    });

    it('falls back to a typical Windows Chrome install location when chrome.exe is not on PATH', async () => {
      setPlatform('win32');
      process.env.PROGRAMFILES = String.raw`C:\Program Files`;
      // Primary chrome.exe launch fails (ENOENT), and only the Program Files
      // install location is treated as present on disk.
      mockExecFile.mockReset();
      mockExecFile.mockRejectedValueOnce(new Error('spawn chrome.exe ENOENT'));
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      mockExistsSync.mockImplementation((p: unknown) =>
        String(p).includes('Chrome'),
      );

      await openBrowserSecurely('https://example.com', {
        browser: 'chrome',
        profileDirectory: 'Default',
      });

      // nodePath.join uses the test host's separator, so build the expected
      // path the same way the implementation does rather than hardcoding one.
      const expectedPath = nodePath.join(
        String.raw`C:\Program Files`,
        'Google',
        'Chrome',
        'Application',
        'chrome.exe',
      );
      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile).toHaveBeenNthCalledWith(
        2,
        expectedPath,
        ['--profile-directory=Default', 'https://example.com'],
        expect.any(Object),
      );
      delete process.env.PROGRAMFILES;
    });

    it('throws when no Windows Chrome install location is found', async () => {
      setPlatform('win32');
      // Primary chrome.exe launch fails and no install location exists, so
      // only the single primary attempt is made (fallback candidates are
      // skipped before execFile because existsSync returns false).
      mockExecFile.mockReset();
      mockExecFile.mockRejectedValue(new Error('spawn chrome.exe ENOENT'));
      mockExistsSync.mockReturnValue(false);

      await expect(
        openBrowserSecurely('https://example.com', { browser: 'chrome' }),
      ).rejects.toThrow('Failed to open chrome');
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it('launches Safari on macOS (ignoring profile directory)', async () => {
      setPlatform('darwin');
      await openBrowserSecurely('https://example.com', {
        browser: 'safari',
        profileDirectory: 'ignored',
      });

      const callArgs = mockExecFile.mock.calls[0];
      expect(callArgs[0]).toBe('open');
      expect(callArgs[1]).toStrictEqual([
        '-a',
        'Safari',
        'https://example.com',
      ]);
      // Safari does not support profile directories: assert the launch args
      // never leak a profile flag even when one was requested.
      expect(callArgs[1]).not.toContain(
        expect.stringContaining('profile-directory'),
      );
      expect(callArgs[1]).not.toContain(expect.stringContaining('-profile'));
    });

    it('throws on Safari on non-darwin platforms', async () => {
      setPlatform('linux');
      await expect(
        openBrowserSecurely('https://example.com', { browser: 'safari' }),
      ).rejects.toThrow('Safari');
    });

    it('rejects profile directory with path traversal', async () => {
      setPlatform('darwin');
      await expect(
        openBrowserSecurely('https://example.com', {
          browser: 'chrome',
          profileDirectory: '../etc/passwd',
        }),
      ).rejects.toThrow('Invalid profile directory');
    });

    it('rejects profile directory with shell metacharacters', async () => {
      setPlatform('darwin');
      await expect(
        openBrowserSecurely('https://example.com', {
          browser: 'chrome',
          profileDirectory: 'Profile; rm -rf /',
        }),
      ).rejects.toThrow('Invalid profile directory');
    });

    it('rejects profile directory with control characters', async () => {
      setPlatform('darwin');
      await expect(
        openBrowserSecurely('https://example.com', {
          browser: 'chrome',
          profileDirectory: 'Profile\nmalicious',
        }),
      ).rejects.toThrow('Invalid profile directory');
    });

    it('accepts valid Chrome profile directory names', async () => {
      setPlatform('darwin');
      const validNames = ['Default', 'Profile 1', 'Profile_2', 'my.profile'];
      for (const name of validNames) {
        mockExecFile.mockClear();
        await openBrowserSecurely('https://example.com', {
          browser: 'chrome',
          profileDirectory: name,
        });
        expect(mockExecFile).toHaveBeenCalled();
      }
    });

    it('launches Chrome without profile directory when browser is set but no profile', async () => {
      setPlatform('darwin');
      await openBrowserSecurely('https://example.com', {
        browser: 'chrome',
      });

      expect(mockExecFile).toHaveBeenCalledWith(
        'open',
        expect.arrayContaining(['-a', 'Google Chrome', 'https://example.com']),
        expect.any(Object),
      );
      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).not.toContain('--args');
    });

    it('falls back to an alternate Chrome binary when google-chrome is missing on Linux', async () => {
      setPlatform('linux');
      // google-chrome fails, then google-chrome-stable fails; chromium
      // succeeds — proving the fallback chain is walked in order.
      mockExecFile
        .mockRejectedValueOnce(new Error('not found'))
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await openBrowserSecurely('https://example.com', {
        browser: 'chrome',
        profileDirectory: 'Default',
      });

      const calls = mockExecFile.mock.calls;
      expect(calls[0][0]).toBe('google-chrome');
      expect(calls[1][0]).toBe('google-chrome-stable');
      expect(calls[2][0]).toBe('chromium');
      expect(calls[2][1]).toStrictEqual([
        '--profile-directory=Default',
        'https://example.com',
      ]);
    });
  });
});
