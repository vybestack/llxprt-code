/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { constants as osConstants, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { isErrnoException, messageOf } from './utils/error-guards.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const SETTINGS_DIRECTORY_NAME = '.llxprt';
const USER_SETTINGS_DIR = join(homedir(), SETTINGS_DIRECTORY_NAME);
const USER_SETTINGS_PATH = join(USER_SETTINGS_DIR, 'settings.json');
const WORKSPACE_SETTINGS_PATH = join(
  projectRoot,
  SETTINGS_DIRECTORY_NAME,
  'settings.json',
);

interface TelemetrySettings {
  telemetry?: {
    target?: string;
  };
}

function loadSettingsValue(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const errors: ParseError[] = [];
    const settings = parseJsonc(content, errors) as
      | TelemetrySettings
      | undefined;
    if (errors.length > 0) {
      throw new Error(
        `JSONC parse errors: ${errors.map((error) => `${error.offset}:${error.error}`).join('; ')}`,
      );
    }
    return settings?.telemetry?.target;
  } catch (e) {
    if (isErrnoException(e, 'ENOENT')) {
      return undefined;
    }
    const message = messageOf(e);
    console.warn(
      `WARNING: Could not parse settings file at ${filePath}: ${message}`,
    );
  }
  return undefined;
}

const targetScripts = {
  local: 'local_telemetry.js',
  gcp: 'telemetry_gcp.js',
} as const;
type TelemetryTarget = keyof typeof targetScripts;
const DEFAULT_TARGET: TelemetryTarget = 'local';
const allowedTargets = Object.keys(targetScripts) as TelemetryTarget[];

function isTelemetryTarget(value: string): value is TelemetryTarget {
  return allowedTargets.includes(value as TelemetryTarget);
}

function defaultedTelemetryTarget(value: string | undefined): TelemetryTarget {
  return value !== undefined && isTelemetryTarget(value)
    ? value
    : DEFAULT_TARGET;
}

function cliTargetValue(): string | undefined {
  const equalForm = process.argv.find((arg) => arg.startsWith('--target='));
  if (equalForm !== undefined) {
    return equalForm.slice('--target='.length);
  }
  const index = process.argv.indexOf('--target');
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1] ?? '';
}

// Precedence: CLI --target overrides settings; workspace settings override user settings.
const cliTarget = cliTargetValue();
const effectiveSettingsTarget =
  cliTarget === undefined
    ? (loadSettingsValue(WORKSPACE_SETTINGS_PATH) ??
      loadSettingsValue(USER_SETTINGS_PATH))
    : undefined;
if (
  cliTarget === undefined &&
  effectiveSettingsTarget !== undefined &&
  !isTelemetryTarget(effectiveSettingsTarget)
) {
  console.error(
    `[ERROR] Invalid telemetry target '${effectiveSettingsTarget}' found in settings. Allowed targets are: ${allowedTargets.join(', ')}. Check ${WORKSPACE_SETTINGS_PATH} and ${USER_SETTINGS_PATH}.`,
  );
  process.exit(1);
}
let target = defaultedTelemetryTarget(effectiveSettingsTarget);
if (cliTarget !== undefined) {
  if (cliTarget === '') {
    console.error('[ERROR] --target requires a non-empty value.');
    console.error(`Allowed targets are: ${allowedTargets.join(', ')}.`);
    process.exit(1);
  }
  if (isTelemetryTarget(cliTarget)) {
    target = cliTarget;
    console.log(`[CONFIG] Using command-line target: ${target}`);
  } else {
    console.error(
      `[ERROR] Invalid target '${cliTarget}'. Allowed targets are: ${allowedTargets.join(', ')}.`,
    );
    process.exit(1);
  }
} else if (effectiveSettingsTarget) {
  console.log(
    `[CONFIG] Using telemetry target from settings.json: ${effectiveSettingsTarget}`,
  );
}

const scriptPath = join(projectRoot, 'scripts', targetScripts[target]);
if (!existsSync(scriptPath)) {
  console.error(
    `[ERROR] Telemetry script not found at ${scriptPath} for target: ${target}.`,
  );
  process.exit(1);
}

// Target telemetry scripts remain JavaScript and run under Node even when this wrapper is launched by Bun.
console.log(`Running telemetry script for target: ${target}.`);
const result = spawnSync('node', [scriptPath], {
  stdio: 'inherit',
  cwd: projectRoot,
});
if (result.error !== undefined) {
  const detail = isErrnoException(result.error, 'ENOENT')
    ? "Node.js ('node') is required but was not found on PATH."
    : messageOf(result.error);
  console.error(
    `[ERROR] Failed to run telemetry script for target: ${target}: ${detail}`,
  );
  process.exit(1);
}
if (result.signal !== null) {
  console.error(
    `[ERROR] Telemetry script for target ${target} was killed by signal ${result.signal}.`,
  );
  const signals = osConstants.signals as Record<string, number>;
  const signalNumber = Object.hasOwn(signals, result.signal)
    ? signals[result.signal]
    : undefined;
  process.exit(typeof signalNumber === 'number' ? 128 + signalNumber : 1);
}
if (result.status !== 0) {
  console.error(
    `[ERROR] Telemetry script for target ${target} exited with code ${result.status}.`,
  );
  process.exit(result.status ?? 1);
}
