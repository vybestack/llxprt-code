/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { env } from 'node:process';

const LLXPRT_DIR = '.llxprt';
const WELCOME_CONFIG_FILENAME = 'welcomeConfig.json';

export interface TestDirectoryConfig {
  testDir: string;
  fakeResponsesPath: string | undefined;
  originalFakeResponsesPath: string | undefined;
}

/**
 * Create the base test directory, welcome config, and fake responses file.
 */
export function setupTestDirectory(
  testDir: string,
  options: {
    fakeResponsesPath?: string;
  },
): TestDirectoryConfig {
  mkdirSync(testDir, { recursive: true });

  let fakeResponsesPath: string | undefined;
  let originalFakeResponsesPath: string | undefined;
  if (options.fakeResponsesPath !== undefined) {
    fakeResponsesPath = join(testDir, 'fake-responses.json');
    originalFakeResponsesPath = options.fakeResponsesPath;
    if (env['REGENERATE_MODEL_GOLDENS'] !== 'true') {
      copyFileSync(options.fakeResponsesPath, fakeResponsesPath);
    }
  }

  writeFileSync(
    join(testDir, WELCOME_CONFIG_FILENAME),
    JSON.stringify({ welcomeCompleted: true }, null, 2),
  );

  return { testDir, fakeResponsesPath, originalFakeResponsesPath };
}

/**
 * Write the settings.json file pointing the CLI at the local telemetry
 * collector and applying caller-provided overrides.
 */
export function writeSettingsFile(
  testDir: string,
  packageDir: string,
  settingsOverridesRaw: Record<string, unknown> | undefined,
): void {
  const llxprtDir = join(testDir, LLXPRT_DIR);
  mkdirSync(llxprtDir, { recursive: true });

  const telemetryPath = join(testDir, 'telemetry.log');

  const overrides = splitSettingsOverrides(settingsOverridesRaw);
  const settings = buildSettings(
    telemetryPath,
    packageDir,
    overrides.ui,
    overrides.withoutUi,
  );

  writeFileSync(
    join(llxprtDir, 'settings.json'),
    JSON.stringify(settings, null, 2),
  );
}

function splitSettingsOverrides(raw: Record<string, unknown> | undefined): {
  ui: Record<string, unknown> | undefined;
  withoutUi: Record<string, unknown>;
} {
  if (raw === undefined) {
    return { ui: undefined, withoutUi: {} };
  }
  const { ui: uiOverridesRaw, ...settingsOverridesWithoutUi } = raw;
  return {
    ui: isPlainObject(uiOverridesRaw) ? uiOverridesRaw : undefined,
    withoutUi: settingsOverridesWithoutUi,
  };
}

/**
 * Type guard narrowing an unknown value to a plain string-keyed object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function resolvePromptBaseDir(packageDir: string): string {
  return existsSync(join(packageDir, '..', 'bundle'))
    ? join(packageDir, '..', 'bundle')
    : join(
        packageDir,
        '..',
        'packages',
        'core',
        'src',
        'prompt-config',
        'defaults',
      );
}

function buildSettings(
  telemetryPath: string,
  packageDir: string,
  ui: Record<string, unknown> | undefined,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const sandbox =
    env['LLXPRT_SANDBOX'] !== 'false' ? env['LLXPRT_SANDBOX'] : false;
  return {
    general: {
      enableAutoUpdate: false,
    },
    ui: {
      theme: 'Green Screen',
      useAlternateBuffer: true,
      ...ui,
    },
    telemetry: {
      enabled: true,
      target: 'local',
      otlpEndpoint: '',
      outfile: telemetryPath,
    },
    promptService: {
      baseDir: resolvePromptBaseDir(packageDir),
    },
    sandbox,
    provider: env['LLXPRT_DEFAULT_PROVIDER'],
    debug: true,
    ide: { enabled: false, hasSeenNudge: true },
    ...overrides,
  };
}

/**
 * Write a profile JSON file if the test profile env var is set.
 */
export function writeProfileFile(testDir: string): void {
  const profileName = env['LLXPRT_TEST_PROFILE']?.trim();
  if (profileName === undefined || profileName.length === 0) {
    return;
  }

  const profilesDir = join(testDir, LLXPRT_DIR, 'profiles');
  mkdirSync(profilesDir, { recursive: true });

  const profile = buildProfile();
  writeFileSync(
    join(profilesDir, `${profileName}.json`),
    JSON.stringify(profile, null, 2),
  );
}

function buildProfile(): Record<string, unknown> {
  const profileProvider = resolveEnvString('LLXPRT_DEFAULT_PROVIDER', 'openai');
  const profileModel = resolveEnvString('LLXPRT_DEFAULT_MODEL', 'gpt-4o-mini');

  const ephemeralEntries = collectEphemeralEntries();

  return {
    version: 1,
    provider: profileProvider,
    model: profileModel,
    modelParams: {},
    ephemeralSettings: Object.fromEntries(
      ephemeralEntries.filter(([, value]) => value !== undefined),
    ),
  };
}

function resolveEnvString(key: string, fallback: string): string {
  const value = env[key];
  if (value !== undefined && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

function collectEphemeralEntries(): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];

  const baseUrl = env['OPENAI_BASE_URL'];
  if (baseUrl !== undefined && baseUrl.trim().length > 0) {
    entries.push(['base-url', baseUrl]);
  }

  const apiKey = env['OPENAI_API_KEY'];
  if (apiKey !== undefined && apiKey.trim().length > 0) {
    entries.push(['auth-key', apiKey]);
  }

  const keyFile = env['LLXPRT_TEST_PROFILE_KEYFILE'];
  if (keyFile !== undefined) {
    entries.push(['auth-keyfile', keyFile]);
  }

  const contextLimit = env['LLXPRT_CONTEXT_LIMIT'];
  if (contextLimit !== undefined) {
    const parsedLimit = Number(contextLimit);
    if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
      entries.push(['context-limit', parsedLimit]);
    }
  }

  return entries;
}

export { LLXPRT_DIR, WELCOME_CONFIG_FILENAME };
