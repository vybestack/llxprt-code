/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { SystemPromptAssembler } from './chatSession.js';

export async function resolveSystemPromptForTurn(
  assembler: SystemPromptAssembler | undefined,
  provider: string,
  model: string,
  history: HistoryService,
  publish: (instruction: string) => void,
): Promise<void> {
  if (assembler === undefined) return;
  resolveModelForSystemPrompt(model);
  const instruction = await assembler.assemble({ provider, model });
  publish(instruction);
  const tokens = await history.estimateTokensForText(instruction, model);
  history.setBaseTokenOffset(tokens);
}

/**
 * Validates the admitted model identity used by system-prompt assembly.
 * The caller supplies the captured request route, not a mutable Config
 * declaration or a provider's compiled-in default (issue #3138).
 *
 * The value must match the admitted model sent as ``body.model``. If no
 * model is available the call fails fast rather than silently substituting
 * a vendor default. Routing sessions without an individual admitted route
 * supply their already-resolved runtime model.
 *
 * Lives in its own module rather than in ChatSessionFactory so that
 * ChatSession — which the factory constructs — can call it when re-resolving
 * the prompt each turn (issue #3136) without creating an import cycle. Both
 * the session-start and per-turn paths therefore share ONE resolver; adding a
 * second mechanism would recreate the two-sources-disagree defect these two
 * issues exist to remove.
 */
export function resolveModelForSystemPrompt(model: string): string {
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error(
      'Cannot assemble system prompt: no model identity is resolved from the active configuration. ' +
        'A model must be set before the system prompt can be built.',
    );
  }
  return model;
}
