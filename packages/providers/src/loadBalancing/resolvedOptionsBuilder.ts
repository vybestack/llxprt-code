/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251211issue486c
 * Build resolved GenerateChatOptions for load-balancer sub-profiles.
 * Extracted from LoadBalancingProvider to keep the main file under the
 * lint line budget.
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type {
  ResolvedSubProfile,
  LoadBalancerSubProfile,
} from '../LoadBalancingProvider.js';
import { isResolvedSubProfile } from '../LoadBalancingProvider.js';

export interface OptionsBuildContext {
  lbProfileEphemeralSettings: Record<string, unknown> | undefined;
  lbProfileModelParams: Record<string, unknown> | undefined;
  logger: DebugLogger;
  providerName: string;
  getEffectiveContextLimit: () => number | undefined;
}

/**
 * Build resolved options for round-robin strategy (non-failover path).
 */
export function buildRoundRobinResolvedOptions(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  options: GenerateChatOptions,
  ctx: OptionsBuildContext,
): GenerateChatOptions {
  return buildDelegateResolvedOptions(subProfile, options, ctx);
}

function buildDelegateResolvedOptions(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
  options: GenerateChatOptions,
  ctx: OptionsBuildContext,
): GenerateChatOptions {
  if (isResolvedSubProfile(subProfile)) {
    return buildResolvedSubProfileOptions(subProfile, options, ctx);
  }

  // LoadBalancerSubProfile (legacy path)
  // authToken is intentionally isolated: when the sub-profile omits authToken,
  // the parent resolved.authToken must NOT leak through, otherwise credentials
  // from a previously loaded profile contaminate delegates with different auth.
  const { authToken: _parentAuthToken, ...resolvedWithoutAuth } =
    options.resolved ?? {};
  const resolvedOptions: GenerateChatOptions = {
    ...options,
    resolved: {
      ...resolvedWithoutAuth,
      ...(typeof subProfile.modelId === 'string' &&
        subProfile.modelId !== '' && { model: subProfile.modelId }),
      ...(typeof subProfile.baseURL === 'string' &&
        subProfile.baseURL !== '' && { baseURL: subProfile.baseURL }),
      ...(typeof subProfile.authToken === 'string' &&
        subProfile.authToken !== '' && { authToken: subProfile.authToken }),
    },
    metadata: {
      ...options.metadata,
      loadBalancerDelegate: true,
    },
  };

  ctx.logger.debug(
    () =>
      `Resolved settings (LoadBalancerSubProfile) - model: ${resolvedOptions.resolved?.model}, ` +
      `baseURL: ${resolvedOptions.resolved?.baseURL}, ` +
      `authToken: ${typeof resolvedOptions.resolved?.authToken === 'string' && resolvedOptions.resolved.authToken !== '' ? 'present' : 'missing'}`,
  );
  return resolvedOptions;
}

function buildResolvedSubProfileOptions(
  subProfile: ResolvedSubProfile,
  options: GenerateChatOptions,
  ctx: OptionsBuildContext,
): GenerateChatOptions {
  const mergedEphemeralSettings = {
    ...subProfile.ephemeralSettings,
    ...ctx.lbProfileEphemeralSettings,
  };
  const contextLimit = ctx.getEffectiveContextLimit();
  if (contextLimit !== undefined) {
    mergedEphemeralSettings['context-limit'] = contextLimit;
  }

  const mergedModelParams = {
    ...subProfile.modelParams,
    ...ctx.lbProfileModelParams,
  };
  const mergedInvocationEphemerals = {
    ...mergedEphemeralSettings,
    ...mergedModelParams,
  };

  const temperature = readNumericSetting(
    mergedInvocationEphemerals,
    'temperature',
    'temperature',
  );
  const maxTokens = readNumericSetting(
    mergedInvocationEphemerals,
    'maxTokens',
    'max_tokens',
  );
  const streaming = readBooleanSetting(
    mergedEphemeralSettings,
    'streaming',
    'stream',
  );

  // authToken isolation: strip parent resolved.authToken so a sub-profile that
  // omits authToken does not inherit credentials from the upstream invocation.
  const { authToken: _parentAuthToken, ...resolvedWithoutAuth } =
    options.resolved ?? {};

  const resolvedOptions: GenerateChatOptions = {
    ...options,
    resolved: {
      ...resolvedWithoutAuth,
      model: subProfile.model,
      ...(typeof subProfile.baseURL === 'string' &&
        subProfile.baseURL !== '' && { baseURL: subProfile.baseURL }),
      ...(typeof subProfile.authToken === 'string' &&
        subProfile.authToken !== '' && { authToken: subProfile.authToken }),
      ...(temperature !== undefined && { temperature }),
      ...(maxTokens !== undefined && { maxTokens }),
      ...(streaming !== undefined && { streaming }),
    },
    metadata: {
      ...options.metadata,
      loadBalancerDelegate: true,
      ephemeralSettings: mergedEphemeralSettings,
      modelParams: mergedModelParams,
    },
  };

  const invocation = createDelegateInvocation(
    subProfile,
    resolvedOptions,
    mergedInvocationEphemerals,
    ctx,
  );
  if (invocation !== undefined) {
    resolvedOptions.invocation = invocation;
  }

  ctx.logger.debug(
    () =>
      `Resolved settings (ResolvedSubProfile) - model: ${resolvedOptions.resolved?.model}, ` +
      `baseURL: ${resolvedOptions.resolved?.baseURL}, ` +
      `authToken: ${typeof resolvedOptions.resolved?.authToken === 'string' && resolvedOptions.resolved.authToken !== '' ? 'present' : 'missing'}, ` +
      `temperature: ${temperature}, maxTokens: ${maxTokens}, ` +
      `ephemeralSettings keys: ${Object.keys(mergedEphemeralSettings).join(', ')}, ` +
      `modelParams keys: ${Object.keys(mergedModelParams).join(', ')}`,
  );
  return resolvedOptions;
}

function createDelegateInvocation(
  subProfile: ResolvedSubProfile,
  options: GenerateChatOptions,
  ephemeralsSnapshot: Record<string, unknown>,
  ctx: OptionsBuildContext,
): GenerateChatOptions['invocation'] | undefined {
  if (options.runtime === undefined || options.settings === undefined) {
    return undefined;
  }

  return createRuntimeInvocationContext({
    runtime: options.runtime,
    settings: options.settings,
    providerName: subProfile.providerName,
    ephemeralsSnapshot,
    telemetry: options.resolved?.telemetry,
    metadata: options.metadata,
    fallbackRuntimeId: `${ctx.providerName}:${subProfile.name}`,
  });
}

function readNumericSetting(
  settings: Record<string, unknown>,
  canonicalKey: string,
  aliasKey: string,
): number | undefined {
  const value = settings[canonicalKey] ?? settings[aliasKey];
  return typeof value === 'number' ? value : undefined;
}

function readBooleanSetting(
  settings: Record<string, unknown>,
  canonicalKey: string,
  aliasKey: string,
): boolean | undefined {
  const value = settings[canonicalKey] ?? settings[aliasKey];
  return typeof value === 'boolean' ? value : undefined;
}
