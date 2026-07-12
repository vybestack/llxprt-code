/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it, vi, beforeEach } from 'bun:test';
import { escapeShellArg, getShellConfiguration } from './shell-utils.js';

const mockQuote = vi.fn<(args: string[]) => string>();

describe('escapeShellArg', () => {
  beforeEach(() => {
    mockQuote.mockImplementation((args: string[]) =>
      args.map((arg) => `'${arg}'`).join(' '),
    );
  });

  describe('POSIX (bash)', () => {
    it('should use shell-quote for escaping', () => {
      mockQuote.mockReturnValueOnce("'escaped value'");
      const result = escapeShellArg('raw value', 'bash', mockQuote);
      expect(mockQuote).toHaveBeenCalledWith(['raw value']);
      expect(result).toBe("'escaped value'");
    });

    it('should handle empty strings', () => {
      mockQuote.mockClear();
      const result = escapeShellArg('', 'bash', mockQuote);
      expect(result).toBe('');
      expect(mockQuote).not.toHaveBeenCalled();
    });
  });

  describe('Windows', () => {
    describe('when shell is cmd.exe', () => {
      it('should wrap simple arguments in double quotes', () => {
        const result = escapeShellArg('search term', 'cmd');
        expect(result).toBe('"search term"');
      });

      it('should escape internal double quotes by doubling them', () => {
        const result = escapeShellArg('He said "Hello"', 'cmd');
        expect(result).toBe('"He said ""Hello"""');
      });

      it('should handle empty strings', () => {
        const result = escapeShellArg('', 'cmd');
        expect(result).toBe('');
      });
    });

    describe('when shell is PowerShell', () => {
      it('should wrap simple arguments in single quotes', () => {
        const result = escapeShellArg('search term', 'powershell');
        expect(result).toBe("'search term'");
      });

      it('should escape internal single quotes by doubling them', () => {
        const result = escapeShellArg("It's a test", 'powershell');
        expect(result).toBe("'It''s a test'");
      });

      it('should handle double quotes without escaping them', () => {
        const result = escapeShellArg('He said "Hello"', 'powershell');
        expect(result).toBe('\'He said "Hello"\'');
      });

      it('should handle empty strings', () => {
        const result = escapeShellArg('', 'powershell');
        expect(result).toBe('');
      });
    });
  });
});

describe('getShellConfiguration', () => {
  it('should return bash configuration on Linux', () => {
    const config = getShellConfiguration(false);
    expect(config.executable).toBe('bash');
    expect(config.argsPrefix).toStrictEqual(['-c']);
    expect(config.shell).toBe('bash');
  });

  it('should return bash configuration on macOS (darwin)', () => {
    const config = getShellConfiguration(false);
    expect(config.executable).toBe('bash');
    expect(config.argsPrefix).toStrictEqual(['-c']);
    expect(config.shell).toBe('bash');
  });

  describe('on Windows', () => {
    it('should return PowerShell configuration by default', () => {
      const config = getShellConfiguration(true, undefined);
      expect(config.executable).toBe('powershell.exe');
      expect(config.argsPrefix).toStrictEqual(['-NoProfile', '-Command']);
      expect(config.shell).toBe('powershell');
    });

    it('should ignore ComSpec when pointing to cmd.exe', () => {
      const cmdPath = 'C:\\WINDOWS\\system32\\cmd.exe';
      const config = getShellConfiguration(true, cmdPath);
      expect(config.executable).toBe('powershell.exe');
      expect(config.argsPrefix).toStrictEqual(['-NoProfile', '-Command']);
      expect(config.shell).toBe('powershell');
    });

    it('should return PowerShell configuration if ComSpec points to powershell.exe', () => {
      const psPath =
        'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
      const config = getShellConfiguration(true, psPath);
      expect(config.executable).toBe(psPath);
      expect(config.argsPrefix).toStrictEqual(['-NoProfile', '-Command']);
      expect(config.shell).toBe('powershell');
    });

    it('should return PowerShell configuration if ComSpec points to pwsh.exe', () => {
      const pwshPath = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
      const config = getShellConfiguration(true, pwshPath);
      expect(config.executable).toBe(pwshPath);
      expect(config.argsPrefix).toStrictEqual(['-NoProfile', '-Command']);
      expect(config.shell).toBe('powershell');
    });

    it('should be case-insensitive when checking ComSpec', () => {
      const config = getShellConfiguration(
        true,
        'C:\\Path\\To\\POWERSHELL.EXE',
      );
      expect(config.executable).toBe('C:\\Path\\To\\POWERSHELL.EXE');
      expect(config.argsPrefix).toStrictEqual(['-NoProfile', '-Command']);
      expect(config.shell).toBe('powershell');
    });
  });
});
