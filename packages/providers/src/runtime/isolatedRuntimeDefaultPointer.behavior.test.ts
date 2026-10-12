import { SessionProviderReads } from '../../../agents/src/api/session-provider-reads.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useRuntimeTestOwners } from './__tests__/runtime-owner-test-helpers.js';
import { activateIsolatedRuntimeContext } from './index.js';

describe('isolated activation preserves explicit foreground ownership (issue #2300)', () => {
  const owners = useRuntimeTestOwners();

  it.each(['wrapper', 'direct'])(
    '%s activation keeps foreground provider and OAuth infrastructure unchanged',
    async (activation) => {
      const foreground = owners.foreground();
      foreground.settingsService.set('activeProvider', 'kimi');
      const isolated = owners.isolated({ runtimeId: 'same-label' });
      if (activation === 'wrapper')
        await activateIsolatedRuntimeContext(isolated);
      else await isolated.activate();
      expect(
        new SessionProviderReads(
          foreground.settingsOwner,
          foreground.providerManager,
          () => foreground.config.getModel(),
          (provider) =>
            foreground.settingsService.getProviderSettings(provider),
        ).getActiveProviderName(),
      ).toBe('kimi');
      expect('providerManager' in foreground.config).toBe(false);
      expect(foreground.providerManager.listProviders()).toContain('openai');
      expect(isolated.oauthManager).not.toBe(foreground.oauthManager);
    },
  );

  it('isolated cleanup cannot clear the same-label foreground OAuth or provider manager', async () => {
    const foreground = owners.foreground();
    const isolated = owners.isolated({ runtimeId: 'same-label' });
    await isolated.activate();
    await isolated.cleanup();
    expect(
      isolated.providerFileLifecycle.retainsScope(
        'session',
        isolated.runtimeId,
      ),
    ).toBe(false);
    expect(foreground.oauthManager?.runtimeMessageBus).toBe(
      foreground.runtimeMessageBus,
    );
    expect(foreground.providerManager.listProviders()).toContain('openai');
  });

  it('cleanup leaves a foreground owner created after isolated activation usable', async () => {
    const isolated = owners.isolated({ runtimeId: 'same-label' });
    await isolated.activate();
    const foreground = owners.foreground();
    await isolated.cleanup();
    expect(foreground.oauthManager?.runtimeMessageBus).toBe(
      foreground.runtimeMessageBus,
    );
    expect('providerManager' in foreground.config).toBe(false);
  });

  it('parallel isolated activation never supplies an implicit foreground default', async () => {
    const foreground = owners.foreground();
    const first = owners.isolated({ runtimeId: 'same-label' });
    const second = owners.isolated({ runtimeId: 'same-label' });
    await Promise.all([first.activate(), second.activate()]);
    expect(() => Reflect.construct(SessionProviderReads, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
    expect(first.oauthManager).not.toBe(second.oauthManager);
    await first.cleanup();
    expect(second.oauthManager.getSupportedProviders()).toContain('codex');
    expect(foreground.oauthManager?.runtimeMessageBus).toBe(
      foreground.runtimeMessageBus,
    );
  });
});
