/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single owner of system-prompt PLACEMENT policy (issue #3136).
 *
 * Assembly answers "what is the prompt"; placement answers "where does it go".
 * Before this module, placement was re-derived independently inside each
 * provider from local conditions such as `isOAuth`, with no shared contract —
 * the same defect class as the duplicated assembly. That is why the
 * duplication surfaced in two different shapes (a doubled `role: system`
 * message on one path, a doubled `role: user` block on another) instead of one
 * recognizable defect.
 *
 * Providers now DECLARE a capability; this module DECIDES and formats.
 */

/**
 * Where a provider can accept the assembled system prompt.
 *
 * - `system-field`: the provider accepts arbitrary system content in a
 *   dedicated field (OpenAI `messages[0].role='system'`, Responses
 *   `instructions`, Gemini `systemInstruction`, Anthropic non-OAuth `system`).
 * - `context-prefix`: the provider's system field is reserved or unusable, so
 *   the prompt goes at the very top of the context — above memory content and
 *   never inside conversation history — with an explicit boundary marker.
 *   Anthropic under OAuth (`claudecode`) is the reference case: its `system`
 *   field must contain ONLY the Claude Code string or the request is rejected.
 */
export type SystemPromptPlacement = 'system-field' | 'context-prefix';

/**
 * Boundary marker that separates the injected system prompt from the real
 * conversation when using `context-prefix` placement. Without it the model
 * cannot tell where our directives stop and the user's turn begins.
 */
export const CONTEXT_PREFIX_BOUNDARY =
  'User provided conversation begins here:';

/**
 * Format the assembled prompt for `context-prefix` placement.
 *
 * The exact shape is load-bearing for Anthropic OAuth and is asserted
 * byte-for-byte by the characterization tripwire, so it must not drift.
 */
export function formatContextPrefix(systemPrompt: string): string {
  return `<system>\n${systemPrompt}\n</system>\n\n${CONTEXT_PREFIX_BOUNDARY}`;
}

/**
 * Decide placement from a provider's declared capability.
 *
 * `declaredPlacement` is what the provider states about the request it is
 * about to make. Anthropic declares `context-prefix` when OAuth is active and
 * `system-field` otherwise; every other provider declares `system-field`.
 * Callers must not re-derive this from transport details.
 */
export function resolveSystemPromptPlacement(
  declaredPlacement: SystemPromptPlacement | undefined,
): SystemPromptPlacement {
  return declaredPlacement ?? 'system-field';
}
