/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, join, dirname } from 'node:path';
import stripJsonComments from 'strip-json-comments';
import os from 'node:os';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import { resolveGlobalConfigDir } from '../packages/storage/src/config/path-resolver.js';

const argv = yargs(hideBin(process.argv))
  .option('q', {
    alias: 'quiet',
    type: 'boolean',
    default: false,
  })
  .parseSync();

function loadEnvFromDirTree(): void {
  let currentDir = process.cwd();
  let keepGoing = true;
  while (keepGoing) {
    if (tryLoadEnvInDir(currentDir)) {
      keepGoing = false;
    } else {
      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) {
        keepGoing = false;
      } else {
        currentDir = parentDir;
      }
    }
  }
}

function loadEnvFileWhenSandboxConfigured(envPath: string): boolean {
  const parsed = dotenv.parse(readFileSync(envPath, 'utf8'));
  if (parsed.LLXPRT_SANDBOX === undefined) {
    return false;
  }
  dotenv.config({ path: envPath, quiet: true });
  return true;
}

function tryLoadEnvInDir(currentDir: string): boolean {
  const llxprtEnv = join(currentDir, '.llxprt', '.env');
  const regularEnv = join(currentDir, '.env');
  if (existsSync(llxprtEnv) && loadEnvFileWhenSandboxConfigured(llxprtEnv)) {
    return true;
  }
  if (existsSync(regularEnv)) {
    return loadEnvFileWhenSandboxConfigured(regularEnv);
  }
  return false;
}

function normalizeSandboxSetting(value: string | boolean | undefined): string {
  if (typeof value === 'string') {
    return value.toLowerCase();
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return '';
}

function sandboxValueFromParsedSettings(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null || !('sandbox' in parsed)) {
    return undefined;
  }
  const sandbox = parsed.sandbox;
  if (typeof sandbox !== 'string' && typeof sandbox !== 'boolean') {
    return undefined;
  }
  const normalized = normalizeSandboxSetting(sandbox);
  return normalized === '' ? undefined : normalized;
}

let sandboxSetting: string | undefined = process.env.LLXPRT_SANDBOX;

if (sandboxSetting === undefined) {
  const userSettingsFile = join(resolveGlobalConfigDir(), 'settings.json');
  if (existsSync(userSettingsFile)) {
    try {
      const parsed = JSON.parse(
        stripJsonComments(readFileSync(userSettingsFile, 'utf-8')),
      ) as unknown;
      sandboxSetting = sandboxValueFromParsedSettings(parsed);
    } catch {
      // Ignore invalid user settings for this best-effort command probe.
    }
  }
}

if (sandboxSetting === undefined) {
  loadEnvFromDirTree();
  sandboxSetting = process.env.LLXPRT_SANDBOX;
}

const sandboxCommand = normalizeSandboxSetting(sandboxSetting);
const platform = os.platform();

function validateCommandName(cmd: string): string | undefined {
  if (cmd.includes('/') || cmd.includes('\\')) {
    return 'only bare command names are accepted';
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(cmd)) {
    return 'command contains invalid characters';
  }
  return undefined;
}

const commandExists = (cmd: string): boolean =>
  validateCommandName(cmd) === undefined &&
  findFirstExecutable(cmd) !== undefined;

function invalidSandboxCommandReason(cmd: string): string {
  return validateCommandName(cmd) ?? 'command was not found on PATH';
}

function isExecutableFile(path: string): boolean {
  try {
    const candidateStats = statSync(path);
    if (!candidateStats.isFile()) {
      return false;
    }
    return platform === 'win32' || (candidateStats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function executableExtensions(): string[] {
  if (platform !== 'win32') {
    return [''];
  }
  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(delimiter)
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.length > 0);
  return extensions;
}

function findFirstExecutable(cmd: string): string | undefined {
  const extensions = executableExtensions();
  const pathEntries = (process.env.PATH ?? '')
    .split(delimiter)
    .map((entry) => (entry.length === 0 ? '.' : entry));
  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(entry, `${cmd}${extension}`);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

let command = '';
if (['1', 'true'].includes(sandboxCommand)) {
  if (commandExists('docker')) {
    command = 'docker';
  } else if (commandExists('podman')) {
    command = 'podman';
  } else {
    if (!argv.q) {
      console.error(
        'ERROR: install docker or podman or specify command in LLXPRT_SANDBOX',
      );
    }
    process.exit(1);
  }
} else if (sandboxCommand && !['0', 'false'].includes(sandboxCommand)) {
  if (commandExists(sandboxCommand)) {
    command = sandboxCommand;
  } else {
    const reason = invalidSandboxCommandReason(sandboxCommand);
    if (!argv.q) {
      console.error(
        `ERROR: invalid sandbox command ${JSON.stringify(sandboxCommand.slice(0, 100))} from LLXPRT_SANDBOX (${reason})`,
      );
    }
    process.exit(1);
  }
} else if (['0', 'false'].includes(sandboxCommand)) {
  if (!argv.q) {
    console.error('No sandbox command configured.');
  }
  process.exit(0);
} else if (platform === 'darwin' && process.env.SEATBELT_PROFILE !== 'none') {
  if (commandExists('sandbox-exec')) {
    command = 'sandbox-exec';
  } else {
    if (!argv.q) {
      console.error(
        'ERROR: sandbox-exec not found (required for macOS sandboxing)',
      );
    }
    process.exit(1);
  }
} else {
  if (!argv.q) {
    console.error('No sandbox command configured.');
  }
  const sandboxExplicitlyDisabled = process.env.SEATBELT_PROFILE === 'none';
  process.exit(sandboxExplicitlyDisabled ? 0 : 1);
}

if (!argv.q) {
  console.log(command);
}
process.exit(0);
