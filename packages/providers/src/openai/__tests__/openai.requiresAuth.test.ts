import { restoreEnv, setEnv } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIProvider } from '../OpenAIProvider.js';
import type { NormalizedGenerateChatOptions } from '../../BaseProvider.js';
import type { ResolvedAuthToken } from '../../types/providerRuntime.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import OpenAI from 'openai';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { createOpenAIRawPostTestAdapter } from '../../test-utils/rawPostTestAdapters.js';
import { CredentialResolutionError } from '@vybestack/llxprt-code-auth';

void vi.mock('openai', () => {
  class FakeOpenAI {
    static created: symbol[] = [];
    static lastOptions: Record<string, unknown> | null = null;

    static reset(): void {
      FakeOpenAI.created = [];
      FakeOpenAI.lastOptions = null;
    }

    readonly instanceId: symbol;
    options: Record<string, unknown>;

    constructor(opts: Record<string, unknown>) {
      this.instanceId = Symbol('openai-client');
      FakeOpenAI.created.push(this.instanceId);
      this.options = opts;
      FakeOpenAI.lastOptions = opts;
    }

    chat = {
      completions: {
        create: vi.fn(async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [
                {
                  delta: { content: 'mock-response' },
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
        })),
      },
    };
    post = createOpenAIRawPostTestAdapter(this.chat.completions.create).post;
  }

  return { default: FakeOpenAI };
});

const FakeOpenAIClass = OpenAI as unknown as {
  created: symbol[];
  lastOptions: Record<string, unknown> | null;
  reset(): void;
};

class RecordingDebugLogger extends DebugLogger {
  readonly messages: string[] = [];

  override debug(
    messageOrFactory: string | (() => string),
    ..._args: unknown[]
  ): void {
    this.messages.push(
      typeof messageOrFactory === 'function'
        ? messageOrFactory()
        : messageOrFactory,
    );
  }
}

class RequiresAuthTestProvider extends OpenAIProvider {
  readonly recordingLogger = new RecordingDebugLogger(
    'llxprt:test:openai-auth-exemption',
  );

  protected override async getAuthToken(): Promise<string> {
    return '';
  }

  protected override getLogger(): DebugLogger {
    return this.recordingLogger;
  }

  async createClientForTest(
    options: NormalizedGenerateChatOptions,
  ): Promise<OpenAI> {
    return this.getClient(options);
  }
}

function createSettingsWithRequiresAuth(
  baseUrl: string,
  requiresAuth?: boolean,
): SettingsService {
  const svc = new SettingsService();
  svc.set('call-id', 'requires-auth-test');
  svc.set('base-url', baseUrl);
  svc.setProviderSetting('openai', 'base-url', baseUrl);
  if (requiresAuth !== undefined) {
    svc.setProviderSetting('openai', 'requires-auth', requiresAuth);
  }
  return svc;
}

function buildCallOptions(
  provider: OpenAIProvider,
  overrides: Omit<ProviderCallOptionsInit, 'providerName'> = {},
): ReturnType<typeof createProviderCallOptions> {
  const { contents = [], ...rest } = overrides;
  return createProviderCallOptions({
    providerName: provider.name,
    contents,
    ...rest,
  });
}

function buildNormalizedOptions(
  provider: OpenAIProvider,
  settings: SettingsService,
  authToken: ResolvedAuthToken,
): NormalizedGenerateChatOptions {
  const options = buildCallOptions(provider, {
    settings,
    runtimeId: 'auth-exemption-resolution-failure',
  });
  return {
    ...options,
    metadata: options.metadata ?? {},
    resolved: {
      model: 'auth-exemption-test-model',
      baseURL: 'http://host.docker.internal:1234/v1/',
      authToken,
      streaming: false,
    },
  };
}

describe('requires-auth setting', () => {
  beforeEach(() => {
    FakeOpenAIClass.reset();
    setEnv('OPENAI_API_KEY', '');
    setEnv('OPENAI_BASE_URL', '');

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'requires-auth-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    restoreEnv();
  });

  it('allows connection to remote endpoint without auth when requires-auth is false', async () => {
    const provider = new RequiresAuthTestProvider(
      undefined,
      'http://host.docker.internal:1234/v1/',
    );
    const settings = createSettingsWithRequiresAuth(
      'http://host.docker.internal:1234/v1/',
      false,
    );

    const callOptions = buildCallOptions(provider, {
      settings,
      runtimeId: 'no-auth-required',
    });

    const generator = provider.generateChatCompletion(callOptions);
    await expect(generator.next()).resolves.toBeDefined();
    expect(FakeOpenAIClass.created).toHaveLength(1);
  });

  it('logs a safe diagnostic when auth resolution fails for an exempt endpoint', async () => {
    const forbiddenDetail = 'issue3451-sensitive-failure-detail';
    const provider = new RequiresAuthTestProvider(
      undefined,
      'http://host.docker.internal:1234/v1/',
    );
    const settings = createSettingsWithRequiresAuth(
      'http://host.docker.internal:1234/v1/',
      false,
    );
    const authToken: ResolvedAuthToken = {
      provide: async () => {
        throw new Error(forbiddenDetail);
      },
    };

    await provider.createClientForTest(
      buildNormalizedOptions(provider, settings, authToken),
    );

    const output = provider.recordingLogger.messages.join('\n');
    expect(output).toContain('kind=credential-source-failed');
    expect(output).toContain('auth-exempt endpoint');
    expect(output).not.toContain(forbiddenDetail);
  });

  it('throws auth error for remote endpoint without auth when requires-auth is not set', async () => {
    const provider = new RequiresAuthTestProvider(
      undefined,
      'http://host.docker.internal:1234/v1/',
    );
    const settings = createSettingsWithRequiresAuth(
      'http://host.docker.internal:1234/v1/',
    );

    const callOptions = buildCallOptions(provider, {
      settings,
      runtimeId: 'auth-required-default',
    });

    const generator = provider.generateChatCompletion(callOptions);
    const rejection = generator.next();
    await expect(rejection).rejects.toBeInstanceOf(CredentialResolutionError);
    await expect(rejection).rejects.toMatchObject({
      kind: 'no-credential-configured',
      message: expect.stringContaining(
        'provider=openai; profile=no-profile; runtimeId=auth-required-default',
      ),
    });
  });

  it('throws auth error for remote endpoint without auth when requires-auth is true', async () => {
    const provider = new RequiresAuthTestProvider(
      undefined,
      'http://host.docker.internal:1234/v1/',
    );
    const settings = createSettingsWithRequiresAuth(
      'http://host.docker.internal:1234/v1/',
      true,
    );

    const callOptions = buildCallOptions(provider, {
      settings,
      runtimeId: 'auth-required-explicit',
    });

    const generator = provider.generateChatCompletion(callOptions);
    const rejection = generator.next();
    await expect(rejection).rejects.toBeInstanceOf(CredentialResolutionError);
    await expect(rejection).rejects.toMatchObject({
      kind: 'no-credential-configured',
      message: expect.stringContaining(
        'provider=openai; profile=no-profile; runtimeId=auth-required-explicit',
      ),
    });
  });
});
