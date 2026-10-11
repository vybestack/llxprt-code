/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core';

import { afterEach } from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

interface SessionSettingsFixture {
  readonly settingsService: SettingsService;
  readonly workspaceTrust: WorkspaceTrustLifecycle;
  readonly settingsOwner: SessionSettingsOwner;
  dispose(): Promise<void>;
}

let roots: readonly SessionSettingsFixture[] = [];
afterEach(async () => {
  const retiring = roots;
  roots = [];
  for (const root of retiring) await root.dispose();
});

export function createSessionSettingsFixture(
  config: Config,
  suppliedSettings?: SettingsService,
): SessionSettingsFixture {
  const settingsService = suppliedSettings ?? new SettingsService();
  if (suppliedSettings === undefined) {
    for (const [key, value] of Object.entries(config.getInitialSettings())) {
      settingsService.set(key, value);
    }
  }
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.bindTelemetry(config);
  settingsOwner.initializeProviderSelection(
    config.getProvider(),
    config.getModel(),
  );
  const workspaceTrust = new WorkspaceTrustLifecycle({
    localTrust: config.initialWorkspaceTrust,
  });
  const root = {
    settingsService,
    settingsOwner,
    workspaceTrust,
    dispose: async (): Promise<void> => {
      await settingsOwner.dispose();
      await workspaceTrust.dispose();
    },
  };
  roots = [...roots, root];
  return root;
}

export function subagentSessionPorts(fixture: SessionSettingsFixture) {
  return {
    workspaceTrust: fixture.workspaceTrust,
    createChildSettings: () => fixture.settingsOwner.createChildStore(),
    readRunPolicy: () => fixture.settingsOwner.readSubagentRunPolicy(),
  };
}
