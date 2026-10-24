/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { createRuntimeSettingsService } from '../../runtime/settingsRuntimeAdapter.js';
import { createProviderRuntimeContext } from '../../runtime/providerRuntimeContext.js';
import { captureProviderInvocation } from '../../runtime/providerRequestContext.js';
import type { NetworkFetch } from '../../utils/fetch.js';

const requestFetch: NetworkFetch = () =>
  Promise.reject(new Error('This test must not make network requests'));

describe('settings runtime composition', () => {
  it('captures separately constructed settings without publishing the service in a context', () => {
    const service = createRuntimeSettingsService();
    service.set('probe-key', 'probe-value');
    const context = createProviderRuntimeContext({
      runtimeId: 'composition-slice',
    });
    const invocation = captureProviderInvocation(
      {
        fetch: requestFetch,
        runtimeId: context.runtimeId,
        globalSettings: service.getAllGlobalSettings(),
        providerSettings: service.getProviderSettings('test-provider'),
      },
      'test-provider',
    );
    service.set('probe-key', 'later-value');

    expect(invocation.ephemerals['probe-key']).toBe('probe-value');
    expect('settingsService' in context).toBe(false);
  });

  it('two composition rounds retain independent settings and context identity', () => {
    const firstService = createRuntimeSettingsService();
    const secondService = createRuntimeSettingsService();
    const first = createProviderRuntimeContext({ runtimeId: 'round-1' });
    const second = createProviderRuntimeContext({ runtimeId: 'round-2' });
    firstService.set('probe-key', 'first');

    expect(secondService.get('probe-key')).toBeUndefined();
    expect(firstService).not.toBe(secondService);
    expect(first.runtimeId).not.toBe(second.runtimeId);
  });
});
