/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiProvider } from './GeminiProvider.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

const googleGenAIConstructor = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', () => ({
  GoogleGenAI: googleGenAIConstructor,
  Type: { OBJECT: 'object' },
}));

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

vi.mock('@vybestack/llxprt-code-core/code_assist/codeAssist.js', () => ({
  createCodeAssistContentGenerator: vi.fn(),
}));

const mockSettingsService = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  updateSettings: vi.fn(),
  getAllGlobalSettings: vi.fn().mockReturnValue({}),
}));

type GeminiProviderInternals = {
  createGenAIClient: (
    authToken: string,
    authMode: 'vertex-ai' | 'gemini-api-key',
    httpOptions: { headers: Record<string, string> },
    baseURL?: string,
  ) => Promise<unknown>;
};

function mockVertexAISettings(
  project = 'settings-project',
  location = 'europe-west4',
): void {
  mockSettingsService.get.mockImplementation((key: string) => {
    if (key === 'GOOGLE_CLOUD_PROJECT') {
      return project;
    }
    if (key === 'GOOGLE_CLOUD_LOCATION') {
      return location;
    }
    return undefined;
  });
}

function createGenAIClientViaProvider(
  provider: GeminiProvider,
  authToken: string,
  authMode: 'vertex-ai' | 'gemini-api-key',
): Promise<unknown> {
  return (provider as unknown as GeminiProviderInternals).createGenAIClient(
    authToken,
    authMode,
    { headers: {} },
  );
}

function createProviderWithRuntimeSettings(): GeminiProvider {
  const provider = new GeminiProvider();
  provider.setRuntimeSettingsService(
    mockSettingsService as unknown as SettingsService,
  );
  return provider;
}

describe('GeminiProvider Authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.get.mockReset();
    mockSettingsService.getProviderSettings.mockReturnValue({});
    mockSettingsService.getAllGlobalSettings.mockReturnValue({});
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
  });

  it('should check AuthResolver before falling back to Vertex AI', async () => {
    const mockAuthResolver = {
      resolveAuthentication: vi.fn().mockResolvedValue('test-key'),
    };

    const provider = createProviderWithRuntimeSettings();
    (provider as unknown as { authResolver: unknown }).authResolver =
      mockAuthResolver;

    const auth = await (
      provider as unknown as {
        determineBestAuth: () => Promise<{
          authMode: string;
          token: string;
        }>;
      }
    ).determineBestAuth();

    expect(mockAuthResolver.resolveAuthentication).toHaveBeenCalledWith({
      settingsService: expect.anything(),
      includeOAuth: false,
    });
    expect(auth.authMode).toBe('gemini-api-key');
    expect(auth.token).toBe('test-key');
  });

  it('should fallback to Vertex AI if no standard auth', async () => {
    const mockAuthResolver = {
      resolveAuthentication: vi.fn().mockResolvedValue(null),
    };
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/credentials.json';

    const provider = createProviderWithRuntimeSettings();
    (provider as unknown as { authResolver: unknown }).authResolver =
      mockAuthResolver;

    const auth = await (
      provider as unknown as {
        determineBestAuth: () => Promise<{
          authMode: string;
          token: string;
        }>;
      }
    ).determineBestAuth();

    expect(auth.authMode).toBe('vertex-ai');
  });

  it('uses runtime settings for Vertex AI project and location', async () => {
    const mockAuthResolver = {
      resolveAuthentication: vi.fn().mockResolvedValue(null),
    };
    mockVertexAISettings();

    const provider = createProviderWithRuntimeSettings();
    (provider as unknown as { authResolver: unknown }).authResolver =
      mockAuthResolver;

    const auth = await (
      provider as unknown as {
        determineBestAuth: () => Promise<{
          authMode: string;
          token: string;
        }>;
      }
    ).determineBestAuth();

    expect(auth).toStrictEqual({
      authMode: 'vertex-ai',
      token: 'USE_VERTEX_AI',
    });
  });

  it('passes runtime Vertex AI project and location to GoogleGenAI', async () => {
    mockVertexAISettings();

    const provider = createProviderWithRuntimeSettings();

    await createGenAIClientViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai');

    expect(googleGenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'USE_VERTEX_AI',
      vertexai: true,
      project: 'settings-project',
      location: 'europe-west4',
      httpOptions: { headers: {} },
    });
  });

  it('runtime settings override env vars for Vertex AI project and location', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'env-location';
    mockVertexAISettings('settings-project', 'settings-location');
    const provider = createProviderWithRuntimeSettings();

    await createGenAIClientViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai');

    expect(googleGenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'USE_VERTEX_AI',
      vertexai: true,
      project: 'settings-project',
      location: 'settings-location',
      httpOptions: { headers: {} },
    });
  });

  it('falls back to env vars when settings service returns no Vertex AI config', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const provider = createProviderWithRuntimeSettings();

    await createGenAIClientViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai');

    expect(googleGenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'USE_VERTEX_AI',
      vertexai: true,
      project: 'env-project',
      location: 'us-central1',
      httpOptions: { headers: {} },
    });
  });

  it('throws a clear error when Vertex AI project or location is missing', async () => {
    const provider = createProviderWithRuntimeSettings();

    await expect(
      createGenAIClientViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai'),
    ).rejects.toThrow(
      'Vertex AI mode is active but project/location are not configured',
    );
  });

  it('throws when only a Vertex AI project is configured', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project';
    const provider = createProviderWithRuntimeSettings();

    await expect(
      createGenAIClientViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai'),
    ).rejects.toThrow(
      'Vertex AI mode is active but project/location are not configured',
    );
  });

  it('throws when only a Vertex AI location is configured', async () => {
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const provider = createProviderWithRuntimeSettings();

    await expect(
      createGenAIClientViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai'),
    ).rejects.toThrow(
      'Vertex AI mode is active but project/location are not configured',
    );
  });

  it('does not require project and location when application credentials are configured', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/credentials.json';
    const provider = createProviderWithRuntimeSettings();

    await createGenAIClientViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai');

    expect(googleGenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'USE_VERTEX_AI',
      vertexai: true,
      httpOptions: { headers: {} },
    });
  });

  it('requires project and location when only GOOGLE_API_KEY is configured for Vertex AI', async () => {
    process.env.GOOGLE_API_KEY = 'vertex-api-key';
    const provider = createProviderWithRuntimeSettings();

    await expect(
      createGenAIClientViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai'),
    ).rejects.toThrow(
      'Vertex AI mode is active but project/location are not configured',
    );
  });

  it('does not pass Vertex AI project and location for API key auth', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const provider = createProviderWithRuntimeSettings();

    await createGenAIClientViaProvider(provider, 'api-key', 'gemini-api-key');

    expect(googleGenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'api-key',
      vertexai: false,
      httpOptions: { headers: {} },
    });
  });

  it('should respect auth precedence (SettingsService over env var)', async () => {
    process.env.GEMINI_API_KEY = 'env-key';
    mockSettingsService.get.mockImplementation((key: string) => {
      if (key === 'GEMINI_API_KEY') {
        return 'settings-key';
      }
      return undefined;
    });
    const mockAuthResolver = {
      resolveAuthentication: vi.fn(
        ({ settingsService }: { settingsService: SettingsService }) =>
          Promise.resolve(
            settingsService.get('GEMINI_API_KEY') ?? process.env.GEMINI_API_KEY,
          ),
      ),
    };

    const provider = createProviderWithRuntimeSettings();
    (provider as unknown as { authResolver: unknown }).authResolver =
      mockAuthResolver;

    const auth = await (
      provider as unknown as {
        determineBestAuth: () => Promise<{
          authMode: string;
          token: string;
        }>;
      }
    ).determineBestAuth();

    expect(auth.token).toBe('settings-key');
    expect(mockAuthResolver.resolveAuthentication).toHaveBeenCalledWith({
      settingsService: mockSettingsService,
      includeOAuth: false,
    });
  });
});
