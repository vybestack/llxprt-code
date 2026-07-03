/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core';
import { getTokenLimitForConfiguredContext as resolveTokenLimitForModel } from '@vybestack/llxprt-code-agents';

/**
 * Resolve the effective context-window token limit for the overflow-guidance
 * path. Delegates to the shared resolver in @vybestack/llxprt-code-agents so
 * there is a single source of truth for the user-override → provider-limit →
 * model-name precedence (issue #2251).
 */
export function getTokenLimitForConfiguredContext(config: Config): number {
  return resolveTokenLimitForModel(config.getModel(), config);
}
