/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { getInstallationInfo, PackageManager } from './installationInfo.js';
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { isGitRepository } from '@vybestack/llxprt-code-core';

const { mockDebugLogger } = {
  mockDebugLogger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
  },
};

vi.mock('@vybestack/llxprt-code-core', () => ({
  isGitRepository: vi.fn(),
}));

const actual = { ...(await import('@vybestack/llxprt-code-telemetry')) };
vi.mock('@vybestack/llxprt-code-telemetry', () => {
  return {
    ...actual,
    debugLogger: mockDebugLogger,
  };
});

const actualFs = { ...(await import('fs')) };
vi.mock('fs', () => {
  return {
    ...actualFs,
    realpathSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

const actualActual = { ...(await import('child_process')) };
vi.mock('child_process', () => {
  return {
    ...actualActual,
    execSync: vi.fn(),
  };
});

const mockedIsGitRepository = isGitRepository as Mock<typeof isGitRepository>;
const mockedRealPathSync = fs.realpathSync as Mock<typeof fs.realpathSync>;
const mockedExistsSync = fs.existsSync as Mock<typeof fs.existsSync>;
const mockedExecSync = childProcess.execSync as Mock<
  typeof childProcess.execSync
>;

describe('getInstallationInfo', () => {
  const projectRoot = '/path/to/project';
  let originalArgv: string[];
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    vi.resetAllMocks();
    originalArgv = [...process.argv];
    originalPlatform = process.platform;
    // Mock process.cwd() for isGitRepository
    vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
  });

  afterEach(() => {
    process.argv = originalArgv;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('should return UNKNOWN when cliPath is not available', () => {
    process.argv[1] = '';
    const info = getInstallationInfo(projectRoot, true);
    expect(info.packageManager).toBe(PackageManager.UNKNOWN);
  });

  it('should return UNKNOWN and log error if realpathSync fails', () => {
    process.argv[1] = '/path/to/cli';
    const error = new Error('realpath failed');
    mockedRealPathSync.mockImplementation(() => {
      throw error;
    });

    const info = getInstallationInfo(projectRoot, true);

    expect(info.packageManager).toBe(PackageManager.UNKNOWN);
    expect(mockDebugLogger.log).toHaveBeenCalledWith(String(error));
  });

  it('should detect running from a local git clone', () => {
    process.argv[1] = `${projectRoot}/packages/cli/dist/index.js`;
    mockedRealPathSync.mockReturnValue(
      `${projectRoot}/packages/cli/dist/index.js`,
    );
    mockedIsGitRepository.mockReturnValue(true);

    const info = getInstallationInfo(projectRoot, true);

    expect(info.packageManager).toBe(PackageManager.UNKNOWN);
    expect(info.isGlobal).toBe(false);
    expect(info.updateMessage).toBe(
      'Running from a local git clone. Please update with "git pull".',
    );
  });

  it('should detect running via npx', () => {
    const npxPath = `/Users/test/.npm/_npx/12345/bin/gemini`;
    process.argv[1] = npxPath;
    mockedRealPathSync.mockReturnValue(npxPath);

    const info = getInstallationInfo(projectRoot, true);

    expect(info.packageManager).toBe(PackageManager.NPX);
    expect(info.isGlobal).toBe(false);
    expect(info.updateMessage).toBe('Running via npx, update not applicable.');
  });

  it('should detect running via pnpx', () => {
    const pnpxPath = `/Users/test/.pnpm/_pnpx/12345/bin/gemini`;
    process.argv[1] = pnpxPath;
    mockedRealPathSync.mockReturnValue(pnpxPath);

    const info = getInstallationInfo(projectRoot, true);

    expect(info.packageManager).toBe(PackageManager.PNPX);
    expect(info.isGlobal).toBe(false);
    expect(info.updateMessage).toBe('Running via pnpx, update not applicable.');
  });

  it('should detect running via bunx', () => {
    const bunxPath = `/Users/test/.bun/install/cache/12345/bin/gemini`;
    process.argv[1] = bunxPath;
    mockedRealPathSync.mockReturnValue(bunxPath);
    mockedExecSync.mockImplementation(() => {
      throw new Error('Command failed');
    });

    const info = getInstallationInfo(projectRoot, true);

    expect(info.packageManager).toBe(PackageManager.BUNX);
    expect(info.isGlobal).toBe(false);
    expect(info.updateMessage).toBe('Running via bunx, update not applicable.');
  });

  it('should detect Homebrew installation via execSync', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    });
    // Use a path that matches what brew would resolve to
    const cliPath = '/opt/homebrew/Cellar/llxprt-code/1.0.0/bin/llxprt';
    process.argv[1] = cliPath;

    mockedExecSync.mockImplementation((cmd) => {
      if (
        typeof cmd === 'string' &&
        cmd.includes('brew --prefix llxprt-code')
      ) {
        return '/opt/homebrew/opt/llxprt-code';
      }
      throw new Error(`Command failed: ${cmd}`);
    });

    mockedRealPathSync.mockImplementation((p) => {
      if (p === cliPath) return cliPath;
      if (p === '/opt/homebrew/opt/llxprt-code') {
        return '/opt/homebrew/Cellar/llxprt-code/1.0.0';
      }
      return String(p);
    });

    const info = getInstallationInfo(projectRoot, true);

    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.stringContaining('brew --prefix llxprt-code'),
      expect.anything(),
    );
    expect(info.packageManager).toBe(PackageManager.HOMEBREW);
    expect(info.isGlobal).toBe(true);
    expect(info.updateMessage).toContain('brew upgrade');
  });

  it('should fall through if brew command fails', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    });
    const cliPath = '/usr/local/bin/llxprt';
    process.argv[1] = cliPath;
    mockedRealPathSync.mockReturnValue(cliPath);
    mockedExecSync.mockImplementation(() => {
      throw new Error('Command failed');
    });

    const info = getInstallationInfo(projectRoot, true);

    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.stringContaining('brew --prefix llxprt-code'),
      expect.anything(),
    );
    // Should fall back to default global npm
    expect(info.packageManager).toBe(PackageManager.NPM);
    expect(info.isGlobal).toBe(true);
  });

  it('should detect global pnpm installation', () => {
    const pnpmPath = `/Users/test/.pnpm/global/5/node_modules/.pnpm/some-hash/node_modules/@vybestack/llxprt-code/dist/index.js`;
    process.argv[1] = pnpmPath;
    mockedRealPathSync.mockReturnValue(pnpmPath);
    mockedExecSync.mockImplementation(() => {
      throw new Error('Command failed');
    });

    const info = getInstallationInfo(projectRoot, true);
    expect(info.packageManager).toBe(PackageManager.PNPM);
    expect(info.isGlobal).toBe(true);
    expect(info.updateCommand).toBe(
      'pnpm add -g @vybestack/llxprt-code@latest',
    );
    expect(info.updateMessage).toContain('Attempting to automatically update');

    const infoDisabled = getInstallationInfo(projectRoot, false);
    expect(infoDisabled.updateMessage).toContain('Please run pnpm add');
  });

  it('should detect global yarn installation', () => {
    const yarnPath = `/Users/test/.yarn/global/node_modules/@vybestack/llxprt-code/dist/index.js`;
    process.argv[1] = yarnPath;
    mockedRealPathSync.mockReturnValue(yarnPath);
    mockedExecSync.mockImplementation(() => {
      throw new Error('Command failed');
    });

    const info = getInstallationInfo(projectRoot, true);
    expect(info.packageManager).toBe(PackageManager.YARN);
    expect(info.isGlobal).toBe(true);
    expect(info.updateCommand).toBe(
      'yarn global add @vybestack/llxprt-code@latest',
    );
    expect(info.updateMessage).toContain('Attempting to automatically update');

    const infoDisabled = getInstallationInfo(projectRoot, false);
    expect(infoDisabled.updateMessage).toContain('Please run yarn global add');
  });

  it('should detect global bun installation', () => {
    const bunPath = `/Users/test/.bun/bin/gemini`;
    process.argv[1] = bunPath;
    mockedRealPathSync.mockReturnValue(bunPath);
    mockedExecSync.mockImplementation(() => {
      throw new Error('Command failed');
    });

    const info = getInstallationInfo(projectRoot, true);
    expect(info.packageManager).toBe(PackageManager.BUN);
    expect(info.isGlobal).toBe(true);
    expect(info.updateCommand).toBe('bun add -g @vybestack/llxprt-code@latest');
    expect(info.updateMessage).toContain('Attempting to automatically update');

    const infoDisabled = getInstallationInfo(projectRoot, false);
    expect(infoDisabled.updateMessage).toContain('Please run bun add');
  });

  it('should detect local installation and identify yarn from lockfile', () => {
    const localPath = `${projectRoot}/node_modules/.bin/gemini`;
    process.argv[1] = localPath;
    mockedRealPathSync.mockReturnValue(localPath);
    mockedExecSync.mockImplementation(() => {
      throw new Error('Command failed');
    });
    mockedExistsSync.mockImplementation(
      (p) => p === path.join(projectRoot, 'yarn.lock'),
    );

    const info = getInstallationInfo(projectRoot, true);

    expect(info.packageManager).toBe(PackageManager.YARN);
    expect(info.isGlobal).toBe(false);
    expect(info.updateMessage).toContain('Locally installed');
  });

  it('should detect local installation and identify pnpm from lockfile', () => {
    const localPath = `${projectRoot}/node_modules/.bin/gemini`;
    process.argv[1] = localPath;
    mockedRealPathSync.mockReturnValue(localPath);
    mockedExecSync.mockImplementation(() => {
      throw new Error('Command failed');
    });
    mockedExistsSync.mockImplementation(
      (p) => p === path.join(projectRoot, 'pnpm-lock.yaml'),
    );

    const info = getInstallationInfo(projectRoot, true);

    expect(info.packageManager).toBe(PackageManager.PNPM);
    expect(info.isGlobal).toBe(false);
  });

  it('should detect local installation and identify bun from lockfile', () => {
    const localPath = `${projectRoot}/node_modules/.bin/gemini`;
    process.argv[1] = localPath;
    mockedRealPathSync.mockReturnValue(localPath);
    mockedExecSync.mockImplementation(() => {
      throw new Error('Command failed');
    });
    mockedExistsSync.mockImplementation(
      (p) => p === path.join(projectRoot, 'bun.lockb'),
    );

    const info = getInstallationInfo(projectRoot, true);

    expect(info.packageManager).toBe(PackageManager.BUN);
    expect(info.isGlobal).toBe(false);
  });

  it('should default to local npm installation if no lockfile is found', () => {
    const localPath = `${projectRoot}/node_modules/.bin/gemini`;
    process.argv[1] = localPath;
    mockedRealPathSync.mockReturnValue(localPath);
    mockedExecSync.mockImplementation(() => {
      throw new Error('Command failed');
    });
    mockedExistsSync.mockReturnValue(false); // No lockfiles

    const info = getInstallationInfo(projectRoot, true);

    expect(info.packageManager).toBe(PackageManager.NPM);
    expect(info.isGlobal).toBe(false);
  });

  it('should default to global npm installation for unrecognized paths', () => {
    const globalPath = `/usr/local/bin/gemini`;
    process.argv[1] = globalPath;
    mockedRealPathSync.mockReturnValue(globalPath);
    mockedExecSync.mockImplementation(() => {
      throw new Error('Command failed');
    });

    const info = getInstallationInfo(projectRoot, true);
    expect(info.packageManager).toBe(PackageManager.NPM);
    expect(info.isGlobal).toBe(true);
    expect(info.updateCommand).toBe(
      'npm install -g @vybestack/llxprt-code@latest',
    );
    expect(info.updateMessage).toContain('Attempting to automatically update');

    const infoDisabled = getInstallationInfo(projectRoot, false);
    expect(infoDisabled.updateMessage).toContain('Please run npm install');
  });

  describe('Homebrew global npm path detection', () => {
    it('should detect Homebrew global npm path and return message-only', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
      });
      const homebrewNpmPath = `/opt/homebrew/lib/node_modules/@vybestack/llxprt-code/dist/index.js`;
      process.argv[1] = homebrewNpmPath;
      mockedRealPathSync.mockReturnValue(homebrewNpmPath);
      mockedExecSync.mockImplementation(() => {
        throw new Error('brew not found');
      });

      const info = getInstallationInfo(projectRoot, true);

      expect(info.packageManager).toBe(PackageManager.NPM);
      expect(info.isGlobal).toBe(true);
      expect(info.updateCommand).toBeUndefined();
      expect(info.updateMessage).toContain('Homebrew-managed npm');
      expect(info.updateMessage).toContain('brew upgrade node');
    });

    it('should detect /opt/homebrew path even without brew command available', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
      });
      const homebrewPath = `/opt/homebrew/lib/node_modules/@vybestack/llxprt-code/dist/index.js`;
      process.argv[1] = homebrewPath;
      mockedRealPathSync.mockReturnValue(homebrewPath);
      mockedExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const info = getInstallationInfo(projectRoot, true);

      // Should still detect Homebrew npm even if brew command fails
      expect(info.packageManager).toBe(PackageManager.NPM);
      expect(info.isGlobal).toBe(true);
      expect(info.updateCommand).toBeUndefined();
      expect(info.updateMessage).toContain('Homebrew-managed npm');
    });
  });

  it('should NOT detect Homebrew if llxprt-code is installed in brew but running from npm location', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
    });
    // Path looks like standard global NPM
    const cliPath =
      '/usr/local/lib/node_modules/@vybestack/llxprt-code/dist/index.js';
    process.argv[1] = cliPath;

    // Brew prefix succeeds but path doesn't match
    mockedExecSync.mockImplementation((cmd) => {
      if (
        typeof cmd === 'string' &&
        cmd.includes('brew --prefix llxprt-code')
      ) {
        return '/opt/homebrew/opt/llxprt-code';
      }
      throw new Error(`Command failed: ${cmd}`);
    });

    mockedRealPathSync.mockImplementation((p) => {
      if (p === cliPath) return cliPath;
      if (p === '/opt/homebrew/opt/llxprt-code') {
        return '/opt/homebrew/Cellar/llxprt-code/1.0.0';
      }
      return String(p);
    });

    const info = getInstallationInfo(projectRoot, false);

    expect(info.packageManager).not.toBe(PackageManager.HOMEBREW);
    expect(info.packageManager).toBe(PackageManager.NPM);
  });
});
