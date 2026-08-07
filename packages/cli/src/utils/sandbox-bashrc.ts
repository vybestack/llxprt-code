/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Evaluates `.llxprt/sandbox.bashrc` AFTER the capability descriptor has been
 * consumed, importing its exported environment changes and working-directory
 * change into the current process. F5: paths are positional argv, payload on
 * dedicated fd 4 (NUL encoding), failures throw.
 *
 * @plan project-plans/issue-1954-sandbox-hardening.md (AC5)
 */

const CAPABILITY_ENV_PREFIXES = ['LLXPRT_CAPABILITY_'] as const;
const BASH_NOISE_VARS = new Set(['PWD', 'OLDPWD', 'SHLVL', '_']);

export interface SandboxBashrcChanges {
  readonly env: Record<string, string>;
  readonly unset: readonly string[];
  readonly cwd: string | undefined;
}

export interface ExtractOptions {
  readonly sanitizeEnv?: boolean;
}

function sanitizeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (
      CAPABILITY_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
      value === undefined
    ) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function runBashrcProbe(
  resolvedBashrc: string,
  workdir: string,
  childEnv: NodeJS.ProcessEnv,
): { envOutput: string; cwdOutput: string } {
  // The payloads travel on dedicated channels so that anything the sourced
  // bashrc prints cannot be mistaken for protocol data. Files are used rather
  // than inherited file descriptors 3 and 4 because `spawnSync` only populates
  // stdio slots 0-2 under Bun, which silently yielded empty payloads.
  const protocolDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'llxprt-bashrc-probe-'),
  );
  const envPath = path.join(protocolDir, 'env');
  const cwdPath = path.join(protocolDir, 'cwd');
  const probeScript = [
    'cd "$2"',
    'source "$1" || exit $?',
    'env -0 >"$3"',
    'printf "%s\\0" "$PWD" >"$4"',
  ].join('\n');
  let result;
  try {
    result = spawnSync(
      'env',
      [
        '-u',
        'BASH_ENV',
        'bash',
        '--noprofile',
        '--norc',
        '-c',
        probeScript,
        '--',
        resolvedBashrc,
        workdir,
        envPath,
        cwdPath,
      ],
      {
        encoding: 'utf8',
        env: childEnv,
        cwd: workdir,
        stdio: ['inherit', 'inherit', 'inherit'],
      },
    );
  } catch (error) {
    fs.rmSync(protocolDir, { recursive: true, force: true });
    throw error;
  }
  const readProtocolFile = (filePath: string): string => {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  };

  try {
    if (result.error !== undefined) {
      throw new Error(
        `sandbox.bashrc child could not be spawned: ${
          result.error instanceof Error
            ? result.error.message
            : String(result.error)
        }`,
      );
    }
    if (result.status !== 0) {
      throw new Error(
        `sandbox.bashrc child exited with status ${result.status}`,
      );
    }
    const envOutput = readProtocolFile(envPath);
    const cwdOutput = readProtocolFile(cwdPath);
    if (cwdOutput === '') {
      throw new Error(
        'sandbox.bashrc child produced no cwd payload on the dedicated protocol pipe',
      );
    }
    return { envOutput, cwdOutput };
  } finally {
    fs.rmSync(protocolDir, { recursive: true, force: true });
  }
}

function parseBashrcPayload(
  envOutput: string,
  cwdOutput: string,
): {
  env: Record<string, string>;
  cwdRecord: string;
} {
  const cwdRecords = cwdOutput.split('\0');
  if (cwdRecords.length !== 2 || cwdRecords[1] !== '') {
    throw new Error('sandbox.bashrc child produced a malformed cwd payload');
  }
  const env: Record<string, string> = {};
  for (const entry of envOutput.split('\0')) {
    if (entry === '') continue;
    const eqIdx = entry.indexOf('=');
    if (eqIdx <= 0) {
      throw new Error('sandbox.bashrc child produced a malformed env payload');
    }
    env[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
  }
  return { env, cwdRecord: cwdRecords[0] };
}

export function extractSandboxBashrcChanges(
  bashrcPath: string,
  workdir: string,
  parentEnv: NodeJS.ProcessEnv = process.env,
  options: ExtractOptions = {},
): SandboxBashrcChanges {
  const resolvedBashrc = path.isAbsolute(bashrcPath)
    ? bashrcPath
    : path.resolve(workdir, bashrcPath);
  if (!path.isAbsolute(resolvedBashrc)) {
    throw new Error(`sandbox.bashrc path is not absolute: ${resolvedBashrc}`);
  }
  if (!fs.existsSync(resolvedBashrc)) {
    return { env: {}, unset: [], cwd: undefined };
  }
  const childEnv =
    options.sanitizeEnv === true
      ? sanitizeEnvironment(parentEnv)
      : { ...parentEnv };
  const { envOutput, cwdOutput } = runBashrcProbe(
    resolvedBashrc,
    workdir,
    childEnv,
  );
  const { env, cwdRecord } = parseBashrcPayload(envOutput, cwdOutput);
  const isCapabilityKey = (key: string): boolean =>
    CAPABILITY_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
  const changedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    // Skip noise vars, capability re-injection attempts, and unchanged vars.
    if (
      BASH_NOISE_VARS.has(key) ||
      isCapabilityKey(key) ||
      childEnv[key] === value
    ) {
      continue;
    }
    changedEnv[key] = value;
  }
  const exportedKeys = new Set(Object.keys(env));
  const unset = Object.keys(childEnv).filter(
    (key) =>
      !BASH_NOISE_VARS.has(key) &&
      !isCapabilityKey(key) &&
      !exportedKeys.has(key),
  );
  return {
    env: changedEnv,
    unset,
    cwd: cwdRecord !== workdir ? cwdRecord : undefined,
  };
}

export function applySandboxBashrc(bashrcPath: string, workdir: string): void {
  const resolvedBashrc = path.isAbsolute(bashrcPath)
    ? bashrcPath
    : path.resolve(workdir, bashrcPath);
  if (!fs.existsSync(resolvedBashrc)) return;
  const { env, unset, cwd } = extractSandboxBashrcChanges(
    resolvedBashrc,
    workdir,
    process.env,
    { sanitizeEnv: true },
  );
  for (const key of unset) delete process.env[key];
  // O4: sanitizeEnv excludes capability keys from the child probe, so they
  // never appear in `unset`. Actively remove every parent LLXPRT_CAPABILITY_*
  // key so post-consumption cleanup is guaranteed even when the marker was
  // not deleted by the consumer.
  for (const key of Object.keys(process.env)) {
    if (CAPABILITY_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  if (cwd !== undefined) process.chdir(cwd);
}
