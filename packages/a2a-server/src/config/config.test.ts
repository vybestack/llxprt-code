/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Config,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { loadConfig } from './config.js';

const ORIGINAL_ENV = { ...process.env };

describe('loadConfig auth fallback', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('falls back to OAuth when no API key or vertex credentials are set', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockResolvedValue(undefined);

    delete process.env.GEMINI_API_KEY;
    delete process.env.USE_CCPA;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;

    await loadConfig({} as never, [], 'test-task-id');

    expect(Config.prototype.refreshAuth).toHaveBeenCalledWith('oauth-personal');
  });

  it('uses vertex auth when USE_CCPA is set', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockResolvedValue(undefined);

    process.env.USE_CCPA = 'true';

    await loadConfig({} as never, [], 'test-task-id');

    expect(Config.prototype.refreshAuth).toHaveBeenCalledWith('vertex-ai');
  });

  it('uses vertex auth when ADC credentials are present', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockResolvedValue(undefined);

    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/adc.json';

    await loadConfig({} as never, [], 'test-task-id');

    expect(Config.prototype.refreshAuth).toHaveBeenCalledWith('vertex-ai');
  });
});
