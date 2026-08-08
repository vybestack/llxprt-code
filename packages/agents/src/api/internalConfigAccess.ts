/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @plan:PLAN-20260626-RUNTIMEBOUNDARY.P06 */

/**
 * Type-erased registry for the internal Config stored alongside each Agent.
 *
 * The concrete values are always core Config instances, but this module must
 * not import the Config type (REQ-001). The value type is {@link SessionIdentity}
 * — the narrowest role interface that fromConfig and the test harness use to
 * identify a Config. Callers needing the full surface cast via their own Config
 * import.
 */
import type { SessionIdentity } from '@vybestack/llxprt-code-core/config/roles.js';

const internalConfigs = new WeakMap<object, SessionIdentity>();

export function registerInternalConfig(
  agent: object,
  config: SessionIdentity,
): void {
  internalConfigs.set(agent, config);
}

export function getInternalConfig(agent: object): SessionIdentity {
  const config = internalConfigs.get(agent);
  if (config === undefined) {
    throw new Error('Agent internal Config is not registered');
  }
  return config;
}
