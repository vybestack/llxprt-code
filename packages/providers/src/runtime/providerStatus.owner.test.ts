/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderConfigFixture } from './__tests__/provider-config-fixture.js';
import { readProviderStatus } from './providerStatus.js';

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
        readProviderStatus(
          first.settingsService,
          null,
          first.config.getModel(),
        ),
      ).toMatchObject({
        providerName: 'first',
        modelName: 'first-model',
      });
      expect(
        readProviderStatus(
          second.settingsService,
          null,
          second.config.getModel(),
        ),
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
      expect(readProviderStatus(new SettingsService(), null, '')).toMatchObject(
        {
          providerName: null,
          modelName: null,
        },
      );
    } finally {
      await first.config.dispose();
    }
  });
});
