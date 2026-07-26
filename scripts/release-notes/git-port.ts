/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import type { TagInfo } from './diff-selection.js';
import type { RawCommit, TopologyResolver } from './types.js';

/**
 * Executes a git command and returns its stdout as a string.
 */
function gitExec(
  args: readonly string[],
  options: Partial<ExecFileSyncOptions> = {},
): string {
  return execFileSync('git', ['-c', 'core.pager=', ...args], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  }).toString();
}

/**
 * Lists all tags with their creatordate as unix timestamps.
 */
export function listTags(): TagInfo[] {
  const output = gitExec([
    'for-each-ref',
    '--format=%(refname:short)%09%(creatordate:unix)',
    'refs/tags',
  ]);
  return output
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, timestamp] = line.split('\t');
      return { name: name ?? '', createdAt: Number(timestamp) * 1000 };
    });
}

/**
 * Regex validating a full 40-character lowercase hex Git object hash.
 * Git always emits 40-char hashes with `%H`; abbreviated `%h` is never used.
 */
export const FULL_HASH_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Number of fields per commit record: hash, subject, author, parents.
 */
const FIELD_COUNT = 4;

/**
 * Splits a string on NUL bytes using character-level logic.
 */
function splitOnNul(value: string): string[] {
  const result: string[] = [];
  let current = '';
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) === 0) {
      result.push(current);
      current = '';
    } else {
      current += value[index];
    }
  }
  result.push(current);
  return result;
}

/**
 * Splits a string on whitespace using character-level logic. Avoids regex
 * to prevent super-linear runtime on adversarial input.
 */
function splitOnWhitespace(value: string): string[] {
  const result: string[] = [];
  let current = '';
  for (let index = 0; index < value.length; index++) {
    const charCode = value.charCodeAt(index);
    if (isWhitespaceCharCode(charCode)) {
      if (current.length > 0) {
        result.push(current);
        current = '';
      }
    } else {
      current += value[index] ?? '';
    }
  }
  if (current.length > 0) {
    result.push(current);
  }
  return result;
}

function isWhitespaceCharCode(charCode: number): boolean {
  return isSpaceOrTab(charCode) || isNewlineLike(charCode);
}

function isSpaceOrTab(charCode: number): boolean {
  return charCode === 0x20 || charCode === 0x09;
}

function isNewlineLike(charCode: number): boolean {
  return (
    charCode === 0x0a ||
    charCode === 0x0d ||
    charCode === 0x0b ||
    charCode === 0x0c
  );
}

/**
 * Parses git log NUL-delimited output into RawCommit objects.
 *
 * The format is `%H%x00%s%x00%an%x00%P` — four NUL-separated fields per
 * record (hash, subject, author, parents). With `-z`, Git separates
 * records with a single NUL byte, so no trailing `%x00` is added after
 * `%P`. (Adding it would produce a double-NUL between records: one from
 * the explicit `%x00` and one from `-z`, which shifts every subsequent
 * record off-alignment and loses every other commit.)
 *
 * Git guarantees NUL cannot appear in any field value, so field boundaries
 * are unambiguous and fixed-position. Records with fewer than FIELD_COUNT
 * fields (truncated output) are skipped to prevent phantom records from
 * corrupting the commit list. Each hash is validated as a full 40-character
 * lowercase hex Git object hash; records with an invalid hash are skipped.
 */
export function parseCommits(output: string): RawCommit[] {
  const fields = splitOnNul(output);
  const commits: RawCommit[] = [];
  for (
    let index = 0;
    index + FIELD_COUNT <= fields.length;
    index += FIELD_COUNT
  ) {
    const hash = fields[index] ?? '';
    if (!FULL_HASH_PATTERN.test(hash)) {
      continue;
    }
    const subject = fields[index + 1] ?? '';
    const author = fields[index + 2] ?? '';
    const parentsRaw = fields[index + 3] ?? '';
    const parentList = splitOnWhitespace(parentsRaw.trim()).filter(
      (parent) => parent.length > 0,
    );
    commits.push({
      hash,
      subject,
      author,
      isMerge: parentList.length > 1,
      parents: parentList,
    });
  }
  return commits;
}

/**
 * Gets all commits in the range [fromRef..toRef] using `git log -z` with
 * NUL-delimited output. No trailing `%x00` is added after `%P` because
 * `-z` already inserts a single NUL between records — adding one in the
 * format string would create a double-NUL that corrupts alignment.
 * Returns ALL commits including merge commits — caller filtering decides
 * which to keep.
 */
export function getCommits(fromRef: string, toRef = 'HEAD'): RawCommit[] {
  const format = `%H%x00%s%x00%an%x00%P`;
  const output = gitExec([
    'log',
    '-z',
    `--format=${format}`,
    `${fromRef}..${toRef}`,
  ]);
  return parseCommits(output);
}

/**
 * Gets all commits reachable from `toRef` (default HEAD) including the
 * root commit. Unlike `getCommits`, which uses the exclusive `from..to`
 * range notation, this includes the root commit — essential for first
 * releases where the entire repository history must be covered.
 * Returns ALL commits including merge commits — caller filtering decides
 * which to keep.
 */
export function getAllCommits(toRef = 'HEAD'): RawCommit[] {
  const format = `%H%x00%s%x00%an%x00%P`;
  const output = gitExec(['log', '-z', `--format=${format}`, toRef]);
  return parseCommits(output);
}

/**
 * Returns the hash of the root commit (the first commit with no parents).
 * This is used as a fallback diff base when no previous release tag exists
 * (first release scenario). Returns null when the repository has no commits.
 */
export function getRootCommit(): string | null {
  try {
    const output = gitExec(['rev-list', '--max-parents=0', 'HEAD']).trim();
    // rev-list returns commits oldest-first by default, so the first line
    // is the true root commit. When multiple roots exist, pick the oldest.
    const firstLine = output.split('\n')[0]?.trim();
    if (firstLine === undefined || firstLine.length === 0) {
      return null;
    }
    return firstLine;
  } catch {
    return null;
  }
}

/**
 * Returns the commit hashes introduced by a two-parent merge commit (the
 * commits on the merged branch, not on the base). Uses git rev-list with
 * the merge-base exclusion pattern `^parent1 parent2`.
 */
export function getMergeIntroducedHashes(
  firstParent: string,
  secondParent: string,
): string[] {
  const output = gitExec(['rev-list', `^${firstParent}`, secondParent]);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Returns the deduplicated commit hashes introduced by a multi-parent
 * (octopus) merge — commits reachable from any non-first parent but not
 * from the first parent. For a 2-parent merge this delegates to
 * getMergeIntroducedHashes; for 3+ parents, it queries each non-first
 * parent independently and deduplicates the union.
 */
export function getOctopusMergeIntroducedHashes(
  parents: readonly string[],
): string[] {
  if (parents.length < 2) {
    return [];
  }
  const firstParent = parents[0];
  if (firstParent === undefined) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (let index = 1; index < parents.length; index += 1) {
    const parent = parents[index];
    if (parent === undefined) {
      continue;
    }
    const introduced = getMergeIntroducedHashes(firstParent, parent);
    for (const hash of introduced) {
      if (!seen.has(hash)) {
        seen.add(hash);
        result.push(hash);
      }
    }
  }
  return result;
}

/**
 * Creates a TopologyResolver backed by real git commands. Used by PR grouping
 * to associate classic merge commits with their introduced child commits.
 */
export function createTopologyResolver(): TopologyResolver {
  return {
    getMergeIntroducedHashes(firstParent: string, secondParent: string) {
      return getMergeIntroducedHashes(firstParent, secondParent);
    },
    getOctopusMergeIntroducedHashes(parents: readonly string[]) {
      return getOctopusMergeIntroducedHashes(parents);
    },
  };
}
