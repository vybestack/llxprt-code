/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { quote } from 'shell-quote';
import { SETTINGS_DIRECTORY_NAME } from '../config/settings.js';
import {
  getContainerPath,
  sandboxPorts,
  isSandboxDebugModeEnabled,
  resolveDebugPort,
} from './sandbox-env.js';

function buildPathSuffix(
  envValue: string | undefined,
  containerWorkdir: string,
  pathSeparator: string,
): string {
  if (!envValue) {
    return '';
  }
  let suffix = '';
  for (const p of envValue.split(pathSeparator)) {
    const containerPath = getContainerPath(p);
    if (
      containerPath.toLowerCase().startsWith(containerWorkdir.toLowerCase())
    ) {
      suffix += `:${containerPath}`;
    }
  }
  return suffix;
}

function resolveCliCommand(): string {
  const isDebugMode = isSandboxDebugModeEnabled(process.env.DEBUG);
  if (process.env.NODE_ENV === 'development') {
    return isDebugMode ? 'npm run debug --' : 'npm rebuild && npm run start --';
  }
  if (isDebugMode) {
    return `node --inspect-brk=0.0.0.0:${resolveDebugPort()} $(which llxprt)`;
  }
  return 'llxprt';
}

export function entrypoint(
  workdir: string,
  cliArgs: string[],
  skipPortRelays?: Set<string>,
): string[] {
  const isWindows = os.platform() === 'win32';
  const containerWorkdir = getContainerPath(workdir);
  const shellCmds: string[] = [];
  const pathSeparator = isWindows ? ';' : ':';

  const pathSuffix = buildPathSuffix(
    process.env.PATH,
    containerWorkdir,
    pathSeparator,
  );
  if (pathSuffix) {
    shellCmds.push(`export PATH="$PATH${pathSuffix}";`);
  }

  const pythonPathSuffix = buildPathSuffix(
    process.env.PYTHONPATH,
    containerWorkdir,
    pathSeparator,
  );
  if (pythonPathSuffix) {
    shellCmds.push(`export PYTHONPATH="$PYTHONPATH${pythonPathSuffix}";`);
  }

  const projectSandboxBashrc = path.join(
    SETTINGS_DIRECTORY_NAME,
    'sandbox.bashrc',
  );
  if (fs.existsSync(projectSandboxBashrc)) {
    shellCmds.push(`source ${getContainerPath(projectSandboxBashrc)};`);
  }

  for (const p of sandboxPorts()) {
    if (skipPortRelays?.has(p) === true) {
      continue;
    }
    shellCmds.push(
      `socat TCP4-LISTEN:${p},bind=$(hostname -i),fork,reuseaddr TCP4:127.0.0.1:${p} 2> /dev/null &`,
    );
  }

  const quotedCliArgs = cliArgs.slice(2).map((arg) => quote([arg]));
  const cliCmd = resolveCliCommand();

  const args = [...shellCmds, cliCmd, ...quotedCliArgs];
  return ['bash', '-c', args.join(' ')];
}
