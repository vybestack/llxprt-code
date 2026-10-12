import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderConfigFixture } from '../../../providers/src/runtime/__tests__/provider-config-fixture.js';
import { SessionProviderReads } from './session-provider-reads.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';

function owner(
  label: string,
  providerName: string,
  modelName: string,
): ReturnType<typeof createProviderConfigFixture> {
  const settingsService = new SettingsService();
  settingsService.set('activeProvider', providerName);
  settingsService.setProviderSetting(providerName, 'model', modelName);
  return createProviderConfigFixture({
    sessionId: label,
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    model: modelName,
    settingsService,
  });
}

describe('provider status owner binding', () => {
  it('reads equal-label owners independently without borrowing another runtime', async () => {
    const first = owner('same-label', 'first', 'first-model');
    const second = owner('same-label', 'second', 'second-model');
    try {
      expect(
        new SessionProviderReads(
          first.settingsOwner,
          new TestRuntimeProviderManager(),
          () => first.config.getModel(),
          (provider) => first.settingsService.getProviderSettings(provider),
        ).providerStatus(),
      ).toMatchObject({
        providerName: 'first',
        modelName: 'first-model',
      });
      expect(
        new SessionProviderReads(
          second.settingsOwner,
          new TestRuntimeProviderManager(),
          () => second.config.getModel(),
          (provider) => second.settingsService.getProviderSettings(provider),
        ).providerStatus(),
      ).toMatchObject({
        providerName: 'second',
        modelName: 'second-model',
      });
    } finally {
      await first.config.dispose();
      await second.config.dispose();
    }
  });

  it('does not infer an owner from a neighboring runtime', async () => {
    const first = owner('same-label', 'first', 'first-model');
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
      await first.config.dispose();
    }
  });
});
