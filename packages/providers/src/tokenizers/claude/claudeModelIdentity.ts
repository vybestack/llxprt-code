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
 * `claude-opus-5-mini` is claimed by the family so it takes an explicit,
 * warned legacy fallback instead of silently falling through to a generic
 * character heuristic.
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

/**
 * A point release is the family prefix plus one additional numeric version
 * segment, optionally followed by `-latest` or a real compact `-YYYYMMDD`
 * date: `claude-fable-5-1`, `claude-fable-5-1-latest`,
 * `claude-fable-5-1-20260829`.
 *
 * A bare 8-digit run directly after the prefix is the date-snapshot shape
 * rather than a version segment, so a bare `-20260829` (or an impossible date
 * like `-20261345`) is never a point release; with a `-latest` or real date
 * suffix the digits are a version segment again
 * (`claude-fable-5-12345678-latest`). Point releases are not sanctioned
 * identities; they inherit the family calibration with an explicit warning
 * until a dedicated calibration exists.
 */
const POINT_RELEASE_QUALIFIER = /^-(\d+)(?:-latest)?$/;
const POINT_RELEASE_DATE_QUALIFIER = /^-\d+-[0-9]{8}$/;

function matchesAnchoredPointRelease(prefix: string, model: string): boolean {
  const normalized = model.toLowerCase();
  if (!normalized.startsWith(prefix)) return false;
  const qualifier = normalized.slice(prefix.length);
  if (POINT_RELEASE_DATE_QUALIFIER.test(qualifier)) {
    return isCompactDateSnapshot(qualifier.slice(-8));
  }
  const match = POINT_RELEASE_QUALIFIER.exec(qualifier);
  if (match === null) return false;
  return qualifier.endsWith('-latest') || match[1].length !== 8;
}

export function isClaudeOpus5PointReleaseModel(model: string): boolean {
  return matchesAnchoredPointRelease(OPUS_5_PREFIX, model);
}

export function isClaudeFable5PointReleaseModel(model: string): boolean {
  return matchesAnchoredPointRelease(FABLE_5_PREFIX, model);
}
