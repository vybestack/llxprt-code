/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';

interface LoopSettingsFixture {
  readonly config: Config;
  readonly settingsOwner: SessionSettingsOwner;
}

let fixtures: readonly LoopSettingsFixture[] = [];
afterEach(async () => {
  const retiring = fixtures;
  fixtures = [];
  await Promise.all(
    retiring.map(async ({ config, settingsOwner }) => {
      await settingsOwner.dispose();
      await config.dispose();
    }),
  );
});

export function createLoopSettingsFixture(options: {
  readonly interactive: boolean;
  readonly approvalMode: ApprovalMode;
  readonly imagePayloadBudgetBytes: number;
}): LoopSettingsFixture {
  const config = new Config({
    sessionId: 'agentic-loop-test-session',
    model: 'test-model',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    interactive: options.interactive,
    approvalMode: options.approvalMode,
    imagePayloadBudgetBytes: options.imagePayloadBudgetBytes,
    trustedFolder: true,
    telemetry: { logPrompts: false },
  });
  const settingsService = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.bindTelemetry(config);
  const fixture = { config, settingsOwner };
  fixtures = [...fixtures, fixture];
  return fixture;
}
