/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  installBorrowedConfigSettings,
  installOwnedConfigSettings,
} from './helpers/session-settings-owner-fixture.js';

class CallerConfig extends Config {
  override async dispose(): Promise<void> {
    throw new Error('Borrowed Config was unexpectedly disposed');
  }
}
function configParameters() {
  return {
    sessionId: 'same-label',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'owner-model',
    debugMode: false,
  };
}

describe('borrowed Config settings fixture lifetime', () => {
  const acquire = installBorrowedConfigSettings();
  const settings = new SettingsService();
  let first: SessionSettingsOwner;
  let second: SessionSettingsOwner;
  let changes = 0;
  let verifyRelease = (): void => {};
  afterEach(() => verifyRelease());
  it('retains peer settings authority when a same-store owner closes first', async () => {
    const config = new CallerConfig(configParameters());
    first = acquire(config, settings);
    second = acquire(config, settings);
    second.subscribeProviderSettings(() => {
      changes += 1;
    });
    first.writeUserParameter('maxOutputTokens', 73);
    expect(second.readNamedParameter('maxOutputTokens')).toBe(73);
    await first.dispose();
    second.writeUserParameter('maxOutputTokens', 91);
    expect(second.readNamedParameter('maxOutputTokens')).toBeGreaterThan(73);
    expect(changes).toBeGreaterThan(0);
    const beforeClose = changes;
    verifyRelease = () => {
      expect(() => first.readNamedParameter('maxOutputTokens')).toThrow(
        'closed',
      );
      expect(() => second.readNamedParameter('maxOutputTokens')).toThrow(
        'closed',
      );
      settings.set('maxOutputTokens', 182);
      expect(settings.get('maxOutputTokens')).toBe(182);
      expect(changes - beforeClose).toBe(0);
    };
  });
});

describe('owned Config settings fixture lifetime', () => {
  const acquire = installOwnedConfigSettings();
  const settings = new SettingsService();
  let owner: SessionSettingsOwner;
  let changes = 0;
  let verifyRelease = (): void => {};
  afterEach(() => verifyRelease());
  it('writes to the exact supplied store through its separately acquired owner', () => {
    owner = acquire('same-label', settings);
    owner.assertSettingsIdentity(settings);
    owner.subscribeProviderSettings(() => {
      changes += 1;
    });
    owner.writeUserParameter('streaming', true);
    expect(settings.get('streaming')).toBe('enabled');
    expect(changes).toBeGreaterThan(0);
    const beforeClose = changes;
    verifyRelease = () => {
      expect(() => owner.readNamedParameter('streaming')).toThrow('closed');
      settings.set('streaming', 'disabled');
      expect(settings.get('streaming')).toBe('disabled');
      expect(changes - beforeClose).toBe(0);
    };
  });
});
