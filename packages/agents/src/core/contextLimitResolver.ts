/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isPositiveFiniteLimit,
  resolveEffectiveContextLimit,
  resolveProviderReportedLimit,
  tokenLimit,
} from '@vybestack/llxprt-code-core/core/tokenLimits.js';

export interface ContextLimitConfig {
  getEphemeralSetting(key: string): unknown;
  getContentGeneratorConfig():
    | {
        providerManager?: {
          getActiveProvider?: () =>
            | {
                getContextLimit?: () => number | undefined;
              }
            | undefined;
        };
      }
    | undefined;
}

function getConfiguredContextLimit(
  config: ContextLimitConfig,
): number | undefined {
  const rawContextLimit = config.getEphemeralSetting('context-limit');
  return isPositiveFiniteLimit(rawContextLimit) ? rawContextLimit : undefined;
}

/**
 * Resolves the active provider's effective context window when it exposes
 * getContextLimit() (e.g. a load-balancer pool's min-across-sub-profiles
 * limit). Delegates positive-finite validation to the shared
 * `resolveProviderReportedLimit` (issue #2270 DRY) so the acceptance predicate
 * lives in exactly one place. Returns undefined for providers that do not
 * implement the method or when no provider is active, so callers fall back to
 * the model-name lookup.
 */
function getProviderContextLimit(
  config: ContextLimitConfig,
): number | undefined {
  try {
    const providerManager = config.getContentGeneratorConfig()?.providerManager;
    const activeProvider = providerManager?.getActiveProvider?.();
    return resolveProviderReportedLimit(activeProvider?.getContextLimit?.());
  } catch {
    return undefined;
  }
}

/**
 * Resolve the configured context limit honoring precedence:
 * 1. explicit live user `context-limit` override,
 * 2. the active provider's getContextLimit() (e.g. load-balancer pool min),
 * 3. the model-name lookup via tokenLimit(model).
 *
 * Delegates to the shared `resolveEffectiveContextLimit` in core so the
 * precedence lives in exactly one place (issues #2270 / #2527 DRY).
 */
export function getTokenLimitForConfiguredContext(
  model: string,
  config: ContextLimitConfig,
  resolveTokenLimit: typeof tokenLimit = tokenLimit,
): number {
  return resolveEffectiveContextLimit(
    model,
    getConfiguredContextLimit(config),
    getProviderContextLimit(config),
    resolveTokenLimit,
  );
}
