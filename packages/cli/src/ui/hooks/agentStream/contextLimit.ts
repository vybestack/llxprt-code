/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  resolveEffectiveContextLimit,
  resolveProviderReportedLimit,
  resolveUserContextLimit,
} from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import type { StreamRuntime } from '../../cliUiRuntime.js';

/**
 * Resolve the effective context-window token limit for the overflow-guidance
 * path. Delegates to the shared `resolveEffectiveContextLimit` in core so
 * there is a single source of truth for the user-override → provider-limit →
 * model-name precedence (issues #2251 / #2815).
 */
export function getTokenLimitForConfiguredContext(
  runtime: StreamRuntime,
): number {
  return resolveEffectiveContextLimit(
    runtime.model.getModel(),
    resolveUserContextLimit(
      runtime.ephemeral.getEphemeralSetting('context-limit'),
    ),
    resolveProviderReportedLimit(
      runtime.model
        .getContentGeneratorConfig()
        ?.providerManager?.getActiveProvider?.()
        ?.getContextLimit?.(),
    ),
  );
}
