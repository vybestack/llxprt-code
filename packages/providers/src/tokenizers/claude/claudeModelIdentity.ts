/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isCompactDateSnapshot } from '../../modelIdentity/snapshotDate.js';

/**
 * Anchored identity for the two Claude 5 models this estimator family covers.
 *
 * Identity is anchored rather than substring-matched so version boundaries are
 * exact: `claude-opus-50` is a different model and `claude-opus-5-mini` is a
 * speculative ID, and neither may inherit Opus 5 calibration. The two models
 * are matched separately because Claude 5 family membership does not imply a
 * shared tokenization or framing rate.
 */

const OPUS_5_PREFIX = 'claude-opus-5';
const FABLE_5_PREFIX = 'claude-fable-5';

/**
 * Claim patterns are deliberately broader than identity: a lookalike such as
 * `claude-opus-5-mini` is claimed by the family so it fails with an actionable
 * identity error instead of silently falling through to a generic character
 * heuristic.
 */
export const CLAUDE_OPUS_5_CLAIM = /^claude-opus-5(?:$|-)/i;
export const CLAUDE_FABLE_5_CLAIM = /^claude-fable-5(?:$|-)/i;

/**
 * A sanctioned ID is the bare alias, the `-latest` pointer, or a `-YYYYMMDD`
 * snapshot whose digits are a real calendar date.
 */
function matchesAnchoredIdentity(prefix: string, model: string): boolean {
  const normalized = model.toLowerCase();
  if (!normalized.startsWith(prefix)) return false;
  const qualifier = normalized.slice(prefix.length);
  if (qualifier === '' || qualifier === '-latest') return true;
  return qualifier.startsWith('-') && isCompactDateSnapshot(qualifier.slice(1));
}

export function isSanctionedClaudeOpus5Model(model: string): boolean {
  return matchesAnchoredIdentity(OPUS_5_PREFIX, model);
}

export function isSanctionedClaudeFable5Model(model: string): boolean {
  return matchesAnchoredIdentity(FABLE_5_PREFIX, model);
}
