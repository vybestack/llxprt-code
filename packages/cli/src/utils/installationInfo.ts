/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy CLI boundary retained while larger decomposition continues. */

import { isGitRepository, debugLogger } from '@vybestack/llxprt-code-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';
import process from 'node:process';

export const isDevelopment = process.env['NODE_ENV'] === 'development';

export enum PackageManager {
  NPM = 'npm',
  YARN = 'yarn',
  PNPM = 'pnpm',
  PNPX = 'pnpx',
  BUN = 'bun',
  BUNX = 'bunx',
  HOMEBREW = 'homebrew',
  NPX = 'npx',
  UNKNOWN = 'unknown',
}

export interface InstallationInfo {
  packageManager: PackageManager;
  isGlobal: boolean;
  updateCommand?: string;
  updateMessage?: string;
}

function checkHomebrewInstall(
  realPath: string,
  isAutoUpdateEnabled: boolean,
): InstallationInfo | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const brewPrefix = childProcess
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
      .execSync('brew --prefix llxprt-code', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .trim();
    const brewRealPath = fs.realpathSync(brewPrefix);

    if (realPath.startsWith(brewRealPath)) {
      const updateCommand = 'brew upgrade llxprt-code';
      return {
        packageManager: PackageManager.HOMEBREW,
        isGlobal: true,
        updateCommand,
        updateMessage: !isAutoUpdateEnabled
          ? `Please run "${updateCommand}" to update`
          : `Installed via Homebrew. Attempting to automatically update via "${updateCommand}"...`,
      };
    }
  } catch {
    // Brew not installed or llxprt-code not installed via brew - continue to next check
  }

  // Check for Homebrew-managed npm global install
  if (
    realPath.includes('/opt/homebrew/lib/node_modules/') ||
    realPath.includes('/usr/local/lib/node_modules/')
  ) {
    return {
      packageManager: PackageManager.NPM,
      isGlobal: true,
      updateMessage:
        'Installed in Homebrew-managed npm global directory. Auto-update disabled. Please update Node.js via "brew upgrade node" or manually reinstall with "npm install -g @vybestack/llxprt-code@latest".',
    };
  }

  return null;
}

function checkNpxPnpxInstall(realPath: string): InstallationInfo | null {
  if (realPath.includes('/.npm/_npx') || realPath.includes('/npm/_npx')) {
    return {
      packageManager: PackageManager.NPX,
      isGlobal: false,
      updateMessage: 'Running via npx, update not applicable.',
    };
  }
  if (realPath.includes('/.pnpm/_pnpx')) {
    return {
      packageManager: PackageManager.PNPX,
      isGlobal: false,
      updateMessage: 'Running via pnpx, update not applicable.',
    };
  }
  return null;
}

function checkPackageManagerByPath(
  realPath: string,
  isAutoUpdateEnabled: boolean,
): InstallationInfo | null {
  if (realPath.includes('/.pnpm/global')) {
    const updateCommand = 'pnpm add -g @vybestack/llxprt-code@latest';
    return {
      packageManager: PackageManager.PNPM,
      isGlobal: true,
      updateCommand,
      updateMessage: !isAutoUpdateEnabled
        ? `Please run ${updateCommand} to update`
        : 'Installed with pnpm. Attempting to automatically update now...',
    };
  }

  if (realPath.includes('/.yarn/global')) {
    const updateCommand = 'yarn global add @vybestack/llxprt-code@latest';
    return {
      packageManager: PackageManager.YARN,
      isGlobal: true,
      updateCommand,
      updateMessage: !isAutoUpdateEnabled
        ? `Please run ${updateCommand} to update`
        : 'Installed with yarn. Attempting to automatically update now...',
    };
  }

  if (realPath.includes('/.bun/install/cache')) {
    return {
      packageManager: PackageManager.BUNX,
      isGlobal: false,
      updateMessage: 'Running via bunx, update not applicable.',
    };
  }
  if (realPath.includes('/.bun/bin')) {
    const updateCommand = 'bun add -g @vybestack/llxprt-code@latest';
    return {
      packageManager: PackageManager.BUN,
      isGlobal: true,
      updateCommand,
      updateMessage: !isAutoUpdateEnabled
        ? `Please run ${updateCommand} to update`
        : 'Installed with bun. Attempting to automatically update now...',
    };
  }

  return null;
}

function checkLocalNodeModulesInstall(
  realPath: string,
  normalizedProjectRoot: string,
  projectRoot: string,
): InstallationInfo | null {
  if (
    !normalizedProjectRoot ||
    !realPath.startsWith(`${normalizedProjectRoot}/node_modules`)
  ) {
    return null;
  }

  let pm = PackageManager.NPM;
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) {
    pm = PackageManager.YARN;
  } else if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) {
    pm = PackageManager.PNPM;
  } else if (fs.existsSync(path.join(projectRoot, 'bun.lockb'))) {
    pm = PackageManager.BUN;
  }
  return {
    packageManager: pm,
    isGlobal: false,
    updateMessage:
      "Locally installed. Please update via your project's package.json.",
  };
}

export function getInstallationInfo(
  projectRoot: string,
  isAutoUpdateEnabled: boolean,
): InstallationInfo {
  const cliPath = process.argv[1];
  if (!cliPath) {
    return { packageManager: PackageManager.UNKNOWN, isGlobal: false };
  }

  try {
    const realPath = fs.realpathSync(cliPath).replace(/\\/g, '/');
    const normalizedProjectRoot = projectRoot.replace(/\\/g, '/');
    const isGit = isGitRepository(process.cwd());

    if (
      isGit &&
      normalizedProjectRoot &&
      realPath.startsWith(normalizedProjectRoot) &&
      !realPath.includes('/node_modules/')
    ) {
      return {
        packageManager: PackageManager.UNKNOWN,
        isGlobal: false,
        updateMessage:
          'Running from a local git clone. Please update with "git pull".',
      };
    }

    const npxPnpx = checkNpxPnpxInstall(realPath);
    if (npxPnpx) return npxPnpx;

    const homebrewInfo = checkHomebrewInstall(realPath, isAutoUpdateEnabled);
    if (homebrewInfo) return homebrewInfo;

    const pkgMgr = checkPackageManagerByPath(realPath, isAutoUpdateEnabled);
    if (pkgMgr) return pkgMgr;

    const localInstall = checkLocalNodeModulesInstall(
      realPath,
      normalizedProjectRoot,
      projectRoot,
    );
    if (localInstall) return localInstall;

    const updateCommand = 'npm install -g @vybestack/llxprt-code@latest';
    return {
      packageManager: PackageManager.NPM,
      isGlobal: true,
      updateCommand,
      updateMessage: !isAutoUpdateEnabled
        ? `Please run ${updateCommand} to update`
        : 'Installed with npm. Attempting to automatically update now...',
    };
  } catch (error) {
    debugLogger.log(String(error));
    return { packageManager: PackageManager.UNKNOWN, isGlobal: false };
  }
}
