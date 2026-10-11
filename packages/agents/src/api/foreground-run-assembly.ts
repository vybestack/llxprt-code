/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { ForegroundRunOwner } from './foregroundRunLifecycle.js';
import { assembleDirectProviderAdmission } from './directProviderAdmission.js';
import { resolveLoopOrError, type LoopHolder } from './loop/rebuildLoop.js';

export function assembleForegroundRun(
  operations: Omit<ForegroundRunOwner, 'resolveLoop' | 'admitParameters'>,
  settingsService: SettingsService,
  providerManager: RuntimeProviderManager,
  loopHolder: LoopHolder,
  resolveClient: Parameters<typeof resolveLoopOrError>[1],
  rebuild: () => void,
  readModel: () => string,
): ForegroundRunOwner {
  const admission = assembleDirectProviderAdmission(
    settingsService,
    providerManager,
    readModel,
  );
  return {
    ...operations,
    resolveLoop: () => {
      const result = resolveLoopOrError(loopHolder, resolveClient, rebuild);
      if (result.error !== undefined) return result;
      const loop = result.loop;
      return {
        loop: {
          run: (...args) => loop.run(...args),
          injectSteer: (text) => loop.injectSteer(text),
        },
      };
    },
    admitParameters: () => admission.admit(),
  };
}
