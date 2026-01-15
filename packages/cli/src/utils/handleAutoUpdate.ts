/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UpdateObject } from '../ui/utils/updateCheck.js';
import { LoadedSettings } from '../config/settings.js';
import { getInstallationInfo, PackageManager } from './installationInfo.js';
import { updateEventEmitter } from './updateEventEmitter.js';
import { HistoryItem, MessageType } from '../ui/types.js';
import { spawnWrapper } from './spawnWrapper.js';
import { spawn } from 'child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { constants } from 'node:fs';

const LOCK_FILE_NAME = 'cli-update.lock';
const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes

function isLockStale(lockFilePath: string): boolean {
  try {
    const lockContent = fs.readFileSync(lockFilePath, 'utf-8');
    const lockData = JSON.parse(lockContent);
    const now = Date.now();

    // Check if lock is older than 5 minutes
    if (now - lockData.timestamp >= LOCK_STALE_MS) {
      return true;
    }

    // Check if the locking process is still alive
    // PID must be a positive number (PID 0 is kernel scheduler, not a valid updater)
    if (typeof lockData.pid === 'number' && lockData.pid > 0) {
      try {
        process.kill(lockData.pid, 0);
        // Process exists, lock is valid
        return false;
      } catch {
        // Process doesn't exist, lock is stale
        return true;
      }
    }

    // No valid PID in lock data, treat as stale
    return true;
  } catch {
    // Can't read lock file, treat as stale
    return true;
  }
}

function tryAcquireLock(): string | null {
  const homeDir = os.homedir();
  const locksDir = path.join(homeDir, '.llxprt', 'locks');
  const lockFilePath = path.join(locksDir, LOCK_FILE_NAME);

  try {
    fs.mkdirSync(locksDir, { recursive: true });

    // Check if lock exists and is stale
    if (fs.existsSync(lockFilePath)) {
      if (isLockStale(lockFilePath)) {
        // Remove stale lock
        try {
          fs.unlinkSync(lockFilePath);
        } catch {
          // Ignore errors removing stale lock
        }
      } else {
        // Lock exists and is valid
        return null;
      }
    }

    // Try to create lock file atomically using O_EXCL flag
    const lockData = JSON.stringify({
      timestamp: Date.now(),
      pid: process.pid,
    });

    const fd = fs.openSync(
      lockFilePath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    );
    try {
      fs.writeSync(fd, lockData);
    } finally {
      fs.closeSync(fd);
    }

    return lockFilePath;
  } catch (error) {
    // If EEXIST, another process created the lock between our check and creation
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return null;
    }
    // For other errors, log and proceed without lock
    return null;
  }
}

function releaseLock(lockFilePath: string): void {
  try {
    fs.unlinkSync(lockFilePath);
  } catch {
    // Ignore errors releasing lock
  }
}

function checkForTempDirectories(): string[] {
  const cliPath = process.argv[1];
  if (!cliPath) {
    return [];
  }

  try {
    const realPath = fs.realpathSync(cliPath);
    // Cross-platform regex for node_modules path
    const nodeModulesMatch = realPath.match(/(.*[\\/]node_modules)[\\/]/);

    if (!nodeModulesMatch) {
      return [];
    }

    const nodeModulesParent = path.dirname(nodeModulesMatch[1]);
    const entries = fs.readdirSync(nodeModulesParent);

    return entries.filter((entry) => entry.startsWith('.llxprt-code-'));
  } catch {
    return [];
  }
}

export function handleAutoUpdate(
  info: UpdateObject | null,
  settings: LoadedSettings,
  projectRoot: string,
  spawnFn: typeof spawn = spawnWrapper,
) {
  if (!info) {
    return;
  }

  if (settings.merged.disableUpdateNag) {
    return;
  }

  const installationInfo = getInstallationInfo(
    projectRoot,
    settings.merged.disableAutoUpdate ?? false,
  );

  if (
    [PackageManager.NPX, PackageManager.PNPX, PackageManager.BUNX].includes(
      installationInfo.packageManager,
    )
  ) {
    return;
  }

  let combinedMessage = info.message;
  if (installationInfo.updateMessage) {
    combinedMessage += `\n${installationInfo.updateMessage}`;
  }

  updateEventEmitter.emit('update-received', {
    message: combinedMessage,
  });

  if (!installationInfo.updateCommand || settings.merged.disableAutoUpdate) {
    return;
  }

  // Check for temp directories
  const tempDirs = checkForTempDirectories();
  if (tempDirs.length > 0) {
    const cliPath = process.argv[1];
    if (!cliPath) {
      return;
    }
    const realPath = fs.realpathSync(cliPath);
    // Cross-platform regex for node_modules path
    const nodeModulesMatch = realPath.match(/(.*[\\/]node_modules)[\\/]/);
    const cleanupPath = nodeModulesMatch
      ? path.dirname(nodeModulesMatch[1])
      : 'the parent directory of node_modules';

    // Platform-appropriate cleanup command
    const isWindows = process.platform === 'win32';
    const cleanupCommand = isWindows
      ? `rmdir /s /q ${tempDirs.map((d) => path.join(cleanupPath, d)).join(' ')}`
      : `rm -rf ${tempDirs.map((d) => path.join(cleanupPath, d)).join(' ')}`;

    updateEventEmitter.emit('update-info', {
      message: `Temporary directories from a previous failed update were detected. Please clean them up manually:\n  ${cleanupCommand}`,
    });
    return;
  }

  // Try to acquire lock atomically
  const lockFilePath = tryAcquireLock();
  if (!lockFilePath) {
    updateEventEmitter.emit('update-info', {
      message: 'Another update is already in progress. Skipping auto-update.',
    });
    return;
  }

  // Set up signal handlers to release lock on process termination
  const cleanupLock = () => {
    releaseLock(lockFilePath);
  };
  process.once('SIGTERM', cleanupLock);
  process.once('SIGINT', cleanupLock);

  const isNightly = info.update.latest.includes('nightly');
  const updateCommand = installationInfo.updateCommand.replace(
    '@latest',
    isNightly ? '@nightly' : `@${info.update.latest}`,
  );

  const updateProcess = spawnFn(updateCommand, { stdio: 'pipe', shell: true });
  let errorOutput = '';

  updateProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });

  updateProcess.on('close', (code) => {
    process.off('SIGTERM', cleanupLock);
    process.off('SIGINT', cleanupLock);
    releaseLock(lockFilePath);

    if (code === 0) {
      updateEventEmitter.emit('update-success', {
        message:
          'Update successful! The new version will be used on your next run.',
      });
    } else {
      updateEventEmitter.emit('update-failed', {
        message: `Automatic update failed. Please try updating manually. (command: ${updateCommand}, stderr: ${errorOutput.trim()})`,
      });
    }
  });

  updateProcess.on('error', (err) => {
    process.off('SIGTERM', cleanupLock);
    process.off('SIGINT', cleanupLock);
    releaseLock(lockFilePath);
    updateEventEmitter.emit('update-failed', {
      message: `Automatic update failed. Please try updating manually. (error: ${err.message})`,
    });
  });

  return updateProcess;
}

export function setUpdateHandler(
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
  setUpdateInfo: (info: UpdateObject | null) => void,
) {
  let successfullyInstalled = false;
  const handleUpdateReceived = (info: UpdateObject) => {
    setUpdateInfo(info);
    const savedMessage = info.message;
    setTimeout(() => {
      if (!successfullyInstalled) {
        addItem(
          {
            type: MessageType.INFO,
            text: savedMessage,
          },
          Date.now(),
        );
      }
      setUpdateInfo(null);
    }, 60000);
  };

  const handleUpdateFailed = () => {
    setUpdateInfo(null);
    addItem(
      {
        type: MessageType.ERROR,
        text: `Automatic update failed. Please try updating manually`,
      },
      Date.now(),
    );
  };

  const handleUpdateSuccess = () => {
    successfullyInstalled = true;
    setUpdateInfo(null);
    addItem(
      {
        type: MessageType.INFO,
        text: `Update successful! The new version will be used on your next run.`,
      },
      Date.now(),
    );
  };

  const handleUpdateInfo = (data: { message: string }) => {
    addItem(
      {
        type: MessageType.INFO,
        text: data.message,
      },
      Date.now(),
    );
  };

  updateEventEmitter.on('update-received', handleUpdateReceived);
  updateEventEmitter.on('update-failed', handleUpdateFailed);
  updateEventEmitter.on('update-success', handleUpdateSuccess);
  updateEventEmitter.on('update-info', handleUpdateInfo);

  return () => {
    updateEventEmitter.off('update-received', handleUpdateReceived);
    updateEventEmitter.off('update-failed', handleUpdateFailed);
    updateEventEmitter.off('update-success', handleUpdateSuccess);
    updateEventEmitter.off('update-info', handleUpdateInfo);
  };
}
