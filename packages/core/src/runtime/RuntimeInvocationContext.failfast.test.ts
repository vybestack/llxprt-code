/**
 * @license
 * Copyright 2025
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeInvocationContext } from './RuntimeInvocationContext.js';
import { createProviderRuntimeContext } from './providerRuntimeContext.js';
import { SettingsService } from '../settings/SettingsService.js';

describe('RuntimeInvocationContext fail-fast requirements', () => {
  it('throws when runtimeId is missing', () => {
    const settings = new SettingsService();
    const runtime = createProviderRuntimeContext({
      settingsService: settings,
    });

    expect(() =>
      createRuntimeInvocationContext({
        runtime,
        settings,
        providerName: 'openai',
      }),
    ).toThrowError('RuntimeInvocationContext requires a non-empty runtimeId.');
  });

  it('throws when provider ephemerals are not available', () => {
    const settings = new SettingsService();
    const runtime = createProviderRuntimeContext({
      settingsService: settings,
      runtimeId: 'runtime-missing-ephemerals',
    });

    expect(() =>
      createRuntimeInvocationContext({
        runtime,
        settings,
        providerName: 'openai',
      }),
    ).toThrowError(
      'RuntimeInvocationContext requires provider ephemerals for provider "openai".',
    );
  });
});
