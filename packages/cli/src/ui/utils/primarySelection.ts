/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import commandExists from 'command-exists';

const execFileAsync = promisify(execFile);
const PRIMARY_READ_TIMEOUT_MS = 1500;
const PRIMARY_READ_MAX_BUFFER = 1024 * 1024;

export type PrimarySelectionRunner = (
  command: string,
  args: readonly string[],
) => Promise<string>;

const runCommand: PrimarySelectionRunner = async (command, args) => {
  const { stdout } = await execFileAsync(command, [...args], {
    encoding: 'utf8',
    timeout: PRIMARY_READ_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: PRIMARY_READ_MAX_BUFFER,
    windowsHide: true,
  });
  return stdout;
};

const isEmptySelection = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (!('code' in error) || error.code !== 1) return false;
  if (!('stderr' in error) || typeof error.stderr !== 'string') return false;
  if (error.stderr.trim() !== 'Nothing is copied') return false;
  if (!('stdout' in error) || error.stdout !== '') return false;
  if ('signal' in error && error.signal != null) return false;
  if ('killed' in error && error.killed !== false) return false;
  return true;
};

export const readPrimarySelection = async (
  environment: NodeJS.ProcessEnv = process.env,
  runner: PrimarySelectionRunner = runCommand,
  hasCommand: (command: string) => boolean = commandExists.sync,
): Promise<string> => {
  let command: string;
  let args: readonly string[];
  if (environment.WAYLAND_DISPLAY) {
    command = 'wl-paste';
    args = ['--no-newline', '--primary'];
  } else if (environment.DISPLAY) {
    const xclipAvailable = hasCommand('xclip');
    const xselAvailable = hasCommand('xsel');
    if (!xclipAvailable && !xselAvailable) {
      throw new Error(
        'PRIMARY selection tools unavailable; install xclip or xsel.',
      );
    }
    command = xclipAvailable ? 'xclip' : 'xsel';
    args =
      command === 'xclip'
        ? ['-selection', 'primary', '-o']
        : ['--primary', '--output'];
  } else {
    throw new Error(
      'PRIMARY selection access is unavailable in this desktop environment.',
    );
  }

  try {
    if (command === 'wl-paste' && !hasCommand(command)) {
      throw new Error('wl-paste is not installed.');
    }
    return await runner(command, args);
  } catch (error) {
    if (command === 'wl-paste' && isEmptySelection(error)) return '';
    throw new Error(
      `Unable to read the PRIMARY selection with ${command}; check desktop selection access.`,
    );
  }
};
