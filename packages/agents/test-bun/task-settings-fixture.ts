/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { taskPolicyFixture } from '../src/tools/__tests__/task-policy-fixture.js';

interface TaskSettingsFixture {
  readonly config: Config;
  readonly store: SettingsService;
  readonly owner: SessionSettingsOwner;
  readonly policies: ReturnType<typeof taskPolicyFixture>;
}

export function installTaskSettingsFixtures(
  sessionId: string,
): (settings?: Readonly<Record<string, number>>) => TaskSettingsFixture {
  const fixtures: TaskSettingsFixture[] = [];
  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      fixture.owner.dispose();
      await fixture.config.dispose();
    }
  });
  return (settings = {}): TaskSettingsFixture => {
    const store = new SettingsService();
    store.set('subagents', { asyncEnabled: true });
    for (const [key, value] of Object.entries(settings)) store.set(key, value);
    const owner = new SessionSettingsOwner(store);
    const config = new Config({
      sessionId,
      targetDir: process.cwd(),
      cwd: process.cwd(),
      model: 'gpt-4o',
      debugMode: false,
      interactive: false,
      initialSettings: store.getAllGlobalSettings(),
    });
    const fixture = {
      config,
      store,
      owner,
      policies: taskPolicyFixture(owner),
    };
    fixtures.push(fixture);
    return fixture;
  };
}
