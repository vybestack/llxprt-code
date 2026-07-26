/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LlmPort } from './types.js';

export interface LlmPortConfig {
  readonly provider: string;
  readonly model: string;
  readonly apiKey: string;
  readonly keyfilePath?: string;
  readonly baseUrl?: string;
  readonly temperature?: number;
  /**
   * Override for the CLI bin path. Defaults to the local built CLI at
   * `<root>/packages/cli/bin/llxprt.cjs`.
   */
  readonly cliBinPath?: string;
}

export interface LlmRunnerOptions {
  readonly encoding: 'utf8';
  readonly env: NodeJS.ProcessEnv;
  readonly stdio: 'pipe';
  readonly timeout: number;
  readonly cwd: string;
}

export type LlmRunner = (
  command: string,
  args: readonly string[],
  options: LlmRunnerOptions,
) => SpawnSyncReturns<string>;

const DEFAULT_CLI_BIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'cli',
  'bin',
  'llxprt.cjs',
);
function buildInlineProfile(config: LlmPortConfig): string {
  return JSON.stringify({
    provider: config.provider,
    model: config.model,
    modelParams: { temperature: config.temperature ?? 0.1 },
    ephemeralSettings: {
      'tools.allowed': [],
    },
  });
}

function buildPrompt(structuredContext: string): string {
  return [
    'Return valid JSON and nothing else.',
    'The object must have one field: sourceIds.',
    'sourceIds must contain 3-6 strings from the eligible source IDs listed below.',
    'Select only IDs that correspond to user-facing changes with defensible impact.',
    'Do not include emoji, markdown, internal mechanisms, refactors, tests, CI, or build work.',
    structuredContext,
  ].join('\n');
}

/**
 * Builds a fully isolated environment for the spawned LLM process.
 * Only PATH, TMPDIR, the isolated HOME (and USERPROFILE on Windows), and
 * provider configuration env vars are forwarded. Real HOME/USERPROFILE, npm
 * config, GitHub/Docker/CI secrets, and any unrelated env are explicitly NOT
 * inherited to prevent credential leakage.
 */
export function buildIsolatedEnvironment(
  config: LlmPortConfig,
  home: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '',
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    HOME: home,
    // Windows resolves the home directory via USERPROFILE, not HOME. Omitting
    // it would leave the spawned process without an isolated home (forcing a
    // fallback to the real user profile) or unable to locate it at all.
    USERPROFILE: home,
  };
  if (config.baseUrl !== undefined) {
    env.OPENAI_BASE_URL = config.baseUrl;
  }
  return env;
}

const defaultRunner: LlmRunner = (command, args, options) =>
  spawnSync(command, [...args], options);

/**
 * Creates a private temporary keyfile containing the API key when no supplied
 * keyfile path is configured. The keyfile is mode 0600 so only the owning
 * user can read it. Returns the resolved keyfile path to pass via `--keyfile`
 * — the API key is never passed in argv, profile, or env.
 *
 * When a supplied keyfilePath is relative, it is resolved to an absolute
 * path relative to the parent process's cwd, because the spawned child
 * process runs with an isolated tempDir cwd that would break relative
 * resolution.
 *
 * Throws when the key contains CR/LF characters, which are not valid in API
 * keys and would corrupt the keyfile or downstream auth headers.
 */
function resolveKeyfilePath(config: LlmPortConfig, tempDir: string): string {
  if (hasNewline(config.apiKey)) {
    throw new Error(
      'API key contains CR/LF characters and cannot be written to keyfile.',
    );
  }
  if (config.keyfilePath !== undefined) {
    return resolve(config.keyfilePath);
  }
  const keyfilePath = join(tempDir, 'key');
  writeFileSync(keyfilePath, config.apiKey, { mode: 0o600 });
  return keyfilePath;
}

/**
 * Returns true when the value contains CR or LF characters. Such characters
 * are not valid in API keys and would corrupt keyfile writes or auth headers.
 */
function hasNewline(value: string): boolean {
  return value.includes('\r') || value.includes('\n');
}

function validateConfig(config: LlmPortConfig): void {
  if (config.provider.trim().length === 0) {
    throw new Error('LLM provider is required');
  }
  if (config.model.trim().length === 0) {
    throw new Error('LLM model is required');
  }
  if (
    config.apiKey.trim().length === 0 &&
    (config.keyfilePath === undefined || config.keyfilePath.trim().length === 0)
  ) {
    throw new Error('LLM API key or keyfile path is required');
  }
}

function readSecretForRedaction(keyfilePath: string): string {
  try {
    return readFileSync(keyfilePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function invocationFailure(
  result: SpawnSyncReturns<string>,
  secrets: readonly string[],
): Error {
  if (
    result.error?.name === 'ETIMEDOUT' ||
    (result.error?.message ?? '').includes('ETIMEDOUT')
  ) {
    return new Error('LLxprt Code LLM invocation timed out');
  }
  const rawStderr = result.stderr ?? '';
  const redacted = secrets
    .filter((secret) => secret.length > 0)
    .reduce(
      (diagnostic, secret) => diagnostic.replaceAll(secret, '[redacted]'),
      rawStderr,
    );
  const stderr = [...redacted]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  const detail = stderr.length > 0 ? `: ${stderr}` : '';
  return new Error(
    `LLxprt Code LLM invocation failed (status ${result.status ?? 'null'})${detail}`,
  );
}

export function createLlmPort(
  config: LlmPortConfig,
  runner: LlmRunner = defaultRunner,
): LlmPort {
  validateConfig(config);
  return {
    async generateHighlights(structuredContext: string): Promise<string> {
      // Isolated temp HOME + cwd: the spawned process must not inherit the
      // real HOME, npm config, or the repository working directory.
      const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-llm-'));
      try {
        const keyfilePath = resolveKeyfilePath(config, tempDir);

        const cliBin = config.cliBinPath ?? DEFAULT_CLI_BIN;
        const args: string[] = [
          cliBin,
          '--profile',
          buildInlineProfile(config),
          '--keyfile',
          keyfilePath,
          '--output-format',
          'json',
          '--prompt',
          buildPrompt(structuredContext),
        ];
        if (config.baseUrl !== undefined) {
          args.push('--baseurl', config.baseUrl);
        }

        const result = runner('node', args, {
          encoding: 'utf8',
          env: buildIsolatedEnvironment(config, tempDir),
          stdio: 'pipe',
          timeout: 120_000,
          cwd: tempDir,
        });
        if (result.error !== undefined || result.status !== 0) {
          const keyfileSecret = readSecretForRedaction(keyfilePath);
          throw invocationFailure(result, [
            config.apiKey,
            keyfileSecret,
            keyfilePath,
          ]);
        }
        let envelope: unknown;
        try {
          envelope = JSON.parse(result.stdout ?? '');
        } catch {
          throw new Error('LLxprt Code returned an invalid JSON response');
        }
        if (
          typeof envelope !== 'object' ||
          envelope === null ||
          !('response' in envelope) ||
          typeof envelope.response !== 'string'
        ) {
          throw new Error('LLxprt Code returned an invalid JSON envelope');
        }
        return envelope.response;
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  };
}
