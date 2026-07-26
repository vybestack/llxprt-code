/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RawCommit, ParsedRef } from './types.js';

/**
 * Regular-expression patterns for process-noise commit subjects. Each is
 * narrowly matched so that a real feature or fix that happens to mention a
 * keyword is not accidentally dropped.
 */
const NOISE_PATTERNS: readonly RegExp[] = [
  /^coderabbit(?:\s|:)/i,
  /^(?:[^:]{1,40}:\s*)?(?:address|apply|resolve)\b.*\b(?:ocr|coderabbit|review)\b.*\b(?:findings?|feedback|threads?)\s*$/i,
  /^apply (?:coderabbit|review) suggestions?(?:\s|:|$)/i,
  /^address\s+(?:(?:coderabbit|ocr)\s+)?review\s+(?:feedback|findings)(?:\s|:|$)/i,
  /^(?:(?:fix|chore|test)(?:\([^)]*\))?:\s*)?address(?:\s+all\s+\d+)?\s+(?:ocr(?:\s+round\s+\d+)?(?:\s+review)?(?:\s+findings)?|(?:pr\d+\s+)?review\s+threads?)(?:\s|:|$)/i,
  /^fix\s+ocr\s+review\s+findings(?:\s|:|$)/i,
  /^chore(?:\([^)]*\))?:\s*address.*\breview\b/i,
  /^(?:chore:\s*)?(lint|style|format)(?:\s|:)/i,
  /^(?:chore|fix)(?:\([^)]*\))?:\s*(?:(?:fix|run)\s+)?(?:prettier|eslint|lint|format)(?:ting)?(?:\s|:|$)/i,
  /^ci(?:\([^)]*\))?:\s*(?:retrigger|rerun|retry)(?:$|[^a-zA-Z0-9])/i,
  /^ci(?:\([^)]*\))?:\s*trigger\s+(?:ci|build|tests?|workflow)(?:\s|:|$)/i,
  /^test(?:\([^)]*\))?:\s*stabiliz/i,
  /^test(?:\([^)]*\))?:\s*(?:fix\s+)?flaky(?:\s+\S+)*\s+tests?(?:\s|:|$)/i,
  /^chore\(deps?\)/i,
  /^chore:\s*(bump|update|upgrade)\s+(deps|dependenc)/i,
  /^chore:\s*(bump|update|upgrade)\s+\S+\s+from/i,
];

/**
 * Returns true when a commit subject is pure process noise: CodeRabbit/OCR
 * review fixups, lint/format runs, CI retriggers, flaky-test stabilization, or
 * automated dependency bumps. Real features and fixes must NOT be classified
 * as noise even if they share a keyword.
 */
export function isProcessNoise(commit: RawCommit): boolean {
  const subject = commit.subject;
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(subject)) {
      return true;
    }
  }
  return false;
}

/**
 * Pattern matching `Merge pull request #N`.
 */
const MERGE_PULL_REQUEST_PATTERN = /Merge pull request #(\d+)/i;

/**
 * Pattern matching a terminal GitHub PR marker `(#N)` at the end of a
 * subject — the convention GitHub appends to squash-merge commits.
 */
const TERMINAL_PR_PATTERN = /\(#(\d+)\)$/;

const REF_PATTERN = /\b(fix(?:es)?|clos(?:e|es)|resolv(?:e|es))\s+#(\d+)\b/gi;

/**
 * Parses issue/PR references from a commit subject. This recognizes three
 * independent kinds of markers:
 *  1. `Fixes/Closes/Resolves #N` issue references (enrichment only).
 *  2. `Merge pull request #N` classic-merge PR markers.
 *  3. `(#N)` terminal squash-merge PR markers (independent of Fixes/Closes).
 *
 * All relevant refs are retained without duplicate numbers.
 */
export function parseRefs(subject: string): ParsedRef[] {
  const refs: ParsedRef[] = [];
  const seenNumbers = new Set<number>();

  function addRef(number: number, verb: string): void {
    if (number <= 0 || seenNumbers.has(number)) {
      return;
    }
    seenNumbers.add(number);
    refs.push({ number, verb });
  }

  // 1. Fixes/Closes/Resolves issue references (in subject order).
  let match: RegExpExecArray | null;
  REF_PATTERN.lastIndex = 0;
  while ((match = REF_PATTERN.exec(subject)) !== null) {
    const number = parseInt(match[2], 10);
    if (Number.isInteger(number)) {
      addRef(number, match[1]);
    }
  }

  // 2. Classic-merge PR marker: Merge pull request #N.
  const mergeMatch = MERGE_PULL_REQUEST_PATTERN.exec(subject);
  if (mergeMatch !== null) {
    addRef(Number(mergeMatch[1]), 'merge');
  }

  // 3. Terminal squash-merge PR marker: (#N) at end of subject.
  const terminalMatch = TERMINAL_PR_PATTERN.exec(subject);
  if (terminalMatch !== null) {
    addRef(Number(terminalMatch[1]), 'pr');
  }

  return refs;
}

/**
 * Extracts the PR identity number from a commit subject. Only terminal squash
 * markers `(#N)` and classic merge markers `Merge pull request #N` provide
 * PR identity. Issue references (`Fixes #N`) are NOT PR identity — they are
 * enrichment only and must never be used as a grouping key.
 *
 * Returns the PR number, or null when the commit has no PR identity.
 */
export function extractPrIdentity(commit: RawCommit): number | null {
  const mergeMatch = MERGE_PULL_REQUEST_PATTERN.exec(commit.subject);
  if (mergeMatch !== null) {
    const number = Number(mergeMatch[1]);
    if (Number.isInteger(number) && number > 0) {
      return number;
    }
  }
  const terminalMatch = TERMINAL_PR_PATTERN.exec(commit.subject);
  if (terminalMatch !== null) {
    const number = Number(terminalMatch[1]);
    if (Number.isInteger(number) && number > 0) {
      return number;
    }
  }
  return null;
}
