import { CredentialAuthority } from '../auth/proxy/credential-store-factory.js';
import { SessionProviderReads } from '../../../agents/src/api/session-provider-reads.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useRuntimeTestOwners } from './__tests__/runtime-owner-test-helpers.js';
import { createIsolatedRuntimeContext, validateRuntimeId } from './index.js';

describe('explicit owner identity at composition boundaries (issue #2300)', () => {
  const owners = useRuntimeTestOwners();

  it('uses the supplied foreground Config even after another same-label owner is composed', async () => {
    const first = await owners.foreground();
    const second = await owners.foreground();
    first.settingsService.set('activeProvider', 'openai');
    second.settingsService.set('activeProvider', 'kimi');
    expect(
      new SessionProviderReads(
        first.settingsOwner,
        first.providerManager,
        () => first.config.getModel(),
        (provider) => first.settingsService.getProviderSettings(provider),
      ).getActiveProviderName(),
    ).toBe('openai');
    expect(
      new SessionProviderReads(
        second.settingsOwner,
        second.providerManager,
        () => second.config.getModel(),
        (provider) => second.settingsService.getProviderSettings(provider),
      ).getActiveProviderName(),
    ).toBe('kimi');
    expect(first.oauthManager).not.toBe(second.oauthManager);
  });

  it('does not borrow a foreground manager for an owner with no infrastructure', async () => {
    await owners.foreground();
    const { config: incomplete } = owners.config();
    expect(() => Reflect.construct(SessionProviderReads, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
    expect('runtimeOAuthManager' in incomplete).toBe(false);
  });

  it('requires an explicit owner even after foreground infrastructure exists', async () => {
    const foreground = await owners.foreground();
    expect(() => Reflect.construct(SessionProviderReads, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
    expect(foreground.providerManager.listProviders()).toContain('openai');
  });

  it('isolated construction before foreground bootstrap cannot select foreground infrastructure', async () => {
    const isolated = owners.isolated({ runtimeId: 'before-bootstrap' });
    const foreground = await owners.foreground('after-bootstrap');
    await isolated.activate();
    expect('providerManager' in foreground.config).toBe(false);
    expect(isolated.oauthManager.runtimeMessageBus).not.toBe(
      foreground.oauthManager?.runtimeMessageBus,
    );
    expect(isolated.oauthManager).not.toBe(foreground.oauthManager);
  });

  it.each(['', '  ', '\t\n', null, undefined, 123, false])(
    'rejects invalid external runtime label %p',
    (runtimeId) => {
      expect(() => validateRuntimeId(runtimeId)).toThrow('Invalid runtimeId');
    },
  );

  it('rejects invalid isolated labels before attaching file infrastructure', () => {
    const { config, settingsService } = owners.config();
    for (const runtimeId of ['', '  ']) {
      expect(() =>
        createIsolatedRuntimeContext(
          {
            credentialAuthority: new CredentialAuthority(),

            config,
            runtimeId,
          },
          settingsService,
        ),
      ).toThrow('Invalid runtimeId');
    }
    expect('providerFileLifecycle' in config).toBe(false);
  });
});
