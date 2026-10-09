/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2616 PR A: vertical-slice integration for the surviving settings
 * construction seam. The explicit composition contract is: a caller that
 * owns no service constructs one via createRuntimeSettingsService and hands
 * it to createProviderRuntimeContext. The context exposes exactly the
 * service the caller constructed — no ambient resolution participates.
 */

import { describe, it, expect } from 'bun:test';
import { createRuntimeSettingsService } from '../../runtime/settingsRuntimeAdapter.js';
import { createProviderRuntimeContext } from '../../runtime/providerRuntimeContext.js';

describe('settings runtime composition — vertical slice', () => {
  it('the constructed service is the one visible through the runtime context', () => {
    const service = createRuntimeSettingsService();
    service.set('probe-key', 'probe-value');

    const context = createProviderRuntimeContext({
      settingsService: service,
      runtimeId: 'composition-slice',
    });

    expect(context.settingsService).toBe(service);
    expect(context.settingsService.get('probe-key')).toBe('probe-value');
  });

  it('two composition rounds produce independent context/service pairs', () => {
    const firstService = createRuntimeSettingsService();
    const secondService = createRuntimeSettingsService();

    const first = createProviderRuntimeContext({
      settingsService: firstService,
      runtimeId: 'round-1',
    });
    const second = createProviderRuntimeContext({
      settingsService: secondService,
      runtimeId: 'round-2',
    });

    first.settingsService.set('probe-key', 'first');
    expect(second.settingsService.get('probe-key')).toBeUndefined();
    expect(first.settingsService).not.toBe(second.settingsService);
  });
});
