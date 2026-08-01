/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `@issue-NNN` and `@pr-NNN` completion, backed by the GitHub broker.
 *
 * Unlike file or subagent completion, the candidate set cannot be
 * pre-computed: it lives on GitHub. Every keystroke could therefore cost an
 * API call, so this source only queries once the user has committed to the
 * prefix, and caps what it asks for.
 *
 * @plan PLAN-20260731-GHBROKER.P16
 * @requirement REQ-014
 */

import type { GitHubBrokerClient } from '@vybestack/llxprt-code-tools';
import type { Suggestion } from '../components/SuggestionsDisplay.js';

/** Prefixes that trigger a GitHub lookup. */
const ISSUE_PREFIX = 'issue-';
const PR_PREFIX = 'pr-';

/** Upper bound on suggestions offered, and therefore on what we request. */
export const GITHUB_SUGGESTION_LIMIT = 10;

/**
 * A parsed `@issue-`/`@pr-` pattern.
 *
 * `query` is whatever followed the prefix: a number, a word, or empty.
 */
export interface GitHubAtPattern {
  readonly kind: 'issue' | 'pr';
  readonly query: string;
}

/**
 * Recognises an `@issue-`/`@pr-` pattern, or returns null when the text is
 * something else entirely and no GitHub call should be made.
 *
 * Matching is deliberately strict: a bare `@i` must not trigger a network
 * request, because at that point the user is far more likely to be typing a
 * filename.
 *
 * @plan PLAN-20260731-GHBROKER.P16
 * @requirement REQ-014
 */
export function parseGitHubAtPattern(pattern: string): GitHubAtPattern | null {
  const lower = pattern.toLowerCase();
  if (lower.startsWith(ISSUE_PREFIX)) {
    return { kind: 'issue', query: pattern.slice(ISSUE_PREFIX.length) };
  }
  if (lower.startsWith(PR_PREFIX)) {
    return { kind: 'pr', query: pattern.slice(PR_PREFIX.length) };
  }
  return null;
}

interface ListedItem {
  number?: number;
  title?: string;
  state?: string;
}

/** Formats one issue or PR as a suggestion. */
function toSuggestion(kind: 'issue' | 'pr', item: ListedItem): Suggestion {
  const value = `${kind}-${item.number ?? ''}`;
  const state = typeof item.state === 'string' ? item.state.toLowerCase() : '';
  return {
    label: `${value}  ${item.title ?? ''}`.trimEnd(),
    value,
    description: state ? `${kind} · ${state}` : kind,
  };
}

/**
 * Fetches matching issues or pull requests.
 *
 * A purely numeric query is passed through as a search term rather than as
 * a direct lookup, so a partial number such as "16" still offers #1663 and
 * #167 instead of failing to resolve.
 *
 * Errors are swallowed into an empty list: completion is an affordance, and
 * a GitHub outage or an unauthenticated host should not surface as an error
 * while the user is mid-keystroke.
 *
 * @plan PLAN-20260731-GHBROKER.P16
 * @requirement REQ-014
 */
export async function fetchGitHubSuggestions(
  client: GitHubBrokerClient | undefined,
  parsed: GitHubAtPattern,
  signal: AbortSignal,
): Promise<Suggestion[]> {
  if (client === undefined) return [];

  const op = parsed.kind === 'issue' ? 'issue.list' : 'pr.list';
  const params: Record<string, unknown> = {
    limit: GITHUB_SUGGESTION_LIMIT,
    state: 'open',
  };
  if (parsed.query.length > 0) params.search = parsed.query;

  try {
    const data = await client.runOperation(op, params, signal);
    const items = (parsed.kind === 'issue' ? data.issues : data.prs) as
      | ListedItem[]
      | undefined;
    if (!Array.isArray(items)) return [];
    return items
      .slice(0, GITHUB_SUGGESTION_LIMIT)
      .map((item) => toSuggestion(parsed.kind, item));
  } catch {
    return [];
  }
}
