/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { GeminiProvider } from './GeminiProvider.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

const mockSettingsService = {
  get: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
};

// The GoogleGenAI options the provider hands to the SDK client. These are
// exactly the options `new GoogleGenAI(...)` receives in production, so
// asserting on them pins what the SDK is configured with.
type GeminiProviderInternals = {
  buildGoogleGenAIOptions: (
    authToken: string,
    authMode: 'vertex-ai' | 'gemini-api-key',
    httpOptions: { headers: Record<string, string> },
    baseURL?: string,
  ) => {
    apiKey: string;
    vertexai: boolean;
    project?: string;
    location?: string;
    httpOptions: { headers: Record<string, string>; baseUrl?: string };
  };
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

function buildGenAIOptionsViaProvider(
  provider: GeminiProvider,
  authToken: string,
  authMode: 'vertex-ai' | 'gemini-api-key',
): ReturnType<GeminiProviderInternals['buildGoogleGenAIOptions']> {
  return (
    provider as unknown as GeminiProviderInternals
  ).buildGoogleGenAIOptions(authToken, authMode, { headers: {} });
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
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
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

  it('passes runtime Vertex AI project and location to GoogleGenAI', () => {
    mockVertexAISettings();

    const provider = createProviderWithRuntimeSettings();

    const options = buildGenAIOptionsViaProvider(
      provider,
      'USE_VERTEX_AI',
      'vertex-ai',
    );

    expect(options).toStrictEqual({
      apiKey: 'USE_VERTEX_AI',
      vertexai: true,
      project: 'settings-project',
      location: 'europe-west4',
      httpOptions: { headers: {} },
    });
  });

  it('runtime settings override env vars for Vertex AI project and location', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'env-location';
    mockVertexAISettings('settings-project', 'settings-location');
    const provider = createProviderWithRuntimeSettings();

    const options = buildGenAIOptionsViaProvider(
      provider,
      'USE_VERTEX_AI',
      'vertex-ai',
    );

    expect(options).toStrictEqual({
      apiKey: 'USE_VERTEX_AI',
      vertexai: true,
      project: 'settings-project',
      location: 'settings-location',
      httpOptions: { headers: {} },
    });
  });

  it('falls back to env vars when settings service returns no Vertex AI config', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const provider = createProviderWithRuntimeSettings();

    const options = buildGenAIOptionsViaProvider(
      provider,
      'USE_VERTEX_AI',
      'vertex-ai',
    );

    expect(options).toStrictEqual({
      apiKey: 'USE_VERTEX_AI',
      vertexai: true,
      project: 'env-project',
      location: 'us-central1',
      httpOptions: { headers: {} },
    });
  });

  it('throws a clear error when Vertex AI project or location is missing', () => {
    const provider = createProviderWithRuntimeSettings();

    expect(() =>
      buildGenAIOptionsViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai'),
    ).toThrow(
      'Vertex AI mode is active but project/location are not configured',
    );
  });

  it('throws when only a Vertex AI project is configured', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project';
    const provider = createProviderWithRuntimeSettings();

    expect(() =>
      buildGenAIOptionsViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai'),
    ).toThrow(
      'Vertex AI mode is active but project/location are not configured',
    );
  });

  it('throws when only a Vertex AI location is configured', () => {
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const provider = createProviderWithRuntimeSettings();

    expect(() =>
      buildGenAIOptionsViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai'),
    ).toThrow(
      'Vertex AI mode is active but project/location are not configured',
    );
  });

  it('does not require project and location when application credentials are configured', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/credentials.json';
    const provider = createProviderWithRuntimeSettings();

    const options = buildGenAIOptionsViaProvider(
      provider,
      'USE_VERTEX_AI',
      'vertex-ai',
    );

    expect(options).toStrictEqual({
      apiKey: 'USE_VERTEX_AI',
      vertexai: true,
      httpOptions: { headers: {} },
    });
  });

  it('requires project and location when only GOOGLE_API_KEY is configured for Vertex AI', () => {
    process.env.GOOGLE_API_KEY = 'vertex-api-key';
    const provider = createProviderWithRuntimeSettings();

    expect(() =>
      buildGenAIOptionsViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai'),
    ).toThrow(
      'Vertex AI mode is active but project/location are not configured',
    );
  });

  it('does not pass Vertex AI project and location for API key auth', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const provider = createProviderWithRuntimeSettings();

    const options = buildGenAIOptionsViaProvider(
      provider,
      'api-key',
      'gemini-api-key',
    );

    expect(options).toStrictEqual({
      apiKey: 'api-key',
      vertexai: false,
      httpOptions: { headers: {} },
    });
  });

  it('maps a resolved baseURL into httpOptions.baseUrl for the SDK client', () => {
    const provider = createProviderWithRuntimeSettings();

    const options = (
      provider as unknown as GeminiProviderInternals
    ).buildGoogleGenAIOptions(
      'api-key',
      'gemini-api-key',
      { headers: {} },
      'https://proxy.example.com',
    );

    expect(options.httpOptions).toStrictEqual({
      headers: {},
      baseUrl: 'https://proxy.example.com',
    });
    expect(options.vertexai).toBe(false);
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

  it('rejects whitespace-only Vertex AI project settings', () => {
    mockVertexAISettings('   ', 'europe-west4');
    const provider = createProviderWithRuntimeSettings();

    expect(() =>
      buildGenAIOptionsViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai'),
    ).toThrow(
      'Vertex AI mode is active but project/location are not configured',
    );
  });

  it('rejects whitespace-only Vertex AI location from the environment', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project';
    process.env.GOOGLE_CLOUD_LOCATION = '   ';
    const provider = createProviderWithRuntimeSettings();

    expect(() =>
      buildGenAIOptionsViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai'),
    ).toThrow(
      'Vertex AI mode is active but project/location are not configured',
    );
  });

  // #2946: inside a container sandbox, ambient Google credentials are
  // intentionally unavailable. The auth-failure message must say so and direct
  // the user to save a key with `/key save`, not to set GEMINI_API_KEY (which
  // no longer crosses into the container).
  it('gives a sandbox-aware auth message when LLXPRT_CREDENTIAL_SOCKET is set', async () => {
    const mockAuthResolver = {
      resolveAuthentication: vi.fn().mockResolvedValue(null),
    };
    process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/test-cred-socket.sock';

    const provider = createProviderWithRuntimeSettings();
    (provider as unknown as { authResolver: unknown }).authResolver =
      mockAuthResolver;

    const error = await provider.getAuthMode().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('not available inside a container sandbox');
    // Must point at both halves of the working path: save on the host, load
    // inside the sandbox. Naming only one leaves the user stuck.
    expect(message).toContain('/key save');
    expect(message).toContain('/key load');
    // The sandbox message must NOT direct the user to set GEMINI_API_KEY,
    // because that variable no longer crosses into the container.
    expect(message).not.toContain('Set GEMINI_API_KEY environment variable');
  });

  it('keeps the standard auth message when not in a sandbox', async () => {
    const mockAuthResolver = {
      resolveAuthentication: vi.fn().mockResolvedValue(null),
    };

    const provider = createProviderWithRuntimeSettings();
    (provider as unknown as { authResolver: unknown }).authResolver =
      mockAuthResolver;

    await expect(provider.getAuthMode()).rejects.toThrow(
      'No Gemini authentication configured. Set GEMINI_API_KEY environment variable, use --keyfile, or configure Vertex AI credentials.',
    );
  });

  // An empty LLXPRT_CREDENTIAL_SOCKET means "no socket" to the sanctioned
  // credential factories, which fall through to direct host storage. The
  // message must match that routing rather than claiming a sandbox.
  it('keeps the standard auth message when LLXPRT_CREDENTIAL_SOCKET is empty', async () => {
    const mockAuthResolver = {
      resolveAuthentication: vi.fn().mockResolvedValue(null),
    };
    process.env.LLXPRT_CREDENTIAL_SOCKET = '';

    const provider = createProviderWithRuntimeSettings();
    (provider as unknown as { authResolver: unknown }).authResolver =
      mockAuthResolver;

    await expect(provider.getAuthMode()).rejects.toThrow(
      'No Gemini authentication configured. Set GEMINI_API_KEY environment variable, use --keyfile, or configure Vertex AI credentials.',
    );
  });
});
