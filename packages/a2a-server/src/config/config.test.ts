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

describe('getApprovalMode LLXPRT_YOLO_MODE', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('enables YOLO mode when LLXPRT_YOLO_MODE is "true"', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockResolvedValue(undefined);

    delete process.env.GEMINI_API_KEY;
    delete process.env.USE_CCPA;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    process.env.LLXPRT_YOLO_MODE = 'true';
    delete process.env.GEMINI_YOLO_MODE;

    const config = await loadConfig({} as never, [], 'test-task-id');
    expect(config.getApprovalMode()).toBe('yolo');
  });

  it('uses DEFAULT mode when LLXPRT_YOLO_MODE is not set', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockResolvedValue(undefined);

    delete process.env.GEMINI_API_KEY;
    delete process.env.USE_CCPA;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LLXPRT_YOLO_MODE;
    delete process.env.GEMINI_YOLO_MODE;

    const config = await loadConfig({} as never, [], 'test-task-id');
    expect(config.getApprovalMode()).toBe('default');
  });

  it('does not enable YOLO mode via GEMINI_YOLO_MODE fallback', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockResolvedValue(undefined);

    delete process.env.GEMINI_API_KEY;
    delete process.env.USE_CCPA;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LLXPRT_YOLO_MODE;
    process.env.GEMINI_YOLO_MODE = 'true';

    const config = await loadConfig({} as never, [], 'test-task-id');
    expect(config.getApprovalMode()).toBe('default');
  });
});

describe('loadConfig interactive mode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should make config.isInteractive() return true', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockResolvedValue(undefined);

    const config = await loadConfig({} as never, [], 'test-task-id');

    expect(config.isInteractive()).toBe(true);
    expect(config.getNonInteractive()).toBe(false);
  });
});
