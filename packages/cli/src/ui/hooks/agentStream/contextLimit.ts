/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  resolveEffectiveContextLimit,
  resolveProviderReportedLimit,
  resolveUserContextLimit,
} from '@vybestack/llxprt-code-core';

/**
 * Resolve the effective context-window token limit for the overflow-guidance
 * path. Delegates to the shared `resolveEffectiveContextLimit` in core so
 * there is a single source of truth for the user-override → provider-limit →
 * model-name precedence (issues #2251 / #2815).
 */
export function getTokenLimitForConfiguredContext(
  getModel: () => string,
  readContextLimit: () => unknown,
  providerLimit: number | undefined,
): number {
  return resolveEffectiveContextLimit(
    getModel(),
    resolveUserContextLimit(readContextLimit()),
    resolveProviderReportedLimit(providerLimit),
  );
}
