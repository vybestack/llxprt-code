/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { GeminiProvider } from './GeminiProvider.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

// These assertions are about the client OPTIONS the provider builds, not about
// which SDK constructs the client. Mocking the factory keeps the assertions
// pointed at our own code and survives the transport change.
const googleGenAIConstructor = vi.fn();

import type { CreateGeminiApiClient } from './GeminiProvider.js';
// The factory is injected into GeminiProvider rather than module-mocked:
// `vi.mock` registers process-wide and bun hoists it ahead of the whole
// run, so the stub leaked into every suite loaded alongside this one.
const injectedClientFactory =
  googleGenAIConstructor as unknown as CreateGeminiApiClient;

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

const mockSettingsService = {
  get: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
};

type GeminiProviderInternals = {
  buildGoogleGenAIOptions: (
    authToken: string,
    authMode: 'vertex-ai' | 'gemini-api-key',
    httpOptions: { headers: Record<string, string> },
    baseURL?: string,
  ) => unknown;
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

/**
 * Drives the option-building step and hands the result to the injected client
 * factory, which is exactly what createNonOAuthGenerator does.
 *
 * The provider used to expose a createGenAIClient method that did both. #2626
 * removed it along with the serverTools path that owned it, and #2761 replaced
 * the construction half with the injected factory. buildGoogleGenAIOptions is
 * the surviving half, and it is the half these tests are about: the project /
 * location resolution and the missing-config error. Being async keeps the
 * synchronous throw observable as a rejection.
 */
async function createGenAIClientViaProvider(
  provider: GeminiProvider,
  authToken: string,
  authMode: 'vertex-ai' | 'gemini-api-key',
): Promise<unknown> {
  const options = (
    provider as unknown as GeminiProviderInternals
  ).buildGoogleGenAIOptions(authToken, authMode, { headers: {} });
  return injectedClientFactory(options as never);
}

function createProviderWithRuntimeSettings(): GeminiProvider {
  const provider = new GeminiProvider(
    undefined,
    undefined,
    undefined,
    injectedClientFactory,
  );
  provider.setRuntimeSettingsService(
    mockSettingsService as unknown as SettingsService,
  );
  return provider;
}

function readPreferredGeminiApiKey(key: string): string | undefined {
  if (key === 'GEMINI_API_KEY') {
    return 'settings-key';
  }
  return undefined;
}

function resolvePreferredGeminiApiKey(
  settingsService: SettingsService,
): string | undefined {
  const apiKey =
    settingsService.get('GEMINI_API_KEY') ?? process.env.GEMINI_API_KEY;
  if (typeof apiKey !== 'string' && apiKey !== undefined) {
    throw new Error('expected GEMINI_API_KEY to be a string');
  }
  return apiKey;
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
    mockSettingsService.get.mockImplementation(readPreferredGeminiApiKey);
    const mockAuthResolver = {
      resolveAuthentication: vi.fn(
        ({ settingsService }: { settingsService: SettingsService }) =>
          Promise.resolve(resolvePreferredGeminiApiKey(settingsService)),
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

  it('rejects whitespace-only Vertex AI project settings', async () => {
    mockVertexAISettings('   ', 'europe-west4');
    const provider = createProviderWithRuntimeSettings();

    await expect(
      createGenAIClientViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai'),
    ).rejects.toThrow(
      'Vertex AI mode is active but project/location are not configured',
    );
  });

  it('rejects whitespace-only Vertex AI location from the environment', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'env-project';
    process.env.GOOGLE_CLOUD_LOCATION = '   ';
    const provider = createProviderWithRuntimeSettings();

    await expect(
      createGenAIClientViaProvider(provider, 'USE_VERTEX_AI', 'vertex-ai'),
    ).rejects.toThrow(
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
