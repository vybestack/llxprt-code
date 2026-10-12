/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useRuntimeTestOwners } from './__tests__/runtime-owner-test-helpers.js';
import {
  createIsolatedRuntimeContext,
  getActiveProviderName,
  listProviders,
  validateRuntimeId,
} from './index.js';

describe('explicit owner identity at composition boundaries (issue #2300)', () => {
  const owners = useRuntimeTestOwners();

  it('uses the supplied foreground Config even after another same-label owner is composed', () => {
    const first = owners.foreground();
    const second = owners.foreground();
    first.settingsService.set('activeProvider', 'openai');
    second.settingsService.set('activeProvider', 'kimi');
    expect(
      getActiveProviderName(first.settingsOwner, first.providerManager),
    ).toBe('openai');
    expect(
      getActiveProviderName(second.settingsOwner, second.providerManager),
    ).toBe('kimi');
    expect(first.oauthManager).not.toBe(second.oauthManager);
  });

  it('does not borrow a foreground manager for an owner with no infrastructure', () => {
    owners.foreground();
    const { config: incomplete } = owners.config();
    expect(() => Reflect.apply(listProviders, undefined, [])).toThrow(
      'Provider listing requires an explicit owner',
    );
    expect('runtimeOAuthManager' in incomplete).toBe(false);
  });

  it('requires an explicit owner even after foreground infrastructure exists', () => {
    const foreground = owners.foreground();
    expect(() => Reflect.apply(listProviders, undefined, [])).toThrow(
      'Provider listing requires an explicit owner',
    );
    expect(listProviders(foreground.providerManager)).toContain('openai');
  });

  it('isolated construction before foreground bootstrap cannot select foreground infrastructure', async () => {
    const isolated = owners.isolated({ runtimeId: 'before-bootstrap' });
    const foreground = owners.foreground('after-bootstrap');
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
