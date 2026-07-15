/**
 * Tests for issue #2411: base-URL-aware OAuth eligibility for Anthropic.
 *
 * Bug: a z.ai/GLM profile that uses the Anthropic provider with a third-party
 * base-url (https://api.z.ai/api/anthropic) and an API key unexpectedly
 * triggers Anthropic OAuth (the /auth anthropic device flow against
 * api.anthropic.com) mid-session. Root cause: AnthropicProvider.supportsOAuth()
 * is unconditionally true and the alias provider is always constructed with an
 * oauthManager, so whenever non-OAuth credential resolution returns null the
 * resolver falls through to oauthManager.getToken('anthropic') — ignoring the
 * z.ai base URL entirely.
 *
 * Fix: gate the `includeOAuth: true` call sites in BaseProvider on a new
 * `isOAuthEligible(baseURL)` hook that AnthropicProvider overrides to return
 * false for any host other than anthropic.com. For non-eligible base URLs the
 * provider now throws a clear credential error instead of triggering OAuth.
 *
 * Approach note: these tests construct AnthropicProvider WITH a real
 * oauthManager stub (getToken/isAuthenticated/isOAuthEnabled vi.fn()s) so the
 * base-URL-aware eligibility gating inside BaseProvider is genuinely exercised
 * end-to-end through the real AuthPrecedenceResolver. We do NOT override
 * getAuthTokenForPrompt/getAuthToken — the eligibility decision happens inside
 * BaseProvider and must be proven by observing whether the stub oauthManager's
 * getToken is called. This is the preferred path over a subclass seam because
 * it tests the real production code path that the bug traverses.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AnthropicProvider,
  isAnthropicOAuthBaseURL,
} from './AnthropicProvider.js';
import type { OAuthManager } from '@vybestack/llxprt-code-auth';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import {
  createProviderWithRuntime,
  createRuntimeConfigStub,
} from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    toProviderFormat: vi.fn((tools: unknown[]) => tools),
    fromProviderFormat: vi.fn((rawToolCall: unknown) => [rawToolCall]),
    convertToolDeclarationsToAnthropic: vi.fn(() => []),
    convertToolDeclarationsToFormat: vi.fn(() => undefined),
  })),
}));

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(
    async () => "You are Claude Code, Anthropic's official CLI for Claude.",
  ),
}));

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

const sdkConstructorCalls: Array<Record<string, unknown>> = [];
const mockMessagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    sdkConstructorCalls.push({ ...opts });
    return {
      _options: opts,
      messages: {
        create: mockMessagesCreate,
      },
      beta: {
        models: {
          list: vi.fn(),
        },
      },
    };
  }),
}));

const ZAI_BASE_URL = 'https://api.z.ai/api/anthropic';
const OAUTH_TOKEN = 'sk-ant-oat-oauth-token';

function lastSdkConstructorAuth(): {
  authToken?: string;
  apiKey?: string;
} {
  if (sdkConstructorCalls.length === 0) {
    return {};
  }
  const last = sdkConstructorCalls[sdkConstructorCalls.length - 1];
  return {
    authToken: typeof last.authToken === 'string' ? last.authToken : undefined,
    apiKey: typeof last.apiKey === 'string' ? last.apiKey : undefined,
  };
}

function resetSdkTracking(): void {
  sdkConstructorCalls.length = 0;
}

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * Advances the generator once and returns the Error it throws. Fails the test
 * if the generator does NOT throw (the #2411 gating tests all expect a loud
 * credential error). Centralizes the catch-and-assert pattern shared by the
 * z.ai gating test and the LB-delegate test.
 */
async function captureGeneratorError(
  generator: AsyncIterableIterator<IContent>,
): Promise<Error> {
  try {
    await generator.next();
  } catch (error) {
    if (isError(error)) {
      return error;
    }
    throw new Error(`Expected an Error to be thrown, got: ${String(error)}`);
  }
  throw new Error('Expected the generator to throw, but it did not');
}

function nonStreamingResponse(text = 'response'): Record<string, unknown> {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

/**
 * The shape of the OAuth manager stub.
 *
 * `getToken`, `isAuthenticated`, `getOAuthToken`, and `forceRefreshToken` are
 * the four members declared on the real `OAuthManager` interface exported from
 * `@vybestack/llxprt-code-auth` (see `packages/auth/src/precedence.ts`). Typing
 * the stub as a `Pick` of that interface means the stub's method signatures
 * are compile-checked against the real contract rather than erased via a
 * double cast.
 *
 * `getOAuthToken` and `forceRefreshToken` are optional on `OAuthManager`; we
 * declare them as required here via `Required<Pick<...>>` so the object
 * literal must provide them (the stub does) and so callers can reference them
 * without a `?.`.
 *
 * `isOAuthEnabled` is NOT part of `OAuthManager`. The production
 * `AuthPrecedenceResolver` accesses it via a structural cast to its internal
 * `OAuthEnablementManager extends OAuthManager` extension
 * (`typeof managerWithCheck?.isOAuthEnabled !== 'function'`). We declare it
 * explicitly here — typed to match that extension's signature — so the stub
 * is genuinely callable through that structural cast without any `any`. It is
 * present so the resolver does not consider OAuth "disabled by the manager"
 * (which would short-circuit the OAuth path these tests exercise); the tests
 * never assert on it directly.
 */
type OAuthManagerStub = Required<
  Pick<OAuthManager, 'getToken' | 'isAuthenticated' | 'getOAuthToken'>
> &
  Pick<OAuthManager, 'forceRefreshToken'> & {
    isOAuthEnabled: (
      provider: string,
    ) => boolean | Promise<boolean | undefined>;
  };

/**
 * Builds a stub OAuthManager sufficient for the real AuthPrecedenceResolver to
 * reach resolveOAuthAuthentication(): getToken returns an OAuth token,
 * isAuthenticated returns true, isOAuthEnabled('anthropic') returns true (so
 * the manager does not disable OAuth), and getOAuthToken returns null.
 */
function createOAuthManagerStub(): OAuthManagerStub {
  return {
    getToken: vi.fn(async () => OAUTH_TOKEN),
    isAuthenticated: vi.fn(async () => true),
    getOAuthToken: vi.fn(async () => null),
    isOAuthEnabled: vi.fn((provider: string) => provider === 'anthropic'),
    forceRefreshToken: vi.fn(async () => null),
  };
}

/**
 * Adapts the structural stub to the OAuthManager parameter type in a single
 * place. The `unknown` intermediate is required only because OAuthManagerStub
 * carries the extra `isOAuthEnabled` member (part of the resolver's internal
 * OAuthEnablementManager extension, not the base OAuthManager interface).
 * Centralizing the cast here means the stub shape has exactly one adaptation
 * point if the real interface drifts.
 */
function toOAuthManager(stub: OAuthManagerStub): OAuthManager {
  return stub as unknown as OAuthManager;
}

describe('Issue #2411: base-URL-aware OAuth eligibility for Anthropic', () => {
  let runtimeContext: ProviderRuntimeContext;
  let settingsService: SettingsService;
  let runtimeIdCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSdkTracking();
    runtimeIdCounter = 0;
    mockMessagesCreate.mockResolvedValue(nonStreamingResponse());
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  /**
   * Centralizes the runtime-context wiring shared by buildOAuthOnlyProvider
   * and the inline tests that call createProviderWithRuntime directly:
   * publishes result.runtime / result.settingsService to the describe-scoped
   * variables, ensures runtime.config has a getEphemeralSettings hook that
   * surfaces the merged global + anthropic settings, and activates the
   * runtime context. Parameter is typed to the return of
   * createProviderWithRuntime<AnthropicProvider> so the wiring is
   * compile-checked.
   */
  const wireRuntime = (
    result: ReturnType<typeof createProviderWithRuntime<AnthropicProvider>>,
  ): void => {
    runtimeContext = result.runtime;
    settingsService = result.settingsService;
    runtimeContext.config ??= createRuntimeConfigStub(settingsService);
    runtimeContext.config.getEphemeralSettings = () => ({
      ...settingsService.getAllGlobalSettings(),
      ...settingsService.getProviderSettings('anthropic'),
    });
    setActiveProviderRuntimeContext(runtimeContext);
  };

  /**
   * Wires up a provider + runtime where OAuth is the ONLY available credential
   * (no auth-key, no env var, no constructor key) so the sole path to a token
   * is oauthManager.getToken. The oauthManager is real (a stub) and injected
   * through the AnthropicProvider constructor, exercising the production
   * AuthPrecedenceResolver path in BaseProvider.
   */
  const buildOAuthOnlyProvider = (
    baseURL?: string,
  ): {
    provider: AnthropicProvider;
    oauthManager: ReturnType<typeof createOAuthManagerStub>;
  } => {
    const oauthManager = createOAuthManagerStub();
    const result = createProviderWithRuntime<AnthropicProvider>(
      ({ settingsService: svc }) => {
        // No auth-key, no auth-keyfile, no auth-key-name — OAuth is the only
        // credential path. activeProvider='anthropic' enables global auth
        // resolution but none is configured.
        svc.set('activeProvider', 'anthropic');
        svc.setProviderSetting('anthropic', 'streaming', 'disabled');
        if (baseURL) {
          svc.setProviderSetting('anthropic', 'base-url', baseURL);
        }
        return new AnthropicProvider(
          undefined,
          undefined,
          TEST_PROVIDER_CONFIG,
          toOAuthManager(oauthManager),
        );
      },
      {
        runtimeId: `anthropic.issue2411.test.${(runtimeIdCounter += 1)}`,
        metadata: { source: 'AnthropicProvider.issue2411.test.ts' },
      },
    );

    wireRuntime(result);
    return { provider: result.provider, oauthManager };
  };

  const buildCallOptions = (
    contents: IContent[],
    overrides: Omit<ProviderCallOptionsInit, 'providerName' | 'contents'> = {},
  ) =>
    createProviderCallOptions({
      providerName: 'anthropic',
      contents,
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      // Non-streaming so the SDK mock's messages.create returns a plain object.
      ephemerals: { streaming: 'disabled', ...(overrides.ephemerals ?? {}) },
      ...overrides,
    });

  describe('isAnthropicOAuthBaseURL helper', () => {
    it('returns true for undefined base URL', () => {
      expect(isAnthropicOAuthBaseURL(undefined)).toBe(true);
    });

    it('returns true for empty string base URL', () => {
      expect(isAnthropicOAuthBaseURL('')).toBe(true);
    });

    it('returns true for whitespace-only base URL', () => {
      expect(isAnthropicOAuthBaseURL('   ')).toBe(true);
    });

    it('returns true for https://api.anthropic.com', () => {
      expect(isAnthropicOAuthBaseURL('https://api.anthropic.com')).toBe(true);
    });

    it('returns true for https://api.anthropic.com/v1', () => {
      expect(isAnthropicOAuthBaseURL('https://api.anthropic.com/v1')).toBe(
        true,
      );
    });

    it('returns true for an anthropic.com subdomain', () => {
      expect(isAnthropicOAuthBaseURL('https://foo.anthropic.com')).toBe(true);
    });

    it('is case-insensitive on the hostname', () => {
      expect(isAnthropicOAuthBaseURL('https://API.ANTHROPIC.COM')).toBe(true);
    });

    it('returns false for a z.ai gateway', () => {
      expect(isAnthropicOAuthBaseURL(ZAI_BASE_URL)).toBe(false);
    });

    it('returns false for an unrelated host', () => {
      expect(isAnthropicOAuthBaseURL('https://example.com')).toBe(false);
    });

    it('returns false for a malformed URL', () => {
      expect(isAnthropicOAuthBaseURL('not a url')).toBe(false);
    });

    it('returns false for a suffix-spoofing host (anthropic.com.evil.com)', () => {
      expect(
        isAnthropicOAuthBaseURL('https://api.anthropic.com.evil.com'),
      ).toBe(false);
    });

    it('returns false for a userinfo-spoofing URL (api.anthropic.com@evil.com)', () => {
      expect(
        isAnthropicOAuthBaseURL('https://api.anthropic.com@evil.com'),
      ).toBe(false);
    });

    it('returns false for a host that merely contains "anthropic.com" as a substring', () => {
      expect(isAnthropicOAuthBaseURL('https://notanthropic.com')).toBe(false);
    });

    it('returns true for http://api.anthropic.com (host-only match; does not enforce TLS)', () => {
      // Documents that eligibility is decided purely by hostname, not scheme.
      // Protocol enforcement is out of scope for #2411 (host-based OAuth
      // routing); api.anthropic.com is HTTPS-only in practice.
      expect(isAnthropicOAuthBaseURL('http://api.anthropic.com')).toBe(true);
    });
  });

  describe('OAuth gating by base URL through the real resolver', () => {
    it('does NOT trigger Anthropic OAuth when a third-party base-url is configured and no key resolves', async () => {
      const { provider, oauthManager } = buildOAuthOnlyProvider(ZAI_BASE_URL);

      const callOptions = buildCallOptions([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello z.ai' }],
        },
      ]);

      const generator = provider.generateChatCompletion(callOptions);

      const thrownError = await captureGeneratorError(generator);

      // OAuth must never have been requested for the third-party endpoint.
      expect(oauthManager.getToken).not.toHaveBeenCalled();

      // The call must reject with a credential error naming the base URL and
      // telling the user to configure an explicit key — NOT the generic
      // "/auth anthropic" message.
      const message = thrownError.message;
      expect(message).toContain(ZAI_BASE_URL);
      expect(message).not.toContain('/auth anthropic');
      expect(message.toLowerCase()).toContain('api key');

      // The SDK must never have been constructed with an OAuth token.
      const sdkAuth = lastSdkConstructorAuth();
      expect(sdkAuth.authToken).toBeUndefined();
    });

    it('still resolves Anthropic OAuth when base-url is unset (real Anthropic account)', async () => {
      const { provider, oauthManager } = buildOAuthOnlyProvider(undefined);

      const callOptions = buildCallOptions([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello anthropic' }],
        },
      ]);

      const generator = provider.generateChatCompletion(callOptions);
      await generator.next();

      // OAuth must have been resolved for a real Anthropic account.
      expect(oauthManager.getToken).toHaveBeenCalled();

      const sdkAuth = lastSdkConstructorAuth();
      expect(sdkAuth.authToken).toBe(OAUTH_TOKEN);
    });

    it('still resolves Anthropic OAuth when base-url is api.anthropic.com', async () => {
      const { provider, oauthManager } = buildOAuthOnlyProvider(
        'https://api.anthropic.com',
      );

      const callOptions = buildCallOptions([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello anthropic' }],
        },
      ]);

      const generator = provider.generateChatCompletion(callOptions);
      await generator.next();

      expect(oauthManager.getToken).toHaveBeenCalled();

      const sdkAuth = lastSdkConstructorAuth();
      expect(sdkAuth.authToken).toBe(OAUTH_TOKEN);
    });

    it('does NOT trigger OAuth for an LB-delegate call shape (activeProvider=load-balancer, resolved.baseURL=z.ai, empty authToken)', async () => {
      // Simulate how the LoadBalancingProvider delegates to the Anthropic
      // provider: the delegate receives GenerateChatOptions whose
      // resolved.baseURL is the z.ai URL and resolved.authToken is absent,
      // while SettingsService.activeProvider === 'load-balancer' (NOT
      // 'anthropic'). OAuth is globally enabled for anthropic (the stub
      // oauthManager.isOAuthEnabled('anthropic') returns true) and no
      // non-OAuth credential is resolvable under the delegated provider. The
      // ONLY way a token could appear is oauthManager.getToken — which must
      // NOT be called.
      const oauthManager = createOAuthManagerStub();
      const result = createProviderWithRuntime<AnthropicProvider>(
        ({ settingsService: svc }) => {
          // activeProvider='load-balancer' reproduces the LB gating where
          // shouldUseGlobalAuth / global-auth resolution is disabled for the
          // anthropic delegate. No auth-key / auth-keyfile / auth-key-name is
          // set anywhere, so no non-OAuth credential resolves.
          svc.set('activeProvider', 'load-balancer');
          svc.setProviderSetting('anthropic', 'streaming', 'disabled');
          // Deliberately do NOT set provider base-url in settings — the LB
          // delegate carries the base URL on the CALL's resolved options.
          return new AnthropicProvider(
            undefined,
            undefined,
            TEST_PROVIDER_CONFIG,
            toOAuthManager(oauthManager),
          );
        },
        {
          runtimeId: 'anthropic.issue2411.lb-delegate.test',
          metadata: { source: 'AnthropicProvider.issue2411.test.ts' },
        },
      );

      wireRuntime(result);

      const provider = result.provider;

      // resolved.baseURL carries the z.ai URL exactly as an LB delegate would;
      // resolved.authToken is intentionally omitted to simulate the lost /
      // absent sub-profile token (createResolvedOptions falls through to the
      // empty-token branch of buildProviderClient).
      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'hello via LB' }],
          },
        ],
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config,
        ephemerals: { streaming: 'disabled' },
        resolved: {
          // The mock SDK ignores the model entirely; use a generic placeholder
          // so this test does not appear to depend on a specific model version.
          model: 'test-model',
          baseURL: ZAI_BASE_URL,
        },
      });

      const generator = provider.generateChatCompletion(callOptions);

      const thrownError = await captureGeneratorError(generator);

      // Core anti-regression assertion for #2411: OAuth must NEVER be
      // requested for a third-party endpoint reached through an LB delegate.
      expect(oauthManager.getToken).not.toHaveBeenCalled();

      const message = thrownError.message;
      expect(message).toContain(ZAI_BASE_URL);
      expect(message).not.toContain('/auth anthropic');
      expect(message.toLowerCase()).toContain('api key');

      const sdkAuth = lastSdkConstructorAuth();
      expect(sdkAuth.authToken).toBeUndefined();
    });

    it('an explicit API key is still used against a third-party base-url (no OAuth, no error)', async () => {
      const oauthManager = createOAuthManagerStub();
      const result = createProviderWithRuntime<AnthropicProvider>(
        ({ settingsService: svc }) => {
          svc.set('activeProvider', 'anthropic');
          svc.set('auth-key', 'zai-explicit-api-key');
          svc.setProviderSetting('anthropic', 'streaming', 'disabled');
          svc.setProviderSetting('anthropic', 'base-url', ZAI_BASE_URL);
          return new AnthropicProvider(
            undefined,
            undefined,
            TEST_PROVIDER_CONFIG,
            toOAuthManager(oauthManager),
          );
        },
        {
          runtimeId: 'anthropic.issue2411.explicit-key.test',
          metadata: { source: 'AnthropicProvider.issue2411.test.ts' },
        },
      );

      wireRuntime(result);

      const provider = result.provider;
      const callOptions = buildCallOptions([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello z.ai with key' }],
        },
      ]);

      const generator = provider.generateChatCompletion(callOptions);
      await generator.next();

      // Explicit key resolves; OAuth must not be touched.
      expect(oauthManager.getToken).not.toHaveBeenCalled();

      const sdkAuth = lastSdkConstructorAuth();
      expect(sdkAuth.apiKey).toBe('zai-explicit-api-key');
      expect(sdkAuth.authToken).toBeUndefined();
    });
  });
});
