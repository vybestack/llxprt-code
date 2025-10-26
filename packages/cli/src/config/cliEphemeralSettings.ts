/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseEphemeralSettingValue } from '../settings/ephemeralSettings.js';
import { parseModelParamValue } from '../settings/modelParamParser.js';

export interface EphemeralSettingTarget {
  setEphemeralSetting(key: string, value: unknown): void;
}

export interface CliSetResult {
  modelParams: Record<string, unknown>;
}

const MODEL_PARAM_PREFIX = 'modelparam.';

export function applyCliSetArguments(
  target: EphemeralSettingTarget,
  setArgs: readonly string[] | undefined,
): CliSetResult {
  const cliModelParams: Record<string, unknown> = {};

  if (!setArgs || setArgs.length === 0) {
    return { modelParams: cliModelParams };
  }

  for (const entry of setArgs) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex === -1) {
      throw new Error(`Invalid --set format: ${entry}. Expected key=value`);
    }

    const key = entry.slice(0, separatorIndex).trim();
    const rawValue = entry.slice(separatorIndex + 1);

    if (!key) {
      throw new Error(`Invalid --set format: ${entry}. Expected key=value`);
    }

    if (key === 'modelparam') {
      throw new Error(
        `Invalid --set key: ${entry}. Use --set modelparam.<name>=<value> (e.g., --set modelparam.temperature=0.7)`,
      );
    }

    if (key.startsWith(MODEL_PARAM_PREFIX)) {
      const paramName = key.slice(MODEL_PARAM_PREFIX.length).trim();
      if (!paramName) {
        throw new Error(
          `Invalid model parameter key in ${entry}. Expected --set modelparam.<name>=<value>`,
        );
      }
      cliModelParams[paramName] = parseModelParamValue(rawValue);
      continue;
    }

    const parseResult = parseEphemeralSettingValue(key, rawValue);

    if (!parseResult.success) {
      throw new Error(parseResult.message);
    }

    target.setEphemeralSetting(key, parseResult.value);
  }

  return { modelParams: cliModelParams };
}
