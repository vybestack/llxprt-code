/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { dynamicSettingsRegistry } from './utils/dynamicSettings.js';
import { registerDynamicToolSettings } from './cliBootstrap.js';

describe('registerDynamicToolSettings', () => {
  afterEach(() => {
    dynamicSettingsRegistry.reset();
  });

  it('registers settings from the supplied tool description operation', () => {
    registerDynamicToolSettings(() => ({
      registered: [{ displayName: 'Read File' }],
      unregistered: [{ displayName: 'Search Web', reason: 'disabled' }],
    }));

    expect(
      dynamicSettingsRegistry.get('coreToolSettings.ReadFile'),
    ).toMatchObject({
      default: true,
      requiresRestart: true,
    });
    expect(
      dynamicSettingsRegistry.get('coreToolSettings.SearchWeb'),
    ).toMatchObject({
      default: false,
      description: 'Search Web (unavailable: disabled)',
    });
  });
});
