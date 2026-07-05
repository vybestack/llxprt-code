/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getTokenLimitForConfiguredContext as resolveTokenLimitForModel } from '@vybestack/llxprt-code-agents';
import type { StreamRuntime } from '../../cliUiRuntime.js';

/**
 * Resolve the effective context-window token limit for the overflow-guidance
 * path. Delegates to the shared resolver in @vybestack/llxprt-code-agents so
 * there is a single source of truth for the user-override → provider-limit →
 * model-name precedence (issue #2251).
 */
export function getTokenLimitForConfiguredContext(
  runtime: StreamRuntime,
): number {
  return resolveTokenLimitForModel(runtime.model.getModel(), {
    getEphemeralSetting: (key: string) =>
      runtime.ephemeral.getEphemeralSetting(key),
    getContentGeneratorConfig: () => runtime.model.getContentGeneratorConfig(),
  });
}
