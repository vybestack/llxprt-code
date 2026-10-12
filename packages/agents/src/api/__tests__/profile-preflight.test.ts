/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core';
import { prepareAgentPreflight } from '../profile-preflight.js';

describe('profile preflight lifetime', () => {
  it('keeps same-label settings isolated without exposing the runtime graph', async () => {
    const first = prepareAgentPreflight(
      { runtimeId: 'same-label', initialSettings: { marker: 1 } },
      new CredentialAuthority(),
    );
    const second = prepareAgentPreflight(
      { runtimeId: 'same-label', initialSettings: { marker: 2 } },
      new CredentialAuthority(),
    );
    try {
      first.chooseProviderModel('openai', 'first-model');
      second.chooseProviderModel('anthropic', 'second-model');
      expect(first.captureSettings()).toMatchObject({ marker: 1 });
      expect(second.captureSettings()).toMatchObject({ marker: 2 });
      expect('runtime' in first).toBe(false);
      expect('providerManager' in first).toBe(false);
      expect('registration' in first).toBe(false);
      expect('settingsService' in first).toBe(false);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it('preserves borrowed settings and rejects operations after disposal', async () => {
    const settings = new SettingsService();
    const owner = new SessionSettingsOwner(settings);
    const operation = prepareAgentPreflight(
      { runtimeId: 'borrowed-preflight' },
      new CredentialAuthority(),
      settings,
      owner,
    );
    operation.chooseProviderModel('openai', 'chosen-model');
    expect(settings.getProviderSettings('openai').model).toBe('chosen-model');
    await operation.dispose();
    owner.writeUserParameter('context-limit', 4096);
    expect(owner.readNamedParameter('context-limit')).toBe(4096);
    expect(() => operation.captureSettings()).toThrow('disposed');
    await owner.dispose();
  });
});
