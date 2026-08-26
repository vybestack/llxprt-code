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
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LLXPRT_DEFAULT_PROVIDER;

    await loadConfig({} as never, [], 'test-task-id');

    // Unconfigured: no Gemini auth fallback. Provider-neutral.
    expect(Config.prototype.refreshAuth).not.toHaveBeenCalled();
  });

  it('ignores the retired USE_CCPA authentication selector', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockRejectedValue(
      new Error('refreshAuth must not be called'),
    );

    delete process.env.LLXPRT_DEFAULT_PROVIDER;
    process.env.USE_CCPA = 'true';

    const config = await loadConfig({} as never, [], 'test-task-id');

    expect(config.getProvider()).toBe(UNCONFIGURED_PROVIDER);
  });

  it('does not select a provider from Vertex credentials', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockRejectedValue(
      new Error('refreshAuth must not be called'),
    );

    delete process.env.LLXPRT_DEFAULT_PROVIDER;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/adc.json';

    const config = await loadConfig({} as never, [], 'test-task-id');

    expect(config.getProvider()).toBe(UNCONFIGURED_PROVIDER);
  });

  it('does not map an OTLP endpoint environment variable into telemetry settings', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockResolvedValue(undefined);
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://collector.example';

    const config = await loadConfig(
      { telemetry: { enabled: true, logPrompts: false } },
      [],
      'test-task-id',
    );

    expect(config.getTelemetrySettings()).not.toHaveProperty('otlpEndpoint');
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

  it('remains unconfigured when GEMINI_API_KEY is set', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockRejectedValue(
      new Error('refreshAuth must not be called'),
    );

    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LLXPRT_DEFAULT_PROVIDER;
    process.env.GEMINI_API_KEY = 'test-key';

    const config = await loadConfig({} as never, [], 'test-task-id');

    expect(config.getProvider()).toBe(UNCONFIGURED_PROVIDER);
  });

  it('preserves an explicit Gemini provider without refreshing authentication', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(Config.prototype, 'refreshAuth').mockRejectedValue(
      new Error('refreshAuth must not be called'),
    );

    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_API_KEY;
    process.env.LLXPRT_DEFAULT_PROVIDER = 'gemini';

    const config = await loadConfig({} as never, [], 'test-task-id');

    expect(config.getProvider()).toBe('gemini');
  });

  it('treats whitespace-only LLXPRT_DEFAULT_PROVIDER as unconfigured', async () => {
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    vi.spyOn(Config.prototype, 'initialize').mockResolvedValue(undefined);
    const refreshAuthSpy = vi
      .spyOn(Config.prototype, 'refreshAuth')
      .mockResolvedValue(undefined);

    delete process.env.GEMINI_API_KEY;
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
