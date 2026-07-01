/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { env } from 'node:process';
import { join } from 'node:path';

const WELCOME_CONFIG_FILENAME = 'welcomeConfig.json';

/**
 * Fail fast if required provider configuration is missing (unless fake
 * responses are in use).
 */
export function assertProviderConfig(
  fakeResponsesPath: string | undefined,
): void {
  if (fakeResponsesPath !== undefined) {
    return;
  }
  requireEnvString('LLXPRT_DEFAULT_PROVIDER');
  requireEnvString('LLXPRT_DEFAULT_MODEL');
  const apiKey = readEnvString('OPENAI_API_KEY');
  const keyFile =
    readEnvString('OPENAI_API_KEYFILE') ??
    readEnvString('LLXPRT_TEST_PROFILE_KEYFILE');

  if (apiKey === undefined && keyFile === undefined) {
    throw new Error(
      'Either OPENAI_API_KEY or OPENAI_API_KEYFILE/LLXPRT_TEST_PROFILE_KEYFILE environment variable is required but not set',
    );
  }
}

/**
 * Build the base CLI extra args (yolo + ide flags, provider/model/key flags).
 */
export function buildExtraArgs(
  fakeResponsesPath: string | undefined,
  yolo: boolean,
): string[] {
  const extraArgs: string[] = [];
  if (yolo) {
    extraArgs.push('--yolo');
  }
  extraArgs.push('--ide-mode', 'disable');

  if (fakeResponsesPath !== undefined) {
    // FakeProvider is activated via LLXPRT_FAKE_RESPONSES env var. Pass
    // --provider fake so bootstrap's switchActiveProvider('fake') is a no-op.
    extraArgs.push('--provider', 'fake', '--model', 'fake-model');
    return extraArgs;
  }

  const provider = requireEnvString('LLXPRT_DEFAULT_PROVIDER');
  const model = requireEnvString('LLXPRT_DEFAULT_MODEL');
  const baseUrl = readEnvString('OPENAI_BASE_URL');
  const apiKey = readEnvString('OPENAI_API_KEY');
  const keyFile =
    readEnvString('OPENAI_API_KEYFILE') ??
    readEnvString('LLXPRT_TEST_PROFILE_KEYFILE');

  extraArgs.push('--provider', provider);
  extraArgs.push('--model', model);

  if (provider === 'openai' && baseUrl !== undefined) {
    extraArgs.push('--baseurl', baseUrl);
  }

  if (apiKey !== undefined) {
    extraArgs.push('--key', apiKey);
  } else if (keyFile !== undefined) {
    extraArgs.push('--keyfile', keyFile);
  }

  return extraArgs;
}

/**
 * Compute the command and its base args, choosing the installed `llxprt`
 * binary for npm release tests and `node <entryPath>` (the dist entry, which
 * relaunches into Bun via the launcher) otherwise.
 */
export function getCommandAndArgs(
  bundlePath: string,
  extraInitialArgs: string[] = [],
): { command: string; initialArgs: string[] } {
  const isNpmReleaseTest =
    env['INTEGRATION_TEST_USE_INSTALLED_LLXPRT'] === 'true';
  const command = isNpmReleaseTest ? 'llxprt' : 'node';
  const initialArgs = isNpmReleaseTest
    ? extraInitialArgs
    : [bundlePath, ...extraInitialArgs];
  return { command, initialArgs };
}

/**
 * Build the child-process environment, filtering IDE-detection vars and
 * injecting test harness defaults.
 */
export function buildChildEnv(
  testDir: string,
  fakeResponsesPath: string | undefined,
): NodeJS.ProcessEnv {
  const filteredEnv = Object.entries(process.env).reduce(
    (acc, [key, value]) => {
      if (
        value !== undefined &&
        key !== 'TERM_PROGRAM' &&
        key !== 'TERM_PROGRAM_VERSION'
      ) {
        acc[key] = value;
      }
      return acc;
    },
    {} as NodeJS.ProcessEnv,
  );

  return {
    ...filteredEnv,
    NO_BROWSER: 'true',
    LLXPRT_NO_BROWSER_AUTH: 'true',
    CI: 'true',
    LLXPRT_SANDBOX: 'false',
    LLXPRT_CODE_WELCOME_CONFIG_PATH: join(testDir, WELCOME_CONFIG_FILENAME),
    ...(fakeResponsesPath !== undefined
      ? { LLXPRT_FAKE_RESPONSES: fakeResponsesPath }
      : {}),
  };
}

/**
 * Resolve the `--profile-load` flag name when the test profile env var is set.
 */
export function getProfileName(): string | undefined {
  const raw = env['LLXPRT_TEST_PROFILE'];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvString(key: string): string | undefined {
  const value = env[key];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : undefined;
}

function requireEnvString(key: string): string {
  const value = readEnvString(key);
  if (value === undefined) {
    throw new Error(`${key} environment variable is required but not set`);
  }
  return value;
}
