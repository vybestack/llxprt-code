import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, vi } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { ApprovalMode, PolicyDecision } from '@vybestack/llxprt-code-policy';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

interface SchedulerPolicyFixture {
  readonly config: Config;
  readonly settingsOwner: SessionSettingsOwner;
  readonly policyOwner: RuntimePolicyOwner;
  readonly messageBus: MessageBus;
}
const fixtures: SchedulerPolicyFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.settingsOwner.dispose();
    await fixture.policyOwner.dispose();
    await fixture.config.dispose();
  }
});

export function createSchedulerPolicyFixture(
  overrides: Partial<Config> = {},
  decision: PolicyDecision = PolicyDecision.ALLOW,
): SchedulerPolicyFixture {
  const config = Object.assign(
    new Config({
      sessionId: 'scheduler-policy-fixture',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      model: 'test',
      debugMode: false,
      trustedFolder: true,
      policyEngineConfig: {
        defaultDecision: decision,
        rules: [
          {
            decision: PolicyDecision.ALLOW,
            priority: 1.999,
            modes: [ApprovalMode.YOLO],
          },
          ...(overrides.getAllowedTools?.() ?? []).map((toolName) => ({
            toolName,
            decision: PolicyDecision.ALLOW,
            priority: 2,
          })),
        ],
      },
    }),
    overrides,
  );
  const policyOwner = new RuntimePolicyOwner(config);
  const messageBus = policyOwner.session.messageBus;
  vi.spyOn(messageBus, 'publish');
  vi.spyOn(messageBus, 'subscribe');
  const settingsService = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settingsService.set(key, value);
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.bindTelemetry(config);
  const fixture = { config, settingsOwner, policyOwner, messageBus };
  fixtures.push(fixture);
  return fixture;
}
