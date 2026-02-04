/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  Config,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { loadConfig } from './config.js';

describe('loadConfig auth fallback', () => {
  it('falls back to OAuth when no API key and USE_CCPA is not set', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockResolvedValue(undefined);

    delete process.env.GEMINI_API_KEY;
    delete process.env.USE_CCPA;

    await loadConfig({} as never, [], 'test-task-id');

    expect(Config.prototype.refreshAuth).toHaveBeenCalledWith('oauth-personal');
  });
});
