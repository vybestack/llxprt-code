/**
 * @plan PLAN-20251125-LOCALAUTH.P01
 * @requirement REQ-LOCAL-001
 * Tests for local endpoint authentication bypass (Issue #598)
 *
 * Local endpoints (localhost, 127.0.0.1, private IPs like 192.168.x.x)
 * should not require authentication, as they are typically used with
 * local AI servers like Ollama that don't require API keys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../settings/SettingsService.js';
import { OpenAIProvider } from '../OpenAIProvider.js';
import OpenAI from 'openai';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../../runtime/providerRuntimeContext.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '../../../test-utils/providerCallOptions.js';
import { isLocalEndpoint } from '../../utils/localEndpoint.js';

vi.mock('openai', () => {
  class FakeOpenAI {
    static instances: Set<symbol> = new Set();
    static created: symbol[] = [];
    static requests: Array<{ request: Record<string, unknown> }> = [];
    static lastOptions: Record<string, unknown> | null = null;

    static reset(): void {
      FakeOpenAI.instances.clear();
      FakeOpenAI.created = [];
      FakeOpenAI.requests = [];
      FakeOpenAI.lastOptions = null;
    }

    readonly instanceId: symbol;
    options: Record<string, unknown>;

    constructor(opts: Record<string, unknown>) {
      this.instanceId = Symbol('openai-client');
      FakeOpenAI.instances.add(this.instanceId);
      FakeOpenAI.created.push(this.instanceId);
      this.options = opts;
      FakeOpenAI.lastOptions = opts;
    }

    chat = {
      completions: {
        create: vi.fn(async (request: Record<string, unknown>) => {
          FakeOpenAI.requests.push({ request });
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                choices: [
                  {
                    delta: { content: 'local-mock-response' },
                    finish_reason: 'stop',
                    index: 0,
                  },
                ],
                usage: {
                  prompt_tokens: 0,
                  completion_tokens: 0,
                  total_tokens: 0,
                },
              };
            },
          };
        }),
      },
    };
  }

  return { default: FakeOpenAI };
});

const FakeOpenAIClass = OpenAI as unknown as {
  instances: Set<symbol>;
  created: symbol[];
  requests: Array<{ request: Record<string, unknown> }>;
  lastOptions: Record<string, unknown> | null;
  reset(): void;
};

/**
 * Test provider that allows us to control auth token behavior
 * For local endpoint tests, we need to NOT override getAuthToken
 * so the real auth resolution logic is exercised
 */
class LocalTestOpenAIProvider extends OpenAIProvider {
  private authTokenOverride: string | null = null;

  setAuthTokenOverride(token: string | null): void {
    this.authTokenOverride = token;
  }

  protected override async getAuthToken(): Promise<string> {
    if (this.authTokenOverride !== null) {
      return this.authTokenOverride;
    }
    // Return empty string to simulate no auth configured
    return '';
  }
}

const createSettings = (overrides: { callId: string; baseUrl?: string }) => {
  const svc = new SettingsService();
  svc.set('call-id', overrides.callId);
  if (overrides.baseUrl) {
    svc.set('base-url', overrides.baseUrl);
    svc.setProviderSetting('openai', 'base-url', overrides.baseUrl);
  }
  return svc;
};

function buildCallOptions(
  provider: OpenAIProvider,
  overrides: Omit<ProviderCallOptionsInit, 'providerName'> = {},
) {
  const { contents = [], ...rest } = overrides;
  return createProviderCallOptions({
    providerName: provider.name,
    contents,
    ...rest,
  });
}

beforeEach(() => {
  FakeOpenAIClass.reset();
  // Clear environment variables that could interfere with auth tests
  // This is critical for CI environments which may have OPENAI_API_KEY set
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('OPENAI_BASE_URL', '');

  setActiveProviderRuntimeContext(
    createProviderRuntimeContext({
      settingsService: new SettingsService(),
      runtimeId: 'local-endpoint-test',
    }),
  );
});

afterEach(() => {
  clearActiveProviderRuntimeContext();
  vi.unstubAllEnvs();
});

describe('isLocalEndpoint utility', () => {
  it('returns true for localhost', () => {
    expect(isLocalEndpoint('http://localhost:11434/v1')).toBe(true);
    expect(isLocalEndpoint('http://localhost/v1')).toBe(true);
    expect(isLocalEndpoint('https://localhost:8080')).toBe(true);
  });

  it('returns true for 127.x.x.x loopback range', () => {
    // Standard loopback
    expect(isLocalEndpoint('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLocalEndpoint('http://127.0.0.1/v1')).toBe(true);
    expect(isLocalEndpoint('https://127.0.0.1:8080')).toBe(true);
    // Full loopback range (127.0.0.0/8)
    expect(isLocalEndpoint('http://127.0.0.2:11434/v1')).toBe(true);
    expect(isLocalEndpoint('http://127.1.0.1:11434/v1')).toBe(true);
    expect(isLocalEndpoint('http://127.255.255.255:11434/v1')).toBe(true);
  });

  it('returns true for IPv6 localhost', () => {
    expect(isLocalEndpoint('http://[::1]:11434/v1')).toBe(true);
    expect(isLocalEndpoint('http://[::1]/v1')).toBe(true);
  });

  it('returns true for private IP ranges (192.168.x.x)', () => {
    expect(isLocalEndpoint('http://192.168.1.250:11434/v1')).toBe(true);
    expect(isLocalEndpoint('http://192.168.0.1/v1')).toBe(true);
    expect(isLocalEndpoint('http://192.168.255.255:8080')).toBe(true);
  });

  it('returns true for private IP ranges (10.x.x.x)', () => {
    expect(isLocalEndpoint('http://10.0.0.1:11434/v1')).toBe(true);
    expect(isLocalEndpoint('http://10.255.255.255/v1')).toBe(true);
  });

  it('returns true for private IP ranges (172.16-31.x.x)', () => {
    expect(isLocalEndpoint('http://172.16.0.1:11434/v1')).toBe(true);
    expect(isLocalEndpoint('http://172.31.255.255/v1')).toBe(true);
  });

  it('returns false for public endpoints', () => {
    expect(isLocalEndpoint('https://api.openai.com/v1')).toBe(false);
    expect(isLocalEndpoint('https://api.anthropic.com/v1')).toBe(false);
    expect(isLocalEndpoint('https://api.groq.com/v1')).toBe(false);
  });

  it('returns false for undefined/empty URLs', () => {
    expect(isLocalEndpoint(undefined)).toBe(false);
    expect(isLocalEndpoint('')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(isLocalEndpoint('not-a-url')).toBe(false);
    expect(isLocalEndpoint('://invalid')).toBe(false);
  });
});

describe('OpenAI provider local endpoint authentication', () => {
  describe('local endpoints without authentication', () => {
    it('allows connection to localhost without auth token @requirement:REQ-LOCAL-001', async () => {
      const provider = new LocalTestOpenAIProvider(
        undefined, // No API key
        'http://localhost:11434/v1',
      );
      const settings = createSettings({
        callId: 'ollama-local',
        baseUrl: 'http://localhost:11434/v1',
      });

      const callOptions = buildCallOptions(provider, {
        settings,
        runtimeId: 'ollama-local',
      });

      // Should NOT throw REQ-SP4-003 error
      const generator = provider.generateChatCompletion(callOptions);
      await expect(generator.next()).resolves.toBeDefined();
      expect(FakeOpenAIClass.created).toHaveLength(1);
    });

    it('allows connection to 127.0.0.1 without auth token @requirement:REQ-LOCAL-001', async () => {
      const provider = new LocalTestOpenAIProvider(
        undefined,
        'http://127.0.0.1:11434/v1',
      );
      const settings = createSettings({
        callId: 'ollama-127',
        baseUrl: 'http://127.0.0.1:11434/v1',
      });

      const callOptions = buildCallOptions(provider, {
        settings,
        runtimeId: 'ollama-127',
      });

      const generator = provider.generateChatCompletion(callOptions);
      await expect(generator.next()).resolves.toBeDefined();
      expect(FakeOpenAIClass.created).toHaveLength(1);
    });

    it('allows connection to private IP (192.168.x.x) without auth token @requirement:REQ-LOCAL-001', async () => {
      const provider = new LocalTestOpenAIProvider(
        undefined,
        'http://192.168.1.250:11434/v1',
      );
      const settings = createSettings({
        callId: 'ollama-lan',
        baseUrl: 'http://192.168.1.250:11434/v1',
      });

      const callOptions = buildCallOptions(provider, {
        settings,
        runtimeId: 'ollama-lan',
      });

      const generator = provider.generateChatCompletion(callOptions);
      await expect(generator.next()).resolves.toBeDefined();
      expect(FakeOpenAIClass.created).toHaveLength(1);
    });

    it('passes empty string as apiKey to OpenAI client for local endpoints', async () => {
      const provider = new LocalTestOpenAIProvider(
        undefined,
        'http://localhost:11434/v1',
      );
      const settings = createSettings({
        callId: 'check-apikey',
        baseUrl: 'http://localhost:11434/v1',
      });

      const callOptions = buildCallOptions(provider, {
        settings,
        runtimeId: 'check-apikey',
      });

      await provider.generateChatCompletion(callOptions).next();

      // Verify the client was created with empty apiKey
      expect(FakeOpenAIClass.lastOptions?.apiKey).toBe('');
    });
  });

  describe('remote endpoints require authentication', () => {
    it('throws REQ-SP4-003 error for api.openai.com without auth', async () => {
      const provider = new LocalTestOpenAIProvider(
        undefined,
        'https://api.openai.com/v1',
      );
      const settings = createSettings({
        callId: 'remote-no-auth',
        baseUrl: 'https://api.openai.com/v1',
      });

      const callOptions = buildCallOptions(provider, {
        settings,
        runtimeId: 'remote-no-auth',
      });

      const generator = provider.generateChatCompletion(callOptions);
      await expect(generator.next()).rejects.toThrow('REQ-SP4-003');
    });

    it('allows remote endpoints with auth token', async () => {
      const provider = new LocalTestOpenAIProvider(
        'sk-test-key',
        'https://api.openai.com/v1',
      );
      provider.setAuthTokenOverride('sk-test-key');

      const settings = createSettings({
        callId: 'remote-with-auth',
        baseUrl: 'https://api.openai.com/v1',
      });

      const callOptions = buildCallOptions(provider, {
        settings,
        runtimeId: 'remote-with-auth',
      });

      const generator = provider.generateChatCompletion(callOptions);
      await expect(generator.next()).resolves.toBeDefined();
      expect(FakeOpenAIClass.created).toHaveLength(1);
    });
  });

  describe('local endpoints with optional auth', () => {
    it('uses provided auth token for local endpoint if available', async () => {
      const provider = new LocalTestOpenAIProvider(
        'optional-local-key',
        'http://localhost:11434/v1',
      );
      provider.setAuthTokenOverride('optional-local-key');

      const settings = createSettings({
        callId: 'local-with-auth',
        baseUrl: 'http://localhost:11434/v1',
      });

      const callOptions = buildCallOptions(provider, {
        settings,
        runtimeId: 'local-with-auth',
      });

      await provider.generateChatCompletion(callOptions).next();

      // Should use the provided key even for local endpoints
      expect(FakeOpenAIClass.lastOptions?.apiKey).toBe('optional-local-key');
    });
  });
});
