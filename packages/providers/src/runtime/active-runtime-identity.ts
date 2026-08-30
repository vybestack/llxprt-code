/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeKind } from './runtimeRegistry.js';

export type { RuntimeKind };

/**
 * Lightweight runtime identity seam for modules that cannot load the runtime
 * composition graph during initialization.
 *
 * @plan PLAN-20260827-ISSUE2562.P04
 * @requirement REQ-2562-3
 */
export interface ActiveRuntimeIdentity {
  readonly runtimeId: string;
  readonly runtimeKind: RuntimeKind;
}

type ActiveRuntimeIdentityResolver = () => ActiveRuntimeIdentity | undefined;

let activeRuntimeIdentityResolver: ActiveRuntimeIdentityResolver | undefined;

export function registerActiveRuntimeIdentityResolver(
  resolver: ActiveRuntimeIdentityResolver,
): void {
  activeRuntimeIdentityResolver = resolver;
}

export function getActiveRuntimeIdentity(): ActiveRuntimeIdentity | undefined {
  try {
    return activeRuntimeIdentityResolver?.();
  } catch {
    return undefined;
  }
}

export function getActiveRuntimeKind(): RuntimeKind | undefined {
  return getActiveRuntimeIdentity()?.runtimeKind;
}
