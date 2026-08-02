/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural tests for @issue-/@pr- completion.
 *
 * The properties that matter: a GitHub call happens only once the user has
 * committed to the prefix, results are capped, and a failure degrades to no
 * suggestions rather than an error while typing.
 *
 * @plan PLAN-20260731-GHBROKER.P16
 * @requirement REQ-014
 */

import { describe, it, expect } from 'vitest';
import type { GitHubBrokerClient } from '@vybestack/llxprt-code-tools';
import {
  GITHUB_SUGGESTION_LIMIT,
  fetchGitHubSuggestions,
  parseGitHubAtPattern,
} from './githubAtCompletion.js';

function stubClient(
  data: Record<string, unknown>,
): GitHubBrokerClient & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    async runOperation(op, params) {
      calls.push([op, params]);
      return data;
    },
  };
}

describe('@issue/@pr pattern recognition', () => {
  /**
   * @plan PLAN-20260731-GHBROKER.P16
   * @requirement REQ-014
   */
  it('recognises issue and pr prefixes', () => {
    expect(parseGitHubAtPattern('issue-1663')).toStrictEqual({
      kind: 'issue',
      query: '1663',
    });
    expect(parseGitHubAtPattern('pr-2317')).toStrictEqual({
      kind: 'pr',
      query: '2317',
    });
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P16
   * @requirement REQ-014
   */
  it('recognises a bare prefix with no query yet', () => {
    expect(parseGitHubAtPattern('issue-')).toStrictEqual({
      kind: 'issue',
      query: '',
    });
  });

  /**
   * A bare "@i" must not reach the network: at that point the user is far
   * more likely to be typing a filename.
   *
   * @plan PLAN-20260731-GHBROKER.P16
   * @requirement REQ-014
   */
  it('does not match partial or unrelated text', () => {
    for (const text of ['i', 'iss', 'issue', 'p', 'src/index.ts', '']) {
      expect(parseGitHubAtPattern(text), `${text} must not match`).toBeNull();
    }
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P16
   * @requirement REQ-014
   */
  it('is case-insensitive on the prefix', () => {
    expect(parseGitHubAtPattern('Issue-42')?.kind).toBe('issue');
    expect(parseGitHubAtPattern('PR-42')?.kind).toBe('pr');
  });
});

describe('fetching suggestions', () => {
  const twoIssues = {
    issues: [
      { number: 1663, title: 'system for gh for sandboxes', state: 'OPEN' },
      { number: 135, title: 'Git/GitHub Integration', state: 'OPEN' },
    ],
  };

  /**
   * @plan PLAN-20260731-GHBROKER.P16
   * @requirement REQ-014
   */
  it('queries issue.list for an issue pattern', async () => {
    const client = stubClient(twoIssues);
    const out = await fetchGitHubSuggestions(
      client,
      { kind: 'issue', query: '16' },
      new AbortController().signal,
    );
    expect(client.calls[0][0]).toBe('issue.list');
    expect(client.calls[0][1].search).toBe('16');
    expect(client.calls[0][1].limit).toBe(GITHUB_SUGGESTION_LIMIT);
    expect(out).toHaveLength(2);
    expect(out[0].value).toBe('issue-1663');
    expect(out[0].label).toContain('system for gh');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P16
   * @requirement REQ-014
   */
  it('queries pr.list for a pr pattern', async () => {
    const client = stubClient({
      prs: [{ number: 7, title: 'Fix', state: 'OPEN' }],
    });
    const out = await fetchGitHubSuggestions(
      client,
      { kind: 'pr', query: '' },
      new AbortController().signal,
    );
    expect(client.calls[0][0]).toBe('pr.list');
    expect(client.calls[0][1]).not.toHaveProperty('search');
    expect(out[0].value).toBe('pr-7');
  });

  /**
   * The cap bounds both the API request and the rendered list.
   *
   * @plan PLAN-20260731-GHBROKER.P16
   * @requirement REQ-014
   */
  it('caps the number of suggestions', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      number: i,
      title: `t${i}`,
      state: 'OPEN',
    }));
    const out = await fetchGitHubSuggestions(
      stubClient({ issues: many }),
      { kind: 'issue', query: '' },
      new AbortController().signal,
    );
    expect(out).toHaveLength(GITHUB_SUGGESTION_LIMIT);
  });

  /**
   * A GitHub outage or an unauthenticated host must not surface as an error
   * mid-keystroke; completion is an affordance, not a command.
   *
   * @plan PLAN-20260731-GHBROKER.P16
   * @requirement REQ-014
   */
  it('degrades to no suggestions when the broker fails', async () => {
    const failing: GitHubBrokerClient = {
      async runOperation() {
        throw new Error('HOST_AUTH_REQUIRED');
      },
    };
    const out = await fetchGitHubSuggestions(
      failing,
      { kind: 'issue', query: '1' },
      new AbortController().signal,
    );
    expect(out).toStrictEqual([]);
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P16
   * @requirement REQ-014
   */
  it('offers nothing when no broker is wired', async () => {
    const out = await fetchGitHubSuggestions(
      undefined,
      { kind: 'issue', query: '1' },
      new AbortController().signal,
    );
    expect(out).toStrictEqual([]);
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P16
   * @requirement REQ-014
   */
  it('tolerates a malformed response', async () => {
    const out = await fetchGitHubSuggestions(
      stubClient({ issues: 'not-an-array' }),
      { kind: 'issue', query: '1' },
      new AbortController().signal,
    );
    expect(out).toStrictEqual([]);
  });
});

describe('pattern arrives with the leading at-sign stripped', () => {
  /**
   * The user types @issue-123 but at-completion strips the sigil before
   * calling us. Pinning both halves stops the documentation and the
   * implementation drifting apart again.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-014
   */
  it('matches the stripped form and not the literal user spelling', () => {
    expect(parseGitHubAtPattern('issue-123')).toStrictEqual({
      kind: 'issue',
      query: '123',
    });
    expect(parseGitHubAtPattern('pr-45')).toStrictEqual({
      kind: 'pr',
      query: '45',
    });
    expect(parseGitHubAtPattern('@issue-123')).toBeNull();
  });
});
