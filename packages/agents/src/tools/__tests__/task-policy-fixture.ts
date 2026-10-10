/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { afterEach } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner as OwnedSessionSettings } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

let owners: readonly OwnedSessionSettings[] = [];
afterEach(async () => {
  const retiring = owners;
  owners = [];
  for (const owner of retiring) await owner.dispose();
});

export function createTaskPolicyFixture(
  values: Readonly<Record<string, unknown>> = {},
): ReturnType<typeof taskPolicyFixture> {
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(values)) settings.set(key, value);
  const owner = new OwnedSessionSettings(settings);
  owners = [...owners, owner];
  return taskPolicyFixture(owner);
}

export function taskPolicyFixture(owner: SessionSettingsOwner) {
  return {
    createChildSettings: () => owner.createChildStore(),
    readTaskPolicy: () => owner.readTaskPolicy(),
    readRunPolicy: () => owner.readSubagentRunPolicy(),
    readGovernance: () => owner.readToolGovernance([]),
  };
}
