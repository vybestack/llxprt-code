/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  createGhPort,
  fetchRefsViaGh,
  parseChunkResponse,
  safeMultibyteString,
  GH_RUNNER_OPTIONS,
  GH_RUNNER_MAX_BUFFER,
  MAX_LABELS_PER_NODE,
} from '../../release-notes/gh-port.js';
import type { EnrichedRef } from '../../release-notes/types.js';

function node(
  index: number,
  number: number,
  overrides: Record<string, unknown> = {},
): string {
  const base = {
    __typename: 'PullRequest',
    number,
    title: `PR ${number}`,
    body: `Body for ${number}`,
    labels: { nodes: [{ name: 'bug' }] },
    author: { login: `user${number}` },
    ...overrides,
  };
  return JSON.stringify({ data: { repository: { [`r${index}`]: base } } });
}

function repoEnvelope(entries: Record<string, unknown>): string {
  return JSON.stringify({ data: { repository: entries } });
}

/**
 * Returns the value for a key from a Map, throwing a descriptive error if
 * the key is missing. This replaces non-null assertions (!) with a safe
 * guard that produces actionable failure messages.
 */
function requireRef(
  map: ReadonlyMap<number, EnrichedRef>,
  key: number,
): EnrichedRef {
  const ref = map.get(key);
  if (ref === undefined) {
    throw new Error(`Expected ref ${key} to be present in the result map`);
  }
  return ref;
}

describe('parseChunkResponse', () => {
  it('parses valid nodes and keys by requested number', () => {
    const raw = repoEnvelope({
      r0: {
        __typename: 'PullRequest',
        number: 10,
        title: 'Title 10',
        body: 'Body 10',
        labels: { nodes: [{ name: 'bug' }, { name: 'feature' }] },
        author: { login: 'alice' },
      },
    });
    const result = parseChunkResponse(raw, [10]);
    expect(result.size).toBe(1);
    const ref = result.get(10)!;
    expect(ref.number).toBe(10);
    expect(ref.title).toBe('Title 10');
    expect(ref.labels).toEqual(['bug', 'feature']);
    expect(ref.author).toBe('alice');
    expect(ref.isPr).toBe(true);
  });

  it('returns empty map for malformed JSON', () => {
    const result = parseChunkResponse('{not valid json', [10]);
    expect(result.size).toBe(0);
  });

  it('returns empty map when envelope shape is malformed', () => {
    const result = parseChunkResponse(
      JSON.stringify({ wrong: { shape: true } }),
      [10],
    );
    expect(result.size).toBe(0);
  });

  it('degrades individually malformed nodes but keeps valid siblings', () => {
    const raw = repoEnvelope({
      r0: { __typename: 'PullRequest', number: 10, title: 'Good', author: {} },
      r1: 'not-an-object',
      r2: { __typename: 'Issue', number: 12, title: 'Also good' },
    });
    const result = parseChunkResponse(raw, [10, 11, 12]);
    expect(result.size).toBe(2);
    expect(requireRef(result, 10).title).toBe('Good');
    expect(requireRef(result, 12).title).toBe('Also good');
    expect(result.has(11)).toBe(false);
  });

  it('degrades null nodes individually', () => {
    const raw = repoEnvelope({
      r0: null,
      r1: { __typename: 'PullRequest', number: 20, title: 'Present' },
    });
    const result = parseChunkResponse(raw, [19, 20]);
    expect(result.size).toBe(1);
    expect(requireRef(result, 20).title).toBe('Present');
  });

  it('rejects nodes where the alias number does not match the requested batch number', () => {
    // The alias r0 is for requested number 10, but the returned node says 999.
    const raw = repoEnvelope({
      r0: { __typename: 'PullRequest', number: 999, title: 'Mismatched' },
    });
    const result = parseChunkResponse(raw, [10]);
    expect(result.size).toBe(0);
  });

  it('rejects nodes with missing title', () => {
    const raw = repoEnvelope({
      r0: { __typename: 'PullRequest', number: 10, author: {} },
    });
    const result = parseChunkResponse(raw, [10]);
    expect(result.size).toBe(0);
  });

  it('degrades malformed labels nodes but keeps the rest of the ref', () => {
    const raw = repoEnvelope({
      r0: {
        __typename: 'PullRequest',
        number: 10,
        title: 'Title',
        labels: { nodes: [{ name: 'bug' }, 'bad', { other: 1 }] },
        author: { login: 'alice' },
      },
    });
    const result = parseChunkResponse(raw, [10]);
    expect(result.size).toBe(1);
    // Valid label name is kept; malformed label nodes are ignored.
    expect(requireRef(result, 10).labels).toEqual(['bug']);
  });

  it('handles missing author (null) gracefully', () => {
    const raw = repoEnvelope({
      r0: {
        __typename: 'PullRequest',
        number: 10,
        title: 'Title',
        author: null,
      },
    });
    const result = parseChunkResponse(raw, [10]);
    expect(result.size).toBe(1);
    expect(requireRef(result, 10).author).toBe('');
  });

  it('sets metadataAvailable true on a successfully enriched PullRequest', () => {
    const raw = repoEnvelope({
      r0: {
        __typename: 'PullRequest',
        number: 10,
        title: 'Title',
        author: { login: 'alice' },
      },
    });
    const result = parseChunkResponse(raw, [10]);
    expect(result.size).toBe(1);
    expect(requireRef(result, 10).metadataAvailable).toBe(true);
  });

  it('sets metadataAvailable true on a successfully enriched Issue', () => {
    const raw = repoEnvelope({
      r0: {
        __typename: 'Issue',
        number: 20,
        title: 'Issue Title',
        author: { login: 'bob' },
      },
    });
    const result = parseChunkResponse(raw, [20]);
    expect(result.size).toBe(1);
    expect(requireRef(result, 20).metadataAvailable).toBe(true);
  });
});

function echoRequestedRefs(args: readonly string[]): string {
  const requested = args
    .map((arg) => /^n\d+=(\d+)$/.exec(arg))
    .filter((match) => match !== null)
    .map((match) => Number(match[1]));
  return repoEnvelope(
    Object.fromEntries(
      requested.map((number, index) => [
        `r${index}`,
        {
          __typename: 'PullRequest',
          number,
          title: `PR ${number}`,
          author: { login: 'u' },
        },
      ]),
    ),
  );
}
describe('fetchRefsViaGh (injectable runner)', () => {
  it('processes 25 numbers in a single bounded chunk', () => {
    const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
    let callCount = 0;
    const runner = (args: readonly string[]) => {
      callCount++;
      return echoRequestedRefs(args);
    };
    const result = fetchRefsViaGh('owner/repo', numbers, runner);
    expect(callCount).toBe(1);
    expect(result.size).toBe(25);
  });

  it('processes 50 numbers across two bounded chunks (25 + 25)', () => {
    const numbers = Array.from({ length: 50 }, (_, i) => i + 1);
    let callCount = 0;
    const runner = (args: readonly string[]) => {
      callCount++;
      return echoRequestedRefs(args);
    };
    const result = fetchRefsViaGh('owner/repo', numbers, runner);
    expect(callCount).toBe(2);
    expect(result.size).toBe(50);
  });

  it('processes 51 numbers across three bounded chunks (25 + 25 + 1)', () => {
    const numbers = Array.from({ length: 51 }, (_, i) => i + 1);
    let callCount = 0;
    const runner = (args: readonly string[]) => {
      callCount++;
      const requested = args
        .map((arg) => /^n\d+=(\d+)$/.exec(arg))
        .filter((match) => match !== null)
        .map((match) => Number(match[1]));
      return repoEnvelope(
        Object.fromEntries(
          requested.map((number, index) => [
            `r${index}`,
            {
              __typename: 'PullRequest',
              number,
              title: `PR ${number}`,
              author: { login: 'u' },
            },
          ]),
        ),
      );
    };
    const result = fetchRefsViaGh('owner/repo', numbers, runner);
    expect(callCount).toBe(3);
    expect(result.size).toBe(51);
  });

  it('sorts and de-duplicates input numbers', () => {
    const captured: number[] = [];
    const capturingRunner = (args: readonly string[]) => {
      // Extract nN=value pairs from the -F flags: args come as ["-F","n0=1",...]
      for (const arg of args) {
        const match = /^n\d+=(\d+)$/.exec(arg);
        if (match !== null) {
          captured.push(Number(match[1]));
        }
      }
      return repoEnvelope({});
    };
    // Duplicates and unsorted.
    fetchRefsViaGh('owner/repo', [3, 1, 2, 1, 3], capturingRunner);
    expect(captured).toEqual([1, 2, 3]);
  });

  it('bounds enrichment to forty GraphQL requests', () => {
    let calls = 0;
    const runner: GhRunner = (args) => {
      calls++;
      const numbers = args.flatMap((arg) => {
        const match = /^n\d+=(\d+)$/.exec(arg);
        return match === null ? [] : [Number(match[1])];
      });
      return repoEnvelope(
        Object.fromEntries(
          numbers.map((number, index) => [
            `r${index}`,
            {
              __typename: 'PullRequest',
              number,
              title: `PR ${number}`,
              author: { login: 'u' },
            },
          ]),
        ),
      );
    };

    const result = fetchRefsViaGh(
      'owner/repo',
      Array.from({ length: 1400 }, (_, index) => index + 1),
      runner,
    );

    expect(calls).toBe(40);
    expect(result.size).toBe(1000);
  });

  it('continues after a failed first chunk and processes the second', () => {
    const numbers = Array.from({ length: 51 }, (_, i) => i + 1);
    let callCount = 0;
    const runner = () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('network error');
      }
      // Third chunk: just number 51 (25 + 25 = 50 already in first two chunks).
      if (callCount === 2) {
        // Second chunk: numbers 26-50, return them.
        const repo: Record<string, unknown> = {};
        for (let i = 0; i < 25; i++) {
          repo[`r${i}`] = {
            __typename: 'PullRequest',
            number: 26 + i,
            title: `PR ${26 + i}`,
            author: { login: 'u' },
          };
        }
        return repoEnvelope(repo);
      }
      // Third chunk: number 51.
      return repoEnvelope({
        r0: {
          __typename: 'PullRequest',
          number: 51,
          title: 'PR 51',
          author: { login: 'u' },
        },
      });
    };
    const result = fetchRefsViaGh('owner/repo', numbers, runner);
    // First chunk failed (numbers 1-25 dropped), second and third succeeded.
    expect(result.size).toBe(26);
    expect(requireRef(result, 51).title).toBe('PR 51');
  });

  it('returns empty map when all chunks fail', () => {
    const runner = () => {
      throw new Error('total failure');
    };
    const result = fetchRefsViaGh('owner/repo', [1, 2, 3], runner);
    expect(result.size).toBe(0);
  });

  it('handles malformed envelope in one chunk but valid in next', () => {
    // 51 numbers forces three chunks (25 + 25 + 1).
    const numbers = Array.from({ length: 51 }, (_, i) => i + 1);
    let callCount = 0;
    const runner = () => {
      callCount++;
      if (callCount === 1) {
        return '{malformed';
      }
      // Subsequent chunks: return matching nodes for whatever was requested.
      return node(0, numbers[callCount === 2 ? 25 : 50]!, {});
    };
    const result = fetchRefsViaGh('owner/repo', numbers, runner);
    // First chunk (1-25) malformed, second (26-50) returns node(0, 26)
    // which has number mismatch (26 != 51), third (51) returns node(0,51).
    // Second chunk has alias r0 number 26 but response says number 26,
    // requested batch[0] is 26, so it matches.
    expect(requireRef(result, 51).title).toBe('PR 51');
  });
});

describe('createGhPort', () => {
  it('returns a GhPort whose fetchRefs delegates to the injectable runner', async () => {
    const runner = () => node(0, 42, {});
    const port = createGhPort('owner/repo', runner);
    const refs = await port.fetchRefs([42]);
    expect(refs.size).toBe(1);
    const ref: EnrichedRef = refs.get(42)!;
    expect(ref.number).toBe(42);
    expect(ref.title).toBe('PR 42');
  });
});

describe('defaultRunner maxBuffer', () => {
  it('sets a bounded maxBuffer large enough for a full 25-node chunk', () => {
    // The default runner must set a maxBuffer large enough for the maximum
    // chunk size (25 PRs with substantial bodies). Node's execFileSync
    // default maxBuffer is 1 MB, which is insufficient for 25 richly
    // detailed PR bodies. We verify GH_RUNNER_MAX_BUFFER is >= 10 MB.
    expect(GH_RUNNER_MAX_BUFFER).toBeGreaterThanOrEqual(10 * 1024 * 1024);
  });

  it('default runner passes the bounded maxBuffer to execFileSync', () => {
    // GH_RUNNER_OPTIONS is the options object the default runner passes
    // to execFileSync. It must include a maxBuffer >= 10 MB so a valid
    // 25-node chunk response never hits Node's default 1 MB limit.
    expect(GH_RUNNER_OPTIONS.maxBuffer).toBe(GH_RUNNER_MAX_BUFFER);
    expect(GH_RUNNER_OPTIONS.encoding).toBe('utf8');
    expect(GH_RUNNER_OPTIONS.timeout).toBe(15_000);
  });

  it('processes a realistic 25-node chunk with 100 labels per node under the buffer', () => {
    // Build a realistic response: 25 PRs, each with a 100 KB body and
    // 100 labels. This is the worst-case bounded chunk that must fit
    // within GH_RUNNER_MAX_BUFFER (10 MiB).
    const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
    const largeBody = 'x'.repeat(100_000);
    const labels = Array.from({ length: 100 }, (_, i) => ({
      name: `label-${i}`,
    }));
    const repo: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) {
      repo[`r${i}`] = {
        __typename: 'PullRequest',
        number: numbers[i]!,
        title: `PR ${numbers[i]}`,
        body: largeBody,
        labels: { nodes: labels, totalCount: 100 },
        author: { login: 'u' },
      };
    }
    const raw = repoEnvelope(repo);
    // The response must be well under the 10 MiB buffer.
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThan(GH_RUNNER_MAX_BUFFER);
    const result = parseChunkResponse(raw, numbers);
    expect(result.size).toBe(25);
  });

  it('a full multibyte 25-node chunk (4-byte CJK) fits under the buffer', () => {
    // Worst-case multibyte: 25 nodes each with 65536 chars of 4-byte UTF-8.
    // 25 × 65536 × 4 = 6,553,600 bytes ≈ 6.25 MiB, well under 10 MiB.
    const cjkBody = '𠮷'.repeat(65_536); // 4-byte UTF-8 character
    const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
    const repo: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) {
      repo[`r${i}`] = {
        __typename: 'PullRequest',
        number: numbers[i]!,
        title: `PR ${numbers[i]}`,
        body: cjkBody,
        author: { login: 'u' },
      };
    }
    const raw = repoEnvelope(repo);
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThan(GH_RUNNER_MAX_BUFFER);
    const result = parseChunkResponse(raw, numbers);
    expect(result.size).toBe(25);
  });
});

describe('safeMultibyteString', () => {
  it('returns string input unchanged', () => {
    const valid = JSON.stringify({ data: { repository: {} } });
    expect(safeMultibyteString(valid)).toBe(valid);
  });

  it('handles a multibyte JSON response with valid UTF-8', () => {
    const node = {
      data: {
        repository: {
          r0: {
            __typename: 'PullRequest',
            number: 1,
            title: 'Fix: 流れる星の原理',
            body: '日本語のボディ',
            author: { login: 'alice' },
          },
        },
      },
    };
    const raw = JSON.stringify(node);
    const result = safeMultibyteString(raw);
    expect(JSON.parse(result)).toEqual(node);
  });

  it('converts a Buffer to a UTF-8 string', () => {
    const expected = JSON.stringify({ data: { repository: {} } });
    const buf = Buffer.from(expected, 'utf8');
    expect(safeMultibyteString(buf)).toBe(expected);
  });
});

describe('multibyte content through fetchRefsViaGh', () => {
  it('processes a valid multibyte response without truncation', () => {
    // A runner that returns valid JSON with multibyte content — no truncation.
    const response = repoEnvelope({
      r0: {
        __typename: 'PullRequest',
        number: 42,
        title: 'Fix: マルチバイト対応',
        body: 'テスト用ボディ',
        author: { login: 'alice' },
      },
    });
    const runner = () => response;
    const result = fetchRefsViaGh('owner/repo', [42], runner);
    expect(result.size).toBe(1);
    expect(requireRef(result, 42).title).toBe('Fix: マルチバイト対応');
  });

  it('parses a response with multibyte CJK content in bodies correctly', () => {
    // A realistic multibyte response with CJK characters in PR titles
    // and bodies. This exercises the UTF-8 handling path end-to-end.
    const response = repoEnvelope({
      r0: {
        __typename: 'PullRequest',
        number: 10,
        title: 'feat: 新機能の追加',
        body: 'ユーザーは新しいストリーミング機能を使用できるようになります。',
        labels: { nodes: [{ name: 'feature' }] },
        author: { login: 'alice' },
      },
      r1: {
        __typename: 'PullRequest',
        number: 20,
        title: 'fix: バグ修正',
        body: 'クラッシュの問題を修正しました。',
        labels: { nodes: [{ name: 'bug' }] },
        author: { login: 'bob' },
      },
    });
    const runner = () => response;
    const result = fetchRefsViaGh('owner/repo', [10, 20], runner);
    expect(result.size).toBe(2);
    expect(requireRef(result, 10).title).toBe('feat: 新機能の追加');
    expect(requireRef(result, 20).title).toBe('fix: バグ修正');
    expect(requireRef(result, 10).labels).toEqual(['feature']);
  });
});

describe('label truncation safety beyond 100 labels', () => {
  it('processes up to 100 labels without truncation', () => {
    const labels = Array.from({ length: 100 }, (_, i) => ({
      name: `label-${i}`,
    }));
    const raw = repoEnvelope({
      r0: {
        __typename: 'PullRequest',
        number: 10,
        title: 'PR with 100 labels',
        labels: { nodes: labels, totalCount: 100 },
        author: { login: 'alice' },
      },
    });
    const result = parseChunkResponse(raw, [10]);
    expect(result.size).toBe(1);
    expect(requireRef(result, 10).labels).toHaveLength(100);
  });

  it('truncates labels beyond 100 to prevent unbounded arrays', () => {
    const labels = Array.from({ length: 150 }, (_, i) => ({
      name: `label-${i}`,
    }));
    const raw = repoEnvelope({
      r0: {
        __typename: 'PullRequest',
        number: 10,
        title: 'PR with 150 labels',
        labels: { nodes: labels, totalCount: 150 },
        author: { login: 'alice' },
      },
    });
    const result = parseChunkResponse(raw, [10]);
    expect(result.size).toBe(1);
    // Labels beyond 100 are truncated for safety.
    expect(requireRef(result, 10).labels).toHaveLength(MAX_LABELS_PER_NODE);
  });

  it('includes totalCount from the GraphQL response for truncation detection', () => {
    const raw = repoEnvelope({
      r0: {
        __typename: 'PullRequest',
        number: 10,
        title: 'PR',
        labels: { nodes: [{ name: 'bug' }], totalCount: 5 },
        author: { login: 'alice' },
      },
    });
    const result = parseChunkResponse(raw, [10]);
    expect(result.size).toBe(1);
    // The label node schema now includes totalCount in the connection.
    // The extracted labels still work correctly.
    expect(requireRef(result, 10).labels).toEqual(['bug']);
  });

  it('handles missing totalCount gracefully', () => {
    const raw = repoEnvelope({
      r0: {
        __typename: 'PullRequest',
        number: 10,
        title: 'PR without totalCount',
        labels: { nodes: [{ name: 'bug' }] },
        author: { login: 'alice' },
      },
    });
    const result = parseChunkResponse(raw, [10]);
    expect(result.size).toBe(1);
    expect(requireRef(result, 10).labels).toEqual(['bug']);
  });

  it('MAX_LABELS_PER_NODE is 100 matching the GraphQL first:100 query', () => {
    expect(MAX_LABELS_PER_NODE).toBe(100);
  });

  it('sets labelsTruncated when 100 nodes are returned but totalCount is 150', () => {
    // Realistic scenario: a PR with 150 labels. The GraphQL query
    // labels(first:100) returns 100 nodes but totalCount=150, signaling
    // that additional label pages exist. The parser must set
    // labelsTruncated=true so downstream classification conservatively
    // demotes the entry.
    const labelNodes = Array.from({ length: 100 }, (_, i) => ({
      name: `label-${i}`,
    }));
    const raw = repoEnvelope({
      r0: {
        __typename: 'PullRequest',
        number: 10,
        title: 'PR with 150 total labels',
        labels: { nodes: labelNodes, totalCount: 150 },
        author: { login: 'alice' },
      },
    });
    const result = parseChunkResponse(raw, [10]);
    expect(result.size).toBe(1);
    const ref = result.get(10);
    expect(ref).toBeDefined();
    if (ref !== undefined) {
      expect(ref.labels).toHaveLength(100);
      expect(ref.labelsTruncated).toBe(true);
    }
  });

  it('does not set labelsTruncated when totalCount equals node count', () => {
    // 100 labels with totalCount=100 means no additional pages.
    const labelNodes = Array.from({ length: 100 }, (_, i) => ({
      name: `label-${i}`,
    }));
    const raw = repoEnvelope({
      r0: {
        __typename: 'PullRequest',
        number: 10,
        title: 'PR with exactly 100 labels',
        labels: { nodes: labelNodes, totalCount: 100 },
        author: { login: 'alice' },
      },
    });
    const result = parseChunkResponse(raw, [10]);
    expect(result.size).toBe(1);
    const ref = result.get(10);
    expect(ref).toBeDefined();
    if (ref !== undefined) {
      expect(ref.labelsTruncated).toBe(false);
    }
  });
});
