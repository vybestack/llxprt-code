/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @plan:PLAN-20260626-RUNTIMEBOUNDARY.P06 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

const internalConfigs = new WeakMap<object, Config>();

export function registerInternalConfig(agent: object, config: Config): void {
  internalConfigs.set(agent, config);
}

export function getInternalConfig(agent: object): Config {
  const config = internalConfigs.get(agent);
  if (config === undefined) {
    throw new Error('Agent internal Config is not registered');
  }
  return config;
}
