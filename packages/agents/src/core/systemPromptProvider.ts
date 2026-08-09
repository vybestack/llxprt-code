/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

/**
 * Resolves the active provider for legacy config-owned request paths such as
 * auxiliary calls and the retained executor. Request runtimes and routers must
 * instead pass their concrete provider explicitly; config state is not an
 * authority at subagent or load-balancer boundaries (issue #3176, D5).
 *
 * An unset provider remains representable by the prompt layer's neutral
 * fallback, so this compatibility resolver returns `undefined` rather than
 * inventing an identity.
 */
export function resolveProviderForSystemPrompt(
  config: Config,
): string | undefined {
  const provider = config.getSettingsService().get('activeProvider');
  if (typeof provider === 'string' && provider.trim() !== '') {
    return provider;
  }
  return undefined;
}
