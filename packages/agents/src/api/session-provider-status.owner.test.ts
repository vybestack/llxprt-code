import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  installOwnedConfig,
  installBorrowedConfigSettings,
} from '../../../providers/src/__tests__/helpers/session-settings-owner-fixture.js';
import { SessionProviderReads } from './session-provider-reads.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';

const acquireSettings = installBorrowedConfigSettings();
const acquireConfig = installOwnedConfig();

function selectedConfig(label: string, modelName: string): Config {
  return acquireConfig({
    sessionId: label,
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    model: modelName,
  });
}

function selectProvider(
  settings: SettingsService,
  providerName: string,
  modelName: string,
): void {
  settings.set('activeProvider', providerName);
  settings.setProviderSetting(providerName, 'model', modelName);
}

describe('provider status owner binding', () => {
  it('reads equal-label owners independently without borrowing another runtime', async () => {
    const firstConfig = selectedConfig('same-label', 'first-model');
    const firstSettings = new SettingsService();
    selectProvider(firstSettings, 'first', 'first-model');
    const firstOwner = acquireSettings(firstConfig, firstSettings);
    const secondConfig = selectedConfig('same-label', 'second-model');
    const secondSettings = new SettingsService();
    selectProvider(secondSettings, 'second', 'second-model');
    const secondOwner = acquireSettings(secondConfig, secondSettings);
    try {
      expect(
        new SessionProviderReads(
          firstOwner,
          new TestRuntimeProviderManager(),
          () => firstConfig.getModel(),
          (provider) => firstSettings.getProviderSettings(provider),
        ).providerStatus(),
      ).toMatchObject({
        providerName: 'first',
        modelName: 'first-model',
      });
      expect(
        new SessionProviderReads(
          secondOwner,
          new TestRuntimeProviderManager(),
          () => secondConfig.getModel(),
          (provider) => secondSettings.getProviderSettings(provider),
        ).providerStatus(),
      ).toMatchObject({
        providerName: 'second',
        modelName: 'second-model',
      });
    } finally {
      await firstConfig.dispose();
      await secondConfig.dispose();
    }
  });

  it('does not infer an owner from a neighboring runtime', async () => {
    const firstConfig = selectedConfig('same-label', 'first-model');
    const firstSettings = new SettingsService();
    selectProvider(firstSettings, 'first', 'first-model');
    acquireSettings(firstConfig, firstSettings);
    try {
      expect(
        new SessionProviderReads(
          new SessionSettingsOwner(new SettingsService()),
          new TestRuntimeProviderManager(),
          () => '',
          () => ({}),
        ).providerStatus(),
      ).toMatchObject({
        providerName: null,
        modelName: null,
      });
    } finally {
      await firstConfig.dispose();
    }
  });
});
