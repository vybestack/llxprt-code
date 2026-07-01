/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveBunPath, defaultPathCommand } from './bun-path-resolver.js';

describe('resolveBunPath', () => {
  it('prefers node_modules/.bin/bun candidate over PATH lookup', async () => {
    const foundCandidates: string[] = [];
    const pathChecker = vi.fn(async (target: string) => {
      foundCandidates.push(target);
      return target === '/repo/node_modules/.bin/bun';
    });
    const pathCommand = vi.fn(async () => '/usr/local/bin/bun');

    const result = await resolveBunPath({
      platform: 'linux',
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand,
    });

    expect(result).toBe('/repo/node_modules/.bin/bun');
    expect(pathCommand).not.toHaveBeenCalled();
    expect(foundCandidates).toContain('/repo/node_modules/.bin/bun');
  });

  it('climbs ancestors probing node_modules/.bin/bun', async () => {
    const probes: string[] = [];
    const pathChecker = vi.fn(async (target: string) => {
      probes.push(target);
      return target === '/repo/node_modules/.bin/bun';
    });

    const result = await resolveBunPath({
      platform: 'linux',
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand: vi.fn(async () => null),
    });

    expect(result).toBe('/repo/node_modules/.bin/bun');
    expect(probes).toContain(
      '/repo/packages/cli/src/launcher/node_modules/.bin/bun',
    );
    expect(probes).toContain('/repo/packages/cli/src/node_modules/.bin/bun');
    expect(
      probes.indexOf('/repo/packages/cli/src/launcher/node_modules/.bin/bun'),
    ).toBeLessThan(probes.indexOf('/repo/node_modules/.bin/bun'));
  });

  it('uses PATH fallback via which on POSIX when node_modules/.bin misses', async () => {
    const pathChecker = vi.fn(
      async (target: string) => target === '/opt/homebrew/bin/bun',
    );
    const pathCommand = vi.fn(async (tool: string, args: string[]) => {
      expect(tool).toBe('which');
      expect(args).toStrictEqual(['bun']);
      return '/opt/homebrew/bin/bun';
    });

    const result = await resolveBunPath({
      platform: 'darwin',
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand,
    });

    expect(result).toBe('/opt/homebrew/bin/bun');
  });

  it('uses PATH fallback via where on Windows when node_modules/.bin misses', async () => {
    const pathChecker = vi.fn(
      async (target: string) => target === 'C:/Program Files/bun/bun.exe',
    );
    const pathCommand = vi.fn(async (tool: string, args: string[]) => {
      expect(tool).toBe('where');
      expect(args).toStrictEqual(['bun']);
      return 'C:/Program Files/bun/bun.exe';
    });

    const result = await resolveBunPath({
      platform: 'win32',
      moduleDir: 'C:/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand,
    });

    expect(result).toBe('C:/Program Files/bun/bun.exe');
  });

  it('strips surrounding quotes from Windows where results before validation', async () => {
    const expectedPath = 'C:\\Program Files\\bun\\bun.exe';
    const pathChecker = vi.fn(
      async (target: string) => target === expectedPath,
    );
    const pathCommand = vi.fn(async () => `"${expectedPath}"\r\n`);

    const result = await resolveBunPath({
      platform: 'win32',
      moduleDir: 'C:/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand,
    });

    expect(result).toBe(expectedPath);
    expect(pathChecker).toHaveBeenCalledWith(expectedPath);
  });

  it('does not strip mismatched quotes from PATH results', async () => {
    const mismatchedPath = '"C:\\Program Files\\bun\\bun.exe\'';
    const pathChecker = vi.fn(async () => false);

    const result = await resolveBunPath({
      platform: 'win32',
      moduleDir: 'C:/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand: vi.fn(async () => `${mismatchedPath}\r\n`),
    });

    expect(result).toBeNull();
    expect(pathChecker).toHaveBeenCalledWith(mismatchedPath);
  });

  it('finds bun.exe under node_modules/.bin on Windows', async () => {
    const pathChecker = vi.fn(
      async (target: string) => target === 'C:/repo/node_modules/.bin/bun.exe',
    );

    const result = await resolveBunPath({
      platform: 'win32',
      moduleDir: 'C:/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand: vi.fn(async () => null),
    });

    expect(result).toBe('C:/repo/node_modules/.bin/bun.exe');
  });

  it('probes Windows candidate names bun.exe and bun.cmd', async () => {
    const probes: string[] = [];
    const pathChecker = vi.fn(async (target: string) => {
      probes.push(target);
      return target === 'C:/repo/node_modules/.bin/bun.cmd';
    });

    const result = await resolveBunPath({
      platform: 'win32',
      moduleDir: 'C:/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand: vi.fn(async () => null),
    });

    expect(result).toBe('C:/repo/node_modules/.bin/bun.cmd');
    expect(probes.some((p) => p.endsWith('bun.exe'))).toBe(true);
    expect(probes.some((p) => p.endsWith('bun.cmd'))).toBe(true);
  });

  it('probes POSIX candidate name bun', async () => {
    const probes: string[] = [];
    const pathChecker = vi.fn(async (target: string) => {
      probes.push(target);
      return target === '/repo/node_modules/.bin/bun';
    });

    await resolveBunPath({
      platform: 'linux',
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand: vi.fn(async () => null),
    });

    expect(probes.some((p) => p.endsWith('.bin/bun'))).toBe(true);
  });

  it('returns null when both node_modules/.bin and PATH miss', async () => {
    const pathChecker = vi.fn(async () => false);
    const pathCommand = vi.fn(async () => null);

    const result = await resolveBunPath({
      platform: 'linux',
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand,
    });

    expect(result).toBeNull();
  });

  it('returns null when PATH lookup command rejects', async () => {
    const pathChecker = vi.fn(async () => false);
    const pathCommand = vi.fn(async () => {
      throw new Error('ENOENT');
    });

    const result = await resolveBunPath({
      platform: 'linux',
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand,
    });

    expect(result).toBeNull();
  });

  it('terminates ancestor climbing at filesystem root without hanging', async () => {
    const pathChecker = vi.fn(async () => false);
    const pathCommand = vi.fn(async () => null);

    const result = await resolveBunPath({
      platform: 'linux',
      moduleDir: '/',
      pathChecker,
      pathCommand,
    });

    expect(result).toBeNull();
    expect(pathCommand).toHaveBeenCalledWith('which', ['bun']);
  });

  it('trims PATH lookup result', async () => {
    const pathChecker = vi.fn(
      async (target: string) => target === '/usr/bin/bun',
    );
    const pathCommand = vi.fn(async () => '  /usr/bin/bun\n');

    const result = await resolveBunPath({
      platform: 'linux',
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand,
    });

    expect(result).toBe('/usr/bin/bun');
  });

  it('ignores PATH lookup results that fail executable validation', async () => {
    const pathChecker = vi.fn(async () => false);
    const pathCommand = vi.fn(async () => '/stale/bun\n');

    const result = await resolveBunPath({
      platform: 'linux',
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand,
    });

    expect(result).toBeNull();
    expect(pathChecker).toHaveBeenCalledWith('/stale/bun');
  });

  it('returns null when PATH lookup yields empty string', async () => {
    const pathChecker = vi.fn(async () => false);
    const pathCommand = vi.fn(async () => '');

    const result = await resolveBunPath({
      platform: 'linux',
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand,
    });

    expect(result).toBeNull();
  });

  it('returns only the first executable path when Windows where returns multiple lines', async () => {
    const expectedPath = 'C:\\Program Files\\bun\\bun.exe';
    const pathChecker = vi.fn(
      async (target: string) => target === expectedPath,
    );
    const multiline =
      `${expectedPath}\n` + 'C:\\Users\\me\\scoop\\shims\\bun.exe\n';
    const pathCommand = vi.fn(async () => multiline);

    const result = await resolveBunPath({
      platform: 'win32',
      moduleDir: 'C:/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand,
    });

    expect(result).toBe(expectedPath);
  });

  it('returns the first PATH line that passes executable validation', async () => {
    const pathChecker = vi.fn(
      async (target: string) => target === '/second/bun',
    );
    const pathCommand = vi.fn(async () => '/first/bun\n/second/bun\n');

    const result = await resolveBunPath({
      platform: 'linux',
      moduleDir: '/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand,
    });

    expect(result).toBe('/second/bun');
  });

  it('returns first executable non-empty path when where output has a leading blank line', async () => {
    const expectedPath = 'D:\\bun\\bun.exe';
    const pathChecker = vi.fn(
      async (target: string) => target === expectedPath,
    );
    const pathCommand = vi.fn(async () => `\n${expectedPath}\n`);

    const result = await resolveBunPath({
      platform: 'win32',
      moduleDir: 'C:/repo/packages/cli/src/launcher',
      pathChecker,
      pathCommand,
    });

    expect(result).toBe(expectedPath);
  });

  describe('direct dependency executable fallback (node_modules/bun/bin)', () => {
    it('POSIX: finds direct dependency executable when .bin is absent', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === '/repo/node_modules/bun/bin/bun.exe',
      );

      const result = await resolveBunPath({
        platform: 'linux',
        moduleDir: '/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand: vi.fn(async () => null),
      });

      expect(result).toBe('/repo/node_modules/bun/bin/bun.exe');
    });

    it('POSIX: .bin still wins over direct dependency and PATH', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === '/repo/node_modules/.bin/bun' ||
          target === '/repo/node_modules/bun/bin/bun.exe',
      );
      const pathCommand = vi.fn(async () => '/usr/local/bin/bun');

      const result = await resolveBunPath({
        platform: 'linux',
        moduleDir: '/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand,
      });

      expect(result).toBe('/repo/node_modules/.bin/bun');
      expect(pathCommand).not.toHaveBeenCalled();
    });

    it('POSIX: direct dependency wins over PATH when .bin is absent', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === '/repo/node_modules/bun/bin/bun.exe',
      );
      const pathCommand = vi.fn(async () => '/usr/local/bin/bun');

      const result = await resolveBunPath({
        platform: 'darwin',
        moduleDir: '/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand,
      });

      expect(result).toBe('/repo/node_modules/bun/bin/bun.exe');
      expect(pathCommand).not.toHaveBeenCalled();
    });

    it('Windows: finds direct dependency .exe when .bin is absent', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === 'C:/repo/node_modules/bun/bin/bun.exe',
      );

      const result = await resolveBunPath({
        platform: 'win32',
        moduleDir: 'C:/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand: vi.fn(async () => null),
      });

      expect(result).toBe('C:/repo/node_modules/bun/bin/bun.exe');
    });

    it('Windows: finds direct dependency bun.cmd when bun.exe is absent', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === 'C:/repo/node_modules/bun/bin/bun.cmd',
      );

      const result = await resolveBunPath({
        platform: 'win32',
        moduleDir: 'C:/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand: vi.fn(async () => null),
      });

      expect(result).toBe('C:/repo/node_modules/bun/bin/bun.cmd');
    });

    it('Windows: .bin bun.exe wins over direct dependency executable', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === 'C:/repo/node_modules/.bin/bun.exe' ||
          target === 'C:/repo/node_modules/bun/bin/bun.exe',
      );

      const result = await resolveBunPath({
        platform: 'win32',
        moduleDir: 'C:/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand: vi.fn(async () => null),
      });

      expect(result).toBe('C:/repo/node_modules/.bin/bun.exe');
    });

    it('Windows: .bin bun.cmd wins over direct dependency when only .cmd exists', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === 'C:/repo/node_modules/.bin/bun.cmd' ||
          target === 'C:/repo/node_modules/bun/bin/bun.exe',
      );

      const result = await resolveBunPath({
        platform: 'win32',
        moduleDir: 'C:/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand: vi.fn(async () => null),
      });

      expect(result).toBe('C:/repo/node_modules/.bin/bun.cmd');
    });

    it('Windows: direct dependency wins over PATH when .bin is absent', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === 'C:/repo/node_modules/bun/bin/bun.exe',
      );
      const pathCommand = vi.fn(async () => 'C:/bun/bun.exe');

      const result = await resolveBunPath({
        platform: 'win32',
        moduleDir: 'C:/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand,
      });

      expect(result).toBe('C:/repo/node_modules/bun/bin/bun.exe');
      expect(pathCommand).not.toHaveBeenCalled();
    });

    it('climbs ancestors probing direct dependency executable', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === '/repo/node_modules/bun/bin/bun.exe',
      );

      const result = await resolveBunPath({
        platform: 'linux',
        moduleDir: '/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand: vi.fn(async () => null),
      });

      expect(result).toBe('/repo/node_modules/bun/bin/bun.exe');
      expect(pathChecker).toHaveBeenCalledWith(
        '/repo/node_modules/bun/bin/bun.exe',
      );
    });

    it('does not probe direct dependency before .bin at the same ancestor level', async () => {
      const probes: string[] = [];
      const pathChecker = vi.fn(async (target: string) => {
        probes.push(target);
        return target === '/repo/node_modules/bun/bin/bun.exe';
      });

      await resolveBunPath({
        platform: 'linux',
        moduleDir: '/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand: vi.fn(async () => null),
      });

      const binIdx = probes.indexOf('/repo/node_modules/.bin/bun');
      const depIdx = probes.indexOf('/repo/node_modules/bun/bin/bun.exe');
      expect(binIdx).toBeGreaterThan(-1);
      expect(depIdx).toBeGreaterThan(-1);
      expect(binIdx).toBeLessThan(depIdx);
    });

    it('falls through to PATH when both .bin and direct dependency are absent', async () => {
      const pathChecker = vi.fn(
        async (target: string) => target === '/usr/local/bin/bun',
      );
      const pathCommand = vi.fn(async () => '/usr/local/bin/bun');

      const result = await resolveBunPath({
        platform: 'linux',
        moduleDir: '/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand,
      });

      expect(result).toBe('/usr/local/bin/bun');
    });
  });

  describe('Windows direct-executable (.exe) preference', () => {
    it('prefers bun.exe over bun.cmd when both exist in the same .bin dir', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === 'C:/repo/node_modules/.bin/bun.exe' ||
          target === 'C:/repo/node_modules/.bin/bun.cmd',
      );

      const result = await resolveBunPath({
        platform: 'win32',
        moduleDir: 'C:/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand: vi.fn(async () => null),
      });

      expect(result).toBe('C:/repo/node_modules/.bin/bun.exe');
    });

    it('does not probe bun.cmd in the same dir if bun.exe already resolved', async () => {
      const probes: string[] = [];
      const pathChecker = vi.fn(async (target: string) => {
        probes.push(target);
        return target === 'C:/repo/packages/cli/node_modules/.bin/bun.exe';
      });

      await resolveBunPath({
        platform: 'win32',
        moduleDir: 'C:/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand: vi.fn(async () => null),
      });

      // bun.exe was found at the nearest .bin, so bun.cmd in that same dir
      // must never be probed.
      expect(
        probes.filter(
          (p) => p === 'C:/repo/packages/cli/node_modules/.bin/bun.cmd',
        ),
      ).toHaveLength(0);
    });

    it('falls back to bun.cmd only when bun.exe is absent in the same .bin dir', async () => {
      const pathChecker = vi.fn(
        async (target: string) =>
          target === 'C:/repo/node_modules/.bin/bun.cmd',
      );

      const result = await resolveBunPath({
        platform: 'win32',
        moduleDir: 'C:/repo/packages/cli/src/launcher',
        pathChecker,
        pathCommand: vi.fn(async () => null),
      });

      expect(result).toBe('C:/repo/node_modules/.bin/bun.cmd');
    });
  });
});

describe('defaultPathCommand', () => {
  it('returns stdout when the command exits with code 0', async () => {
    const result = await defaultPathCommand(process.execPath, [
      '-e',
      'process.stdout.write("/usr/local/bin/bun\\n")',
    ]);

    expect(result).toBe('/usr/local/bin/bun\n');
  });

  it('returns null when the command is not found', async () => {
    const result = await defaultPathCommand(
      'definitely-not-a-real-command-xyz',
      ['bun'],
    );

    expect(result).toBeNull();
  });

  it('returns null when the command output exceeds the safety cap', async () => {
    const result = await defaultPathCommand(process.execPath, [
      '-e',
      'process.stdout.write("x".repeat(70000))',
    ]);

    expect(result).toBeNull();
  });

  it('returns null when which/where exits with non-zero code', async () => {
    const result = await defaultPathCommand(process.execPath, [
      '-e',
      'process.exit(1)',
    ]);

    expect(result).toBeNull();
  });

  it('returns null when the command times out', async () => {
    const result = await defaultPathCommand(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 500)'],
      { timeoutMs: 100 },
    );

    expect(result).toBeNull();
  });
});
