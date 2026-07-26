/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import type { EnrichedRef, GhPort } from './types.js';

/**
 * Number of PR/issue nodes per GraphQL query chunk. Each node carries title,
 * body (up to 65536 chars), labels (first 100), and author. With 4-byte
 * UTF-8 multibyte content, 25 nodes × 65536 chars × 4 bytes ≈ 6.5 MB,
 * which fits comfortably under GH_RUNNER_MAX_BUFFER (10 MB) with JSON
 * overhead. This is a documented, bounded design: 25-node chunks at 10 MiB
 * maxBuffer never exceed the limit for any valid response.
 */
const CHUNK_SIZE = 25;
export const MAX_ENRICHED_REFS = 1000;

// ---------------------------------------------------------------------------
// Zod schemas for safe GraphQL response parsing.
// ---------------------------------------------------------------------------

const labelConnectionSchema = z.object({
  nodes: z.array(z.unknown()).optional(),
  totalCount: z.number().optional(),
});

const labelNodeSchema = z.object({
  name: z.string().optional(),
});

const authorSchema = z
  .object({
    login: z.string().optional(),
  })
  .nullish();

const nodeSchema = z
  .object({
    __typename: z.string().optional(),
    number: z.number().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    // Labels use a permissive schema here; individual label nodes are
    // validated separately in extractLabels so one malformed label does not
    // reject the entire node. totalCount lets us detect label truncation
    // when a PR/issue has more than 100 labels.
    labels: labelConnectionSchema.optional(),
    author: authorSchema,
  })
  .nullish();

const envelopeSchema = z.object({
  data: z
    .object({
      repository: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Injectable runner abstraction.
// ---------------------------------------------------------------------------

export type GhRunner = (args: readonly string[]) => string;

/**
 * maxBuffer for the gh CLI runner. Each chunk contains up to CHUNK_SIZE
 * PR/issue nodes, each with title, body (up to 65536 chars), labels, and
 * author. A full 25-node full-multibyte response can reach ~6.5 MB, so
 * 10 MiB provides headroom. Because the chunk size is deliberately bounded
 * to keep the worst-case response under this limit, maxBuffer truncation
 * should never occur under normal operation. If it does (e.g. a node with
 * an unexpectedly large body), the chunk is treated as a failed runner
 * call and skipped — no partial recovery is attempted.
 */
export const GH_RUNNER_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Options object passed to execFileSync by the default runner. Exported
 * so tests can verify the bounded maxBuffer without mocking child_process.
 */
export const GH_RUNNER_OPTIONS: {
  readonly encoding: BufferEncoding;
  readonly timeout: number;
  readonly maxBuffer: number;
} = {
  encoding: 'utf8',
  timeout: 15_000,
  maxBuffer: GH_RUNNER_MAX_BUFFER,
};

/**
 * Safely converts a Buffer to a UTF-8 string. Exported for tests that need
 * to verify Buffer handling. Node's execFileSync returns a string when
 * encoding is set to 'utf8', so this function is only used when a Buffer
 * is returned by a custom runner.
 *
 * No partial maxBuffer recovery is attempted: the chunk size and maxBuffer
 * are bounded so that truncation does not occur under normal operation. If
 * a runner returns invalid data, the chunk is treated as a failed call.
 */
export function safeMultibyteString(raw: string | Buffer): string {
  if (typeof raw === 'string') {
    return raw;
  }
  return raw.toString('utf8');
}

export const defaultRunner: GhRunner = (args) =>
  execFileSync('gh', [...args], GH_RUNNER_OPTIONS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRepository(repository: string): readonly [string, string] {
  const match = /^([^/]+)\/([^/]+)$/.exec(repository);
  if (match === null) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  const owner = match[1];
  const name = match[2];
  if (owner === undefined || name === undefined) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  return [owner, name];
}

function chunks(numbers: readonly number[]): number[][] {
  const result: number[][] = [];
  for (let index = 0; index < numbers.length; index += CHUNK_SIZE) {
    result.push(numbers.slice(index, index + CHUNK_SIZE));
  }
  return result;
}

function buildQuery(numbers: readonly number[]): string {
  const variables = numbers.map((_, index) => `$n${index}:Int!`).join(',');
  const selections = numbers
    .map(
      (_, index) =>
        `r${index}:issueOrPullRequest(number:$n${index}){__typename ... on Issue{number title body labels(first:100){nodes{name} totalCount} author{login}} ... on PullRequest{number title body labels(first:100){nodes{name} totalCount} author{login}}}`,
    )
    .join(' ');
  return `query($owner:String!,$name:String!,${variables}){repository(owner:$owner,name:$name){${selections}}}`;
}

function buildArgs(
  owner: string,
  name: string,
  numbers: readonly number[],
): string[] {
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${buildQuery(numbers)}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
  ];
  numbers.forEach((number, index) => {
    args.push('-F', `n${index}=${number}`);
  });
  return args;
}

/**
 * Maximum number of labels to process per node. GitHub's GraphQL API caps
 * `labels(first:N)` at 100 per page; when a PR/issue exceeds this, additional
 * labels require pagination. Since label-driven classification only needs the
 * first set of meaningful labels (bug, feature, enhancement, internal, etc.),
 * we bound processing to this limit. The totalCount from the response is
 * checked to detect truncation.
 */
export const MAX_LABELS_PER_NODE = 100;

interface LabelExtraction {
  readonly labels: readonly string[];
  readonly truncated: boolean;
}

function extractLabels(
  labels:
    | { readonly nodes?: readonly unknown[]; readonly totalCount?: number }
    | undefined,
): LabelExtraction {
  const result: string[] = [];
  for (const raw of labels?.nodes ?? []) {
    const parsed = labelNodeSchema.safeParse(raw);
    if (parsed.success && parsed.data.name !== undefined) {
      result.push(parsed.data.name);
    }
  }
  const totalCount = labels?.totalCount;
  const truncated =
    labels?.nodes === undefined ||
    typeof totalCount !== 'number' ||
    totalCount > result.length;
  return {
    labels: result.slice(0, MAX_LABELS_PER_NODE),
    truncated,
  };
}

/**
 * Safely converts a single raw GraphQL node into an EnrichedRef. Returns null
 * when the node is malformed, null/undefined, the returned number does not
 * match the requested batch number, or a title is absent.
 */
function tryEnrichNode(
  rawNode: unknown,
  requestedNumber: number,
): EnrichedRef | null {
  const result = nodeSchema.safeParse(rawNode);
  if (!result.success) {
    return null;
  }
  const node = result.data;
  if (node === null || node === undefined) {
    return null;
  }
  // Verify the alias rN node number equals the requested batch number to
  // prevent key/number mismatches from corrupting the result map.
  if (node.number !== requestedNumber) {
    return null;
  }
  if (node.title === undefined) {
    return null;
  }
  const extracted = extractLabels(node.labels);
  return {
    number: requestedNumber,
    title: node.title,
    body: node.body ?? '',
    labels: extracted.labels,
    labelsTruncated: extracted.truncated,
    metadataAvailable: true,
    author: node.author?.login ?? '',
    isPr: node.__typename === 'PullRequest',
    userImpact: null,
  };
}

/**
 * Parses a raw gh GraphQL response string for a single chunk (batch) of
 * requested numbers. Malformed JSON, malformed envelopes, and individual
 * malformed/null/mismatched nodes are degraded gracefully — valid nodes
 * within the same response are still returned.
 */
export function parseChunkResponse(
  raw: string,
  batch: readonly number[],
): Map<number, EnrichedRef> {
  const result = new Map<number, EnrichedRef>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }
  const envelope = envelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    return result;
  }
  const repo = envelope.data.data?.repository ?? {};
  batch.forEach((requestedNumber, index) => {
    const enriched = tryEnrichNode(repo[`r${index}`], requestedNumber);
    if (enriched !== null) {
      result.set(requestedNumber, enriched);
    }
  });
  return result;
}

/**
 * Fetches enriched refs via the gh CLI with an injectable runner. Numbers are
 * sorted, de-duplicated, and batched in groups of CHUNK_SIZE (25). A failed
 * chunk (runner throws) is skipped and the loop continues to the next chunk.
 * Individual malformed/null/mismatched nodes within a successful response are
 * degraded without affecting sibling nodes.
 */
export function fetchRefsViaGh(
  repository: string,
  numbers: readonly number[],
  runner: GhRunner = defaultRunner,
): Map<number, EnrichedRef> {
  const [owner, name] = parseRepository(repository);
  const result = new Map<number, EnrichedRef>();
  const sortedNumbers = [...new Set(numbers)].sort(
    (left, right) => left - right,
  );
  if (sortedNumbers.length > MAX_ENRICHED_REFS) {
    console.warn(
      `GitHub enrichment limited to ${MAX_ENRICHED_REFS} of ${sortedNumbers.length} references.`,
    );
  }
  const uniqueNumbers = sortedNumbers.slice(0, MAX_ENRICHED_REFS);
  for (const batch of chunks(uniqueNumbers)) {
    try {
      const batchResult = parseChunkResponse(
        runner(buildArgs(owner, name, batch)),
        batch,
      );
      for (const [num, ref] of batchResult) {
        result.set(num, ref);
      }
    } catch {
      console.warn(
        `GitHub enrichment failed for reference batch ${batch[0]}-${batch.at(-1)}.`,
      );
    }
  }
  return result;
}

export function createGhPort(repository: string, runner?: GhRunner): GhPort {
  return {
    async fetchRefs(numbers: readonly number[]) {
      return fetchRefsViaGh(repository, numbers, runner);
    },
  };
}
