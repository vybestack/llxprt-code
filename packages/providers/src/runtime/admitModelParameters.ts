/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { separateSettings } from '@vybestack/llxprt-code-settings';
import {
  ownModelParameters,
  type AdmittedModelParameters,
} from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import { buildEphemeralsSnapshot } from '../runtimeNormalizer.js';

export function admitModelParameters(
  settings: SettingsService,
  providerName: string,
): AdmittedModelParameters {
  const classified = separateSettings(
    buildEphemeralsSnapshot(settings, providerName),
    providerName,
  );
  const rawMaxOutput = settings.get('maxOutputTokens');
  const genericMaxOutputTokens =
    typeof rawMaxOutput === 'number' &&
    Number.isFinite(rawMaxOutput) &&
    rawMaxOutput > 0
      ? rawMaxOutput
      : undefined;
  return Object.freeze({
    providerName,
    modelParams: ownModelParameters(classified.modelParams),
    genericMaxOutputTokens,
  });
}
