/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260827-ISSUE2562.P03
 * @requirement REQ-2562-4
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { oauthRuntimeBridge } from '../auth/index.js';
import { ProviderManager } from '../ProviderManager.js';
import { buildOAuthRuntimeAccessors } from './oauth-runtime-accessors.js';
import {
  resetCliRuntimeRegistryForTesting,
  upsertRuntimeEntry,
} from './runtimeRegistry.js';
import { setCliRuntimeContext } from './runtimeLifecycle.js';

const RUNTIME_ID = 'oauth-runtime-accessors-test';

describe('buildOAuthRuntimeAccessors interactive authentication timeout', () => {
  let settingsService: SettingsService;

  beforeEach(() => {
    resetCliRuntimeRegistryForTesting();
    settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService);
    const providerManager = new ProviderManager({ settingsService, config });
    setCliRuntimeContext(settingsService, config, { runtimeId: RUNTIME_ID });
    upsertRuntimeEntry(RUNTIME_ID, { providerManager });
  });

  afterEach(() => {
    resetCliRuntimeRegistryForTesting();
    oauthRuntimeBridge.setAccessors(undefined);
  });

  it('returns the configured interactive authentication timeout', () => {
    settingsService.set('auth.interactiveTimeoutMs', 45_000);

    const accessors = buildOAuthRuntimeAccessors();

    expect(accessors.getInteractiveAuthTimeoutMs()).toBe(45_000);
  });

  it('returns the default when the setting is absent', () => {
    const accessors = buildOAuthRuntimeAccessors();

    expect(accessors.getInteractiveAuthTimeoutMs()).toBe(1_200_000);
  });

  it('returns the default when runtime settings are unavailable', () => {
    resetCliRuntimeRegistryForTesting();
    const accessors = buildOAuthRuntimeAccessors();

    expect(accessors.getInteractiveAuthTimeoutMs()).toBe(1_200_000);
  });
});
