/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  RuntimeProvider,
  RuntimeProviderManager,
  IContent,
} from '@vybestack/llxprt-code-core';
import type {
  ExtendedLoadBalancerStats,
  TokenAccountingDiagnostics,
} from '@vybestack/llxprt-code-providers';
import type { ProviderAliasConfig } from '@vybestack/llxprt-code-providers/composition.js';
import { detectApiKeyProvider } from '@vybestack/llxprt-code-providers';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { firstNonEmptyString } from '../utils/coalesce.js';
import {
  getOptionalString,
  hasFunction,
  hasObject,
} from '../utils/typeGuards.js';
const logger = new DebugLogger('llxprt:cli:stats');
type ProviderWithBaseURL = {
  getBaseURL?: () => string | undefined;
};

type ProviderBaseURLWrapper = {
  wrappedProvider?: unknown;
};

function getProviderBaseURL(provider: unknown): string {
  const providerWithGetBaseURL = provider as ProviderWithBaseURL;
  if (typeof providerWithGetBaseURL.getBaseURL === 'function') {
    return providerWithGetBaseURL.getBaseURL() ?? '';
  }

  return '';
}

type ActiveProviderDumpView = {
  getCurrentModel?: () => string | undefined;
  baseURL?: string;
  /**
   * Optional plugin-owned dump conversion. The Gemini provider (contributed by
   * @vybestack/llxprt-plugin-google-gemini) exposes it; the base
   * buildProviderDumpBody dispatcher does not know Gemini wire shapes (#2763).
   */
  buildContextDumpBody?: (
    history: IContent[],
    model?: string,
    config?: unknown,
  ) => Record<string, unknown>;
};

export function getProviderDumpMetadata(
  providerManager?: Pick<RuntimeProviderManager, 'getActiveProviderName'> & {
    getActiveProvider(): ActiveProviderDumpView | undefined;
  },
): {
  providerName: string;
  buildContextDumpBody: ActiveProviderDumpView['buildContextDumpBody'];
  activeModel: string | undefined;
  activeBaseURL: string | undefined;
} {
  const activeProvider: ActiveProviderDumpView | undefined =
    providerManager?.getActiveProvider();
  return {
    providerName: providerManager?.getActiveProviderName() ?? 'backend',
    buildContextDumpBody:
      activeProvider?.buildContextDumpBody?.bind(activeProvider),
    activeModel: activeProvider?.getCurrentModel?.(),
    activeBaseURL:
      activeProvider !== undefined &&
      'baseURL' in activeProvider &&
      typeof activeProvider.baseURL === 'string'
        ? activeProvider.baseURL
        : undefined,
  };
}

type WrappedProvider = Pick<
  RuntimeProvider,
  'name' | 'getCurrentModel' | 'getDefaultModel'
> & {
  wrappedProvider: Pick<
    RuntimeProvider,
    'name' | 'getCurrentModel' | 'getDefaultModel'
  >;
};

function hasWrappedProvider(
  provider: Pick<
    RuntimeProvider,
    'name' | 'getCurrentModel' | 'getDefaultModel'
  >,
): provider is WrappedProvider {
  return (
    'wrappedProvider' in provider &&
    (provider as { wrappedProvider?: unknown }).wrappedProvider !== undefined &&
    (provider as { wrappedProvider?: unknown }).wrappedProvider !== null
  );
}

function unwrapProvider(
  provider: Pick<
    RuntimeProvider,
    'name' | 'getCurrentModel' | 'getDefaultModel'
  >,
): Pick<RuntimeProvider, 'name' | 'getCurrentModel' | 'getDefaultModel'> {
  if (hasWrappedProvider(provider)) {
    return provider.wrappedProvider;
  }
  return provider;
}

function resolveBaseProviderId(
  provider: Pick<
    RuntimeProvider,
    'name' | 'getCurrentModel' | 'getDefaultModel'
  >,
): string {
  const constructorName = provider.constructor.name;
  if (constructorName === 'OpenARuntimeProvider') {
    return 'openai';
  }
  if (constructorName === 'OpenAIResponsesProvider') {
    return 'openai-responses';
  }
  return provider.name;
}

function getProviderBaseUrl(
  provider: Pick<
    RuntimeProvider,
    'name' | 'getCurrentModel' | 'getDefaultModel'
  >,
): string | undefined {
  if (hasObject(provider, 'providerConfig')) {
    const configBaseUrl = getOptionalString(provider.providerConfig, 'baseUrl');
    if (configBaseUrl && configBaseUrl !== 'none') {
      return configBaseUrl;
    }
  }

  if (hasObject(provider, 'baseProviderConfig')) {
    const baseConfigUrl = getOptionalString(
      provider.baseProviderConfig,
      'baseURL',
    );
    if (baseConfigUrl && baseConfigUrl !== 'none') {
      return baseConfigUrl;
    }
  }

  if (hasFunction(provider, 'getBaseURL')) {
    const baseUrl = provider.getBaseURL();
    return typeof baseUrl === 'string' ? baseUrl : undefined;
  }

  return undefined;
}

function buildAliasConfig(
  provider: Pick<
    RuntimeProvider,
    'name' | 'getCurrentModel' | 'getDefaultModel'
  >,
  configBaseUrl: string | undefined,
): ProviderAliasConfig | null {
  const unwrapped = unwrapProvider(provider);
  const baseProviderId = resolveBaseProviderId(unwrapped);

  const resolvedBaseUrl = firstNonEmptyString(
    configBaseUrl && configBaseUrl !== 'none' ? configBaseUrl : undefined,
    getProviderBaseUrl(unwrapped),
  );

  if (!resolvedBaseUrl) {
    return null;
  }

  const defaultModel = firstNonEmptyString(
    unwrapped.getCurrentModel?.(),
    unwrapped.getDefaultModel?.(),
  );

  const aliasConfig: ProviderAliasConfig = {
    baseProvider: baseProviderId,
    'base-url': resolvedBaseUrl,
    description: `User-defined alias for ${baseProviderId}`,
  };

  if (defaultModel) {
    aliasConfig.defaultModel = defaultModel;
  }
  return aliasConfig;
}

type AliasResolveResult =
  | { ok: true; config: ProviderAliasConfig | null }
  | { ok: false; content: string };

export function resolveActiveProviderForAlias(
  providerManager: {
    getActiveProvider():
      | Pick<RuntimeProvider, 'name' | 'getCurrentModel' | 'getDefaultModel'>
      | undefined;
  },
  configBaseUrl: string | undefined,
): AliasResolveResult {
  try {
    const provider = providerManager.getActiveProvider();
    if (provider === undefined) {
      return {
        ok: false,
        content: 'No active provider set. Use /setup to configure a provider.',
      };
    }
    return { ok: true, config: buildAliasConfig(provider, configBaseUrl) };
  } catch (error) {
    return {
      ok: false,
      content: `Failed to determine active provider: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Returns the trimmed URL if it is a non-empty string, otherwise undefined.
 * Empty/whitespace base-url values must fall through so detection continues.
 */
function resolveBaseUrlOrNull(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

interface ProviderConfigCandidate {
  readonly providerConfig?: { readonly 'base-url'?: string };
  readonly baseProviderConfig?: { readonly 'base-url'?: string };
}

export function detectFromProviderConfig(providerInstance: unknown): {
  provider: string | null;
  baseUrl: string | undefined;
} {
  const candidate = providerInstance as ProviderConfigCandidate;

  const providerConfigUrl = resolveBaseUrlOrNull(
    candidate.providerConfig?.['base-url'],
  );
  if (providerConfigUrl) {
    const detected = detectApiKeyProvider(providerConfigUrl);
    if (detected) {
      logger.debug(() => `Detected ${detected} from provider config base-url`);
      return { provider: detected, baseUrl: providerConfigUrl };
    }
  }

  const baseConfigUrl = resolveBaseUrlOrNull(
    candidate.baseProviderConfig?.['base-url'],
  );
  if (baseConfigUrl) {
    const detected = detectApiKeyProvider(baseConfigUrl);
    if (detected) {
      logger.debug(
        () => `Detected ${detected} from base provider config base-url`,
      );
      return { provider: detected, baseUrl: baseConfigUrl };
    }
  }

  return { provider: null, baseUrl: undefined };
}

function isLoadBalancingProvider(provider: unknown): provider is {
  getStats: () => ExtendedLoadBalancerStats;
  getTokenAccountingDiagnostics?: () => TokenAccountingDiagnostics;
} {
  return (
    provider !== null &&
    typeof provider === 'object' &&
    'getStats' in provider &&
    typeof (provider as { getStats?: unknown }).getStats === 'function'
  );
}

function supportsTokenAccountingDiagnostics(provider: {
  getTokenAccountingDiagnostics?: () => TokenAccountingDiagnostics;
}): provider is {
  getTokenAccountingDiagnostics: () => TokenAccountingDiagnostics;
} {
  return typeof provider.getTokenAccountingDiagnostics === 'function';
}

export function createProviderInspection(
  readEndpoint: () => unknown,
  manager: RuntimeProviderManager,
) {
  return {
    getActiveProviderDetails: () => {
      const activeProvider = manager.getActiveProvider();
      if (activeProvider === undefined) return undefined;
      const wrappedProvider = (activeProvider as ProviderBaseURLWrapper)
        .wrappedProvider;
      return {
        name: activeProvider.name,
        baseURL: getProviderBaseURL(wrappedProvider ?? activeProvider),
      };
    },
    getProviderDumpMetadata: () => getProviderDumpMetadata(manager),
    getActiveProviderAliasConfig: () => {
      const baseUrl = readEndpoint();
      return resolveActiveProviderForAlias(
        manager,
        typeof baseUrl === 'string' ? baseUrl : undefined,
      );
    },
    detectProviderQuota: (name: string) => {
      const provider = manager.getProviderByName(name);
      return provider === undefined
        ? undefined
        : detectFromProviderConfig(provider);
    },
    getLoadBalancerStats: () => {
      const provider = manager.getProviderByName('load-balancer');
      return isLoadBalancingProvider(provider)
        ? provider.getStats()
        : undefined;
    },
    getLoadBalancerTokenAccounting: () => {
      const provider = manager.getProviderByName('load-balancer');
      return isLoadBalancingProvider(provider) &&
        supportsTokenAccountingDiagnostics(provider)
        ? provider.getTokenAccountingDiagnostics()
        : undefined;
    },
  };
}
