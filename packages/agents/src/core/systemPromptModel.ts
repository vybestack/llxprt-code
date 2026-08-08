/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

/**
 * Resolves the model identity for system-prompt assembly from the live
 * configuration, never from a stale runtime-state snapshot or a provider's
 * compiled-in default (issue #3138).
 *
 * The value returned here MUST match the model the provider sends as
 * ``body.model``.  ``resolveModelField`` (runtimeNormalizer.ts) resolves the
 * request model from the same live settings chain, so reading
 * ``config.getModel()`` keeps both sides in sync.  If no model can be resolved
 * the call fails fast rather than silently substituting a vendor default.
 *
 * Lives in its own module rather than in ChatSessionFactory so that
 * ChatSession — which the factory constructs — can call it when re-resolving
 * the prompt each turn (issue #3136) without creating an import cycle. Both
 * the session-start and per-turn paths therefore share ONE resolver; adding a
 * second mechanism would recreate the two-sources-disagree defect these two
 * issues exist to remove.
 */
export function resolveModelForSystemPrompt(config: Config): string {
  const model = config.getModel();
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error(
      'Cannot assemble system prompt: no model identity is resolved from the active configuration. ' +
        'A model must be set before the system prompt can be built.',
    );
  }
  return model;
}
