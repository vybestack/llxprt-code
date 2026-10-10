/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import {
  type IsolatedRuntimeActivationOptions,
  type IsolatedRuntimeContextHandle,
} from './runtimeContextFactory.js';
export { resolveRuntimeKind } from './runtimeKind.js';

export async function activateIsolatedRuntimeContext(
  handle: IsolatedRuntimeContextHandle,
  options: IsolatedRuntimeActivationOptions = {},
): Promise<void> {
  const runtimeId = options.runtimeId ?? handle.runtimeId;
  const mergedMetadata = {
    ...handle.metadata,
    ...(options.metadata ?? {}),
  };
  const overrides: IsolatedRuntimeActivationOptions = {
    ...options,
    runtimeId,
    metadata: mergedMetadata,
  };

  await handle.activate(overrides);
}
