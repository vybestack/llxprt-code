/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

const logger = new DebugLogger('llxprt:provider:safe-default-model');

/**
 * Structural type representing a provider-like object whose
 * `getDefaultModel` may or may not be present at runtime.
 *
 * `IProvider` declares `getDefaultModel()` as required, but the runtime
 * contract (`RuntimeProvider`) declares it optional. Test mocks, stubs,
 * and providers constructed through dependency injection may omit it.
 * This type models that reality so the optional chaining below is
 * type-correct and does not trip `no-unnecessary-condition`.
 */
interface ProviderWithOptionalDefaultModel {
  getDefaultModel?: () => string;
}

/**
 * Safely resolve a provider's default model name, returning an empty
 * string when the provider does not implement `getDefaultModel` or when
 * the method throws. This prevents a broken/misconfigured provider from
 * crashing the model-resolution boundary.
 *
 * Wrappers (RetryOrchestrator, LoggingProviderWrapper) delegate to the
 * wrapped provider, which may be a minimal mock or a runtime-injected
 * implementation lacking the method or throwing unexpectedly. Using this
 * helper avoids a `TypeError: getDefaultModel is not a function` or
 * propagated provider error at the model-resolution boundary.
 *
 * When the method throws, the error is logged at debug level so
 * misconfiguration is diagnosable without crashing the caller.
 */
export function safeGetDefaultModel(
  provider: ProviderWithOptionalDefaultModel,
): string {
  try {
    return provider.getDefaultModel?.() ?? '';
  } catch (err) {
    logger.debug(
      () =>
        `getDefaultModel threw, returning empty string: ${err instanceof Error ? err.message : String(err)}`,
    );
    return '';
  }
}
