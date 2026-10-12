/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createProviderConfigFixture } from './__tests__/provider-config-fixture.js';
import { createIsolatedRuntimeContext } from './runtimeContextFactory.js';
import { createRuntimeActivationBindings } from './runtimeActivationBindings.js';

function buildOwner(): ReturnType<typeof createProviderConfigFixture> {
  return createProviderConfigFixture({
    sessionId: 'binding-owner',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'binding-model',
  });
}

describe('isolated runtime construction requirements', () => {
  it('rejects a missing caller Config before building runtime collaborators', () => {
    expect(() =>
      Reflect.apply(createIsolatedRuntimeContext, undefined, [
        { activationBindings: createRuntimeActivationBindings() },
      ]),
    ).toThrow(/caller-supplied Config/);
  });

  it('rejects missing activation bindings even after another owner activates', async () => {
    const { config, settingsService, settingsOwner } = buildOwner();
    const handle = createIsolatedRuntimeContext(
      {
        config,
        settingsOwner,
        activationBindings: createRuntimeActivationBindings(),
      },
      settingsService,
    );
    try {
      await handle.activate();
      expect(() =>
        Reflect.apply(createIsolatedRuntimeContext, undefined, [{ config }]),
      ).toThrow(/explicit activation bindings/);
    } finally {
      await handle.cleanup();
      await config.dispose();
    }
  });
});
