/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';

function getConfiguredContextLimit(config: Config): number | undefined {
  const rawContextLimit = config.getEphemeralSetting('context-limit');
  return typeof rawContextLimit === 'number' &&
    Number.isFinite(rawContextLimit) &&
    rawContextLimit > 0
    ? rawContextLimit
    : undefined;
}

/**
 * Resolves the active provider's effective context window when it exposes
 * getContextLimit() (e.g. a load-balancer pool's min-across-sub-profiles
 * limit). Returns undefined for providers that do not implement the method or
 * when no provider is active, so callers fall back to the model-name lookup.
 */
function getProviderContextLimit(config: Config): number | undefined {
  try {
    const providerManager = config.getContentGeneratorConfig()?.providerManager;
    const limit = providerManager?.getActiveProvider()?.getContextLimit?.();
    return typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? limit
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the configured context limit honoring precedence:
 * 1. explicit live user `context-limit` override,
 * 2. the active provider's getContextLimit() (e.g. load-balancer pool min),
 * 3. the model-name lookup via tokenLimit(model).
 */
export function getTokenLimitForConfiguredContext(
  model: string,
  config: Config,
): number {
  const contextLimit =
    getConfiguredContextLimit(config) ?? getProviderContextLimit(config);
  return contextLimit === undefined
    ? tokenLimit(model)
    : tokenLimit(model, contextLimit);
}
