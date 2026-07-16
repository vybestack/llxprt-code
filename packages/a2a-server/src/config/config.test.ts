/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  ApprovalMode,
  Config,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  PLACEHOLDER_MODEL,
  UNCONFIGURED_PROVIDER,
} from '@vybestack/llxprt-code-core';
import { loadConfig } from './config.js';

const ORIGINAL_ENV = { ...process.env };

describe('loadConfig auth fallback', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('does NOT call refreshAuth when no credentials or provider are set (unconfigured)', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockResolvedValue(undefined);

    delete process.env.GEMINI_API_KEY;
    delete process.env.USE_CCPA;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LLXPRT_DEFAULT_PROVIDER;

    await loadConfig({} as never, [], 'test-task-id');

    // Unconfigured: no Gemini auth fallback. Provider-neutral.
    expect(Config.prototype.refreshAuth).not.toHaveBeenCalled();
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
    expect(config.getApprovalMode()).toBe(ApprovalMode.YOLO);
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
    expect(config.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
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
    expect(config.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
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

describe('loadConfig provider-neutral defaults', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('uses PLACEHOLDER_MODEL (not DEFAULT_GEMINI_MODEL) when no model configured', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockResolvedValue(undefined);

    delete process.env.GEMINI_API_KEY;
    delete process.env.USE_CCPA;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LLXPRT_DEFAULT_PROVIDER;

    const config = await loadConfig({} as never, [], 'test-task-id');
    expect(config.getModel()).toBe(PLACEHOLDER_MODEL);
  });

  it('does NOT call refreshAuth when unconfigured (no Gemini credentials)', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    const refreshAuthSpy = vi
      .spyOn(Config.prototype, 'refreshAuth')
      .mockResolvedValue(undefined);

    delete process.env.GEMINI_API_KEY;
    delete process.env.USE_CCPA;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LLXPRT_DEFAULT_PROVIDER;

    await loadConfig({} as never, [], 'test-task-id');

    // No Gemini credentials and no explicit Gemini provider → must NOT
    // attempt any Gemini auth (stays unconfigured).
    expect(refreshAuthSpy).not.toHaveBeenCalled();
  });

  it('preserves explicit Gemini auth when GEMINI_API_KEY is set', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    const refreshAuthSpy = vi
      .spyOn(Config.prototype, 'refreshAuth')
      .mockResolvedValue(undefined);

    delete process.env.USE_CCPA;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LLXPRT_DEFAULT_PROVIDER;
    process.env.GEMINI_API_KEY = 'test-key';

    await loadConfig({} as never, [], 'test-task-id');

    // Explicit Gemini API key must trigger gemini-api-key auth.
    expect(refreshAuthSpy).toHaveBeenCalledWith('gemini-api-key');
  });

  it('preserves explicit Gemini auth when LLXPRT_DEFAULT_PROVIDER is gemini', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    const refreshAuthSpy = vi
      .spyOn(Config.prototype, 'refreshAuth')
      .mockResolvedValue(undefined);

    delete process.env.GEMINI_API_KEY;
    delete process.env.USE_CCPA;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    process.env.LLXPRT_DEFAULT_PROVIDER = 'gemini';

    await loadConfig({} as never, [], 'test-task-id');

    // Explicit Gemini provider via env → OAuth fallback for Gemini.
    expect(refreshAuthSpy).toHaveBeenCalledWith('oauth-personal');
  });

  it('treats whitespace-only LLXPRT_DEFAULT_PROVIDER as unconfigured', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    const refreshAuthSpy = vi
      .spyOn(Config.prototype, 'refreshAuth')
      .mockResolvedValue(undefined);

    delete process.env.GEMINI_API_KEY;
    delete process.env.USE_CCPA;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    process.env.LLXPRT_DEFAULT_PROVIDER = '   ';

    const config = await loadConfig({} as never, [], 'test-task-id');

    // A whitespace-only env value must not select any provider or trigger auth.
    expect(refreshAuthSpy).not.toHaveBeenCalled();
    expect(config.getProvider()).toBe(UNCONFIGURED_PROVIDER);
  });

  it('trims a padded explicit provider from LLXPRT_DEFAULT_PROVIDER', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockResolvedValue(undefined);

    delete process.env.GEMINI_API_KEY;
    delete process.env.USE_CCPA;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    process.env.LLXPRT_DEFAULT_PROVIDER = '  openai  ';

    const config = await loadConfig({} as never, [], 'test-task-id');

    // The padded value must be trimmed to 'openai'.
    expect(config.getProvider()).toBe('openai');
  });
});
