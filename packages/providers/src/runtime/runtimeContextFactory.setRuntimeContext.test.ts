/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test for the isolated-runtime activation wiring of
 * ProviderManager#setRuntimeContext.
 *
 * Verifies that activating an isolated runtime installs the scoped
 * ProviderRuntimeContext onto the provider manager via its public
 * setRuntimeContext method (no private-field cast). The unit under test is the
 * factory's activate closure; the ProviderManager is a real collaborator.
 *
 * Observable contract: after activation, prepareStatelessProviderInvocation()
 * (which reads this.runtime) succeeds WITHOUT throwing the "runtime" missing
 * field error — proving the scoped runtime was installed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { IsolatedRuntimeContextHandle } from './runtimeSettings.js';
import { ProviderManager } from '../ProviderManager.js';
import {
  activateIsolatedRuntimeContext,
  createIsolatedRuntimeContext,
  resetCliProviderInfrastructure,
} from './runtimeSettings.js';

describe('runtime context activation wires setRuntimeContext @requirement:REQ-SP4-004', () => {
  let handle: IsolatedRuntimeContextHandle | undefined;

  beforeEach(() => {
    resetCliProviderInfrastructure();
  });

  afterEach(async () => {
    if (handle) {
      await handle.cleanup();
      handle = undefined;
    }
    resetCliProviderInfrastructure();
  });

  it('installs the scoped runtime onto the provider manager via setRuntimeContext', async () => {
    let capturedManager:
      | IsolatedRuntimeContextHandle['providerManager']
      | undefined;
    handle = createIsolatedRuntimeContext({
      runtimeId: 'setRuntimeContext-scoped',
      workspaceDir: process.cwd(),
      model: 'scoped-model',
      metadata: { source: 'setRuntimeContext-wiring' },
      prepare: async ({ providerManager }) => {
        capturedManager = providerManager;
      },
    });

    try {
      await activateIsolatedRuntimeContext(handle, {
        runtimeId: handle.runtimeId,
        metadata: { source: 'setRuntimeContext-wiring' },
      });

      expect(capturedManager).toBeDefined();
      // The scoped runtime was installed: prepareStatelessProviderInvocation
      // reads this.runtime and must NOT throw the "runtime" missing error.
      // Assert the method exists first and call it WITHOUT optional chaining so
      // the not-throw assertion cannot pass trivially on an absent method.
      expect(capturedManager!.prepareStatelessProviderInvocation).toBeDefined();
      expect(() =>
        capturedManager!.prepareStatelessProviderInvocation!(),
      ).not.toThrow();
    } finally {
      await handle.cleanup();
      handle = undefined;
    }
  });

  it('installs the scoped runtime onto an ADOPTED provider manager via setRuntimeContext', async () => {
    // Construct a REAL ProviderManager and pass it in via the adoption seam
    // (providerManager option). The factory must call setRuntimeContext on
    // THIS instance (not a fresh one), so prepareStatelessProviderInvocation
    // — which reads this.runtime — succeeds after activation.
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService);
    const adoptedManager = new ProviderManager({
      settingsService,
      config,
    });

    // Assign to the describe-scope `handle` (do NOT shadow with a local const)
    // so the afterEach hook owns cleanup even if activation throws.
    handle = createIsolatedRuntimeContext({
      runtimeId: 'setRuntimeContext-adopted',
      workspaceDir: process.cwd(),
      model: 'adopted-model',
      providerManager: adoptedManager,
      prepare: async () => {},
    });

    await activateIsolatedRuntimeContext(handle, {
      runtimeId: handle.runtimeId,
      metadata: { source: 'setRuntimeContext-adopted' },
    });

    // The ADOPTED manager received the scoped runtime: identity holds AND
    // prepareStatelessProviderInvocation does not throw the "runtime"
    // missing error.
    expect(handle.providerManager).toBe(adoptedManager);
    expect(() =>
      adoptedManager.prepareStatelessProviderInvocation(),
    ).not.toThrow();
  });
});
