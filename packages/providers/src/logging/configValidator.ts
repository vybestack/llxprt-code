/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Config validation helpers extracted from LoggingProviderWrapper to keep
 * the main wrapper file under the lint line budget.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

/** Resolve config from options/runtime and validate it has required methods. */
export function resolveAndValidateConfig(
  normalizedOptions: GenerateChatOptions,
  debug: DebugLogger,
): Config {
  const activeConfig =
    normalizedOptions.config ?? normalizedOptions.runtime?.config;
  debug.log(
    () =>
      `After config resolution: hasConfig=${activeConfig != null}, configType=${activeConfig?.constructor.name}, hasMethod=${typeof activeConfig?.getConversationLoggingEnabled}`,
  );

  if (!activeConfig) {
    throw new Error(
      `[REQ-SP4-004] FAST FAIL: No config resolved for runtimeId=${normalizedOptions.runtime?.runtimeId ?? 'unknown'}`,
    );
  }
  normalizedOptions.config = activeConfig;
  validateConfigInstance(activeConfig, normalizedOptions, debug);
  return activeConfig;
}

/** FAST FAIL: Validate config has getConversationLoggingEnabled. */
function validateConfigInstance(
  activeConfig: Config,
  normalizedOptions: GenerateChatOptions,
  debug: DebugLogger,
): void {
  const configHasLoggingMethod =
    typeof activeConfig.getConversationLoggingEnabled === 'function';

  if (!configHasLoggingMethod) {
    const configKeys = Object.keys(activeConfig);
    const prototypeChain: string[] = [];
    let proto = Object.getPrototypeOf(activeConfig);
    while (proto != null && proto !== Object.prototype) {
      prototypeChain.push(proto.constructor?.name ?? 'unknown');
      proto = Object.getPrototypeOf(proto);
    }

    debug.warn(
      () =>
        `Config instance missing getConversationLoggingEnabled() (type=${activeConfig.constructor.name}, frozen=${Object.isFrozen(activeConfig)}, proto=${prototypeChain.length > 0 ? prototypeChain.join(' -> ') : 'Object'}).`,
    );

    throw buildConfigValidationError(
      activeConfig,
      configKeys,
      prototypeChain,
      normalizedOptions,
    );
  }
}

/** Build the detailed FAST FAIL diagnostic error for an invalid config instance. */
function buildConfigValidationError(
  activeConfig: Config,
  configKeys: string[],
  prototypeChain: string[],
  normalizedOptions: GenerateChatOptions,
): Error {
  return new Error(
    `[REQ-SP4-004] FAST FAIL: Invalid config instance - missing getConversationLoggingEnabled() method.\n` +
      `Config appears to be a plain object instead of a Config class instance.\n` +
      `This typically happens when the Config is serialized (e.g., Object.freeze with spread, JSON.stringify/parse) and loses its prototype chain.\n` +
      `Diagnostics:\n` +
      `- Type: ${activeConfig.constructor.name}\n` +
      `- Has method: ${typeof activeConfig.getConversationLoggingEnabled}\n` +
      `- Is frozen: ${Object.isFrozen(activeConfig)}\n` +
      `- Property count: ${configKeys.length}\n` +
      `- Prototype chain: ${prototypeChain.length > 0 ? prototypeChain.join(' -> ') : 'Object (direct)'}\n` +
      `- From runtime: ${normalizedOptions.runtime !== undefined}\n` +
      `- Runtime ID: ${normalizedOptions.runtime?.runtimeId ?? 'unknown'}\n` +
      `Fix: Ensure Config instances are passed by reference, not serialized/deserialized.`,
  );
}
