import { createProviderConfigFixture } from './__tests__/provider-config-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';

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

import { afterEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { ProviderManager } from '../ProviderManager.js';
import {
  createIsolatedRuntimeContext,
  type IsolatedRuntimeContextHandle,
  type RuntimeActivationBindings,
} from './runtimeContextFactory.js';

const activationBindings: RuntimeActivationBindings = {
  resetInfrastructure: () => {},
  setRuntimeContext: () => {},
  registerInfrastructure: () => {},
  linkProviderManager: (config, manager) => {
    configureProviderRuntimeFactories(config, manager);
  },
};

describe('runtime context activation wires setRuntimeContext @requirement:REQ-SP4-004', () => {
  let handle: IsolatedRuntimeContextHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.cleanup();
      handle = undefined;
    }
  });

  it('installs the scoped runtime onto the provider manager via setRuntimeContext', async () => {
    let capturedManager:
      | IsolatedRuntimeContextHandle['providerManager']
      | undefined;
    handle = (() => {
      const {
        config: capturedConfig31,
        settingsService: capturedConfig31SettingsService,
        settingsOwner: capturedConfig31SettingsOwner,
      } = createProviderConfigFixture({
        sessionId: 'setRuntimeContext-scoped',
        targetDir: process.cwd(),
        cwd: process.cwd(),
        model: 'scoped-model',
        debugMode: false,
      });
      return createIsolatedRuntimeContext(
        {
          settingsOwner: capturedConfig31SettingsOwner,
          activationBindings,
          runtimeId: 'setRuntimeContext-scoped',
          config: capturedConfig31,
          metadata: { source: 'setRuntimeContext-wiring' },
          prepare: async ({ providerManager }) => {
            capturedManager = providerManager;
          },
        },
        capturedConfig31SettingsService,
      );
    })();

    try {
      await handle.activate({
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
    handle = (() => {
      const {
        config: capturedConfig32,
        settingsService: capturedConfig32SettingsService,
        settingsOwner: capturedConfig32SettingsOwner,
      } = createProviderConfigFixture({
        sessionId: 'setRuntimeContext-adopted',
        targetDir: process.cwd(),
        cwd: process.cwd(),
        model: 'adopted-model',
        debugMode: false,
        settingsService,
      });
      return createIsolatedRuntimeContext(
        {
          settingsOwner: capturedConfig32SettingsOwner,
          activationBindings,
          runtimeId: 'setRuntimeContext-adopted',
          config: capturedConfig32,
          providerManager: adoptedManager,
          prepare: async () => {},
        },
        capturedConfig32SettingsService,
      );
    })();

    await handle.activate({
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
