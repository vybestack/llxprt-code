/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { getInstallationInfo, PackageManager } from './installationInfo.js';
import { updateEventEmitter } from './updateEventEmitter.js';
import { UpdateObject } from '../ui/utils/updateCheck.js';
import { LoadedSettings } from '../config/settings.js';
import EventEmitter from 'node:events';
import { handleAutoUpdate } from './handleAutoUpdate.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('./installationInfo.js', async () => {
  const actual = await vi.importActual('./installationInfo.js');
  return {
    ...actual,
    getInstallationInfo: vi.fn(),
  };
});

vi.mock('./updateEventEmitter.js', async () => {
  const actual = await vi.importActual('./updateEventEmitter.js');
  return {
    ...actual,
    updateEventEmitter: {
      ...actual.updateEventEmitter,
      emit: vi.fn(),
    },
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    writeSync: vi.fn(),
    openSync: vi.fn(),
    closeSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
    readdirSync: vi.fn(),
    realpathSync: vi.fn(),
    constants: actual.constants,
  };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

interface MockChildProcess extends EventEmitter {
  stdin: EventEmitter & {
    write: Mock;
    end: Mock;
  };
  stderr: EventEmitter;
}

const mockGetInstallationInfo = vi.mocked(getInstallationInfo);
const mockUpdateEventEmitter = vi.mocked(updateEventEmitter);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const _mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockWriteSync = vi.mocked(fs.writeSync);
const mockOpenSync = vi.mocked(fs.openSync);
const mockCloseSync = vi.mocked(fs.closeSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockRealpathSync = vi.mocked(fs.realpathSync);
const mockHomedir = vi.mocked(os.homedir);

describe('handleAutoUpdate', () => {
  let mockSpawn: Mock;
  let mockUpdateInfo: UpdateObject;
  let mockSettings: LoadedSettings;
  let mockChildProcess: MockChildProcess;

  beforeEach(() => {
    mockSpawn = vi.fn();
    vi.clearAllMocks();
    mockUpdateInfo = {
      update: {
        latest: '2.0.0',
        current: '1.0.0',
        type: 'major',
        name: '@vybestack/llxprt-code',
      },
      message: 'An update is available!',
    };

    mockSettings = {
      merged: {
        disableAutoUpdate: false,
      },
    } as LoadedSettings;

    mockChildProcess = Object.assign(new EventEmitter(), {
      stdin: Object.assign(new EventEmitter(), {
        write: vi.fn(),
        end: vi.fn(),
      }),
      stderr: new EventEmitter(),
    }) as MockChildProcess;

    mockSpawn.mockReturnValue(
      mockChildProcess as unknown as ReturnType<typeof mockSpawn>,
    );

    // Default mock behavior
    mockHomedir.mockReturnValue('/home/test');
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockOpenSync.mockReturnValue(42); // Mock file descriptor
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should do nothing if update info is null', () => {
    handleAutoUpdate(null, mockSettings, '/root', mockSpawn);
    expect(mockGetInstallationInfo).not.toHaveBeenCalled();
    expect(mockUpdateEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('should do nothing if update nag is disabled', () => {
    mockSettings.merged.disableUpdateNag = true;
    handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);
    expect(mockGetInstallationInfo).not.toHaveBeenCalled();
    expect(mockUpdateEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('should emit "update-received" but not update if auto-updates are disabled', () => {
    mockSettings.merged.disableAutoUpdate = true;
    mockGetInstallationInfo.mockReturnValue({
      updateCommand: 'npm i -g @vybestack/llxprt-code@latest',
      updateMessage: 'Please update manually.',
      isGlobal: true,
      packageManager: PackageManager.NPM,
    });

    handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);

    expect(mockUpdateEventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mockUpdateEventEmitter.emit).toHaveBeenCalledWith(
      'update-received',
      {
        message: 'An update is available!\nPlease update manually.',
      },
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it.each([PackageManager.NPX, PackageManager.PNPX, PackageManager.BUNX])(
    'should suppress update notifications when running via %s',
    (packageManager) => {
      mockGetInstallationInfo.mockReturnValue({
        updateCommand: undefined,
        updateMessage: `Running via ${packageManager}, update not applicable.`,
        isGlobal: false,
        packageManager,
      });

      handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);

      expect(mockUpdateEventEmitter.emit).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    },
  );

  it('should emit "update-received" but not update if no update command is found', () => {
    mockGetInstallationInfo.mockReturnValue({
      updateCommand: undefined,
      updateMessage: 'Cannot determine update command.',
      isGlobal: false,
      packageManager: PackageManager.NPM,
    });

    handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);

    expect(mockUpdateEventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mockUpdateEventEmitter.emit).toHaveBeenCalledWith(
      'update-received',
      {
        message: 'An update is available!\nCannot determine update command.',
      },
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('should combine update messages correctly', () => {
    mockGetInstallationInfo.mockReturnValue({
      updateCommand: undefined, // No command to prevent spawn
      updateMessage: 'This is an additional message.',
      isGlobal: false,
      packageManager: PackageManager.NPM,
    });

    handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);

    expect(mockUpdateEventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mockUpdateEventEmitter.emit).toHaveBeenCalledWith(
      'update-received',
      {
        message: 'An update is available!\nThis is an additional message.',
      },
    );
  });

  it('should attempt to perform an update when conditions are met', async () => {
    mockGetInstallationInfo.mockReturnValue({
      updateCommand: 'npm i -g @vybestack/llxprt-code@latest',
      updateMessage: 'This is an additional message.',
      isGlobal: false,
      packageManager: PackageManager.NPM,
    });

    // Simulate successful execution
    setTimeout(() => {
      mockChildProcess.emit('close', 0);
    }, 0);

    handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);

    expect(mockSpawn).toHaveBeenCalledOnce();
  });

  it('should emit "update-failed" when the update process fails', async () => {
    await new Promise<void>((resolve) => {
      mockGetInstallationInfo.mockReturnValue({
        updateCommand: 'npm i -g @vybestack/llxprt-code@latest',
        updateMessage: 'This is an additional message.',
        isGlobal: false,
        packageManager: PackageManager.NPM,
      });

      // Simulate failed execution
      setTimeout(() => {
        mockChildProcess.stderr.emit('data', 'An error occurred');
        mockChildProcess.emit('close', 1);
        resolve();
      }, 0);

      handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);
    });

    expect(mockUpdateEventEmitter.emit).toHaveBeenCalledWith('update-failed', {
      message:
        'Automatic update failed. Please try updating manually. (command: npm i -g @vybestack/llxprt-code@2.0.0, stderr: An error occurred)',
    });
  });

  it('should emit "update-failed" when the spawn function throws an error', async () => {
    await new Promise<void>((resolve) => {
      mockGetInstallationInfo.mockReturnValue({
        updateCommand: 'npm i -g @vybestack/llxprt-code@latest',
        updateMessage: 'This is an additional message.',
        isGlobal: false,
        packageManager: PackageManager.NPM,
      });

      // Simulate an error event
      setTimeout(() => {
        mockChildProcess.emit('error', new Error('Spawn error'));
        resolve();
      }, 0);

      handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);
    });

    expect(mockUpdateEventEmitter.emit).toHaveBeenCalledWith('update-failed', {
      message:
        'Automatic update failed. Please try updating manually. (error: Spawn error)',
    });
  });

  it('should use the "@nightly" tag for nightly updates', async () => {
    mockUpdateInfo.update.latest = '2.0.0-nightly';
    mockGetInstallationInfo.mockReturnValue({
      updateCommand: 'npm i -g @vybestack/llxprt-code@latest',
      updateMessage: 'This is an additional message.',
      isGlobal: false,
      packageManager: PackageManager.NPM,
    });

    handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);

    expect(mockSpawn).toHaveBeenCalledWith(
      'npm i -g @vybestack/llxprt-code@nightly',
      {
        shell: true,
        stdio: 'pipe',
      },
    );
  });

  it('should emit "update-success" when the update process succeeds', async () => {
    await new Promise<void>((resolve) => {
      mockGetInstallationInfo.mockReturnValue({
        updateCommand: 'npm i -g @vybestack/llxprt-code@latest',
        updateMessage: 'This is an additional message.',
        isGlobal: false,
        packageManager: PackageManager.NPM,
      });

      // Simulate successful execution
      setTimeout(() => {
        mockChildProcess.emit('close', 0);
        resolve();
      }, 0);

      handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);
    });

    expect(mockUpdateEventEmitter.emit).toHaveBeenCalledWith('update-success', {
      message:
        'Update successful! The new version will be used on your next run.',
    });
  });

  describe('lock file mechanism', () => {
    it('should skip auto-update if lock file exists and is recent', () => {
      mockGetInstallationInfo.mockReturnValue({
        updateCommand: 'npm i -g @vybestack/llxprt-code@latest',
        updateMessage: 'This is an additional message.',
        isGlobal: true,
        packageManager: PackageManager.NPM,
      });

      const lockFilePath = path.join(
        '/home/test',
        '.llxprt',
        'locks',
        'cli-update.lock',
      );
      const recentLockData = JSON.stringify({
        timestamp: Date.now() - 1000, // 1 second ago
        pid: process.pid,
      });

      mockExistsSync.mockImplementation((p) => p === lockFilePath);
      mockReadFileSync.mockReturnValue(recentLockData);
      // Simulate atomic lock acquisition failure (EEXIST)
      const eexistError = new Error('EEXIST') as NodeJS.ErrnoException;
      eexistError.code = 'EEXIST';
      mockOpenSync.mockImplementation(() => {
        throw eexistError;
      });

      handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);

      expect(mockUpdateEventEmitter.emit).toHaveBeenCalledWith('update-info', {
        message: 'Another update is already in progress. Skipping auto-update.',
      });
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should acquire lock and release it after update completes', async () => {
      await new Promise<void>((resolve) => {
        mockGetInstallationInfo.mockReturnValue({
          updateCommand: 'npm i -g @vybestack/llxprt-code@latest',
          updateMessage: 'This is an additional message.',
          isGlobal: true,
          packageManager: PackageManager.NPM,
        });

        const lockFilePath = path.join(
          '/home/test',
          '.llxprt',
          'locks',
          'cli-update.lock',
        );
        mockExistsSync.mockReturnValue(false);
        mockOpenSync.mockReturnValue(42);

        setTimeout(() => {
          mockChildProcess.emit('close', 0);
          resolve();
        }, 0);

        handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);

        // Verify lock was created atomically
        expect(mockMkdirSync).toHaveBeenCalledWith(
          path.join('/home/test', '.llxprt', 'locks'),
          { recursive: true },
        );
        expect(mockOpenSync).toHaveBeenCalledWith(
          lockFilePath,
          fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        );
        expect(mockWriteSync).toHaveBeenCalledWith(42, expect.any(String));
        expect(mockCloseSync).toHaveBeenCalledWith(42);
      });

      // Verify lock was released after completion
      const lockFilePath = path.join(
        '/home/test',
        '.llxprt',
        'locks',
        'cli-update.lock',
      );
      expect(mockUnlinkSync).toHaveBeenCalledWith(lockFilePath);
    });

    it('should release lock even if update fails', async () => {
      const lockFilePath = path.join(
        '/home/test',
        '.llxprt',
        'locks',
        'cli-update.lock',
      );

      await new Promise<void>((resolve) => {
        mockGetInstallationInfo.mockReturnValue({
          updateCommand: 'npm i -g @vybestack/llxprt-code@latest',
          updateMessage: 'This is an additional message.',
          isGlobal: true,
          packageManager: PackageManager.NPM,
        });

        mockExistsSync.mockReturnValue(false);
        mockOpenSync.mockReturnValue(42);

        setTimeout(() => {
          mockChildProcess.stderr.emit('data', 'An error occurred');
          mockChildProcess.emit('close', 1);
          resolve();
        }, 0);

        handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);
      });

      // Verify lock was released after failure
      expect(mockUnlinkSync).toHaveBeenCalledWith(lockFilePath);
    });

    it('should ignore stale lock files (older than 5 minutes)', () => {
      mockGetInstallationInfo.mockReturnValue({
        updateCommand: 'npm i -g @vybestack/llxprt-code@latest',
        updateMessage: 'This is an additional message.',
        isGlobal: true,
        packageManager: PackageManager.NPM,
      });

      const lockFilePath = path.join(
        '/home/test',
        '.llxprt',
        'locks',
        'cli-update.lock',
      );
      const staleLockData = JSON.stringify({
        timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago
        pid: 99999, // Non-existent PID
      });

      mockExistsSync.mockImplementation((p) => p === lockFilePath);
      mockReadFileSync.mockReturnValue(staleLockData);
      mockOpenSync.mockReturnValue(42);

      setTimeout(() => {
        mockChildProcess.emit('close', 0);
      }, 0);

      handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);

      // Should proceed with update since lock is stale
      expect(mockSpawn).toHaveBeenCalled();
      // Should clean up stale lock and create new one atomically
      expect(mockUnlinkSync).toHaveBeenCalledWith(lockFilePath);
      expect(mockOpenSync).toHaveBeenCalledWith(
        lockFilePath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      );
    });
  });

  describe('temp directory detection', () => {
    it('should skip auto-update if temp directories from previous failed install exist', () => {
      mockGetInstallationInfo.mockReturnValue({
        updateCommand: 'npm i -g @vybestack/llxprt-code@latest',
        updateMessage: 'This is an additional message.',
        isGlobal: true,
        packageManager: PackageManager.NPM,
      });

      // Mock process.argv[1] to simulate installation path
      const originalArgv1 = process.argv[1];
      const testPath =
        '/usr/local/lib/node_modules/@vybestack/llxprt-code/dist/index.js';
      process.argv[1] = testPath;

      mockRealpathSync.mockReturnValue(testPath);
      mockReaddirSync.mockReturnValue([
        '.llxprt-code-abc123',
        '@vybestack',
        'some-other-package',
      ] as unknown as fs.Dirent[]);

      handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);

      expect(mockUpdateEventEmitter.emit).toHaveBeenCalledWith('update-info', {
        message: expect.stringContaining(
          'Temporary directories from a previous failed update were detected',
        ),
      });
      expect(mockSpawn).not.toHaveBeenCalled();

      // Restore
      process.argv[1] = originalArgv1;
    });

    it('should emit update-info message suggesting cleanup when temp dirs exist', () => {
      mockGetInstallationInfo.mockReturnValue({
        updateCommand: 'npm i -g @vybestack/llxprt-code@latest',
        updateMessage: 'This is an additional message.',
        isGlobal: true,
        packageManager: PackageManager.NPM,
      });

      const originalArgv1 = process.argv[1];
      const testPath =
        '/usr/local/lib/node_modules/@vybestack/llxprt-code/dist/index.js';
      process.argv[1] = testPath;

      mockRealpathSync.mockReturnValue(testPath);
      mockReaddirSync.mockReturnValue([
        '.llxprt-code-temp',
        '@vybestack',
      ] as unknown as fs.Dirent[]);

      handleAutoUpdate(mockUpdateInfo, mockSettings, '/root', mockSpawn);

      // Platform-appropriate cleanup command (rm -rf for Unix, rmdir /s /q for Windows)
      const expectedCommand =
        process.platform === 'win32' ? 'rmdir /s /q' : 'rm -rf';
      expect(mockUpdateEventEmitter.emit).toHaveBeenCalledWith('update-info', {
        message: expect.stringContaining(expectedCommand),
      });

      process.argv[1] = originalArgv1;
    });
  });
});
