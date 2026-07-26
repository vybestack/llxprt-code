/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ChangeEntry,
  EnrichedRef,
  GhPort,
  ParsedRef,
  RawCommit,
  TopologyResolver,
} from './types.js';
import {
  classifyCommit,
  classifyEnrichedRefs,
  deriveEffectiveCategory,
  isEligibleForHighlights,
  strongerCategory,
} from './classification.js';
import { parseRefs, extractPrIdentity, isProcessNoise } from './filtering.js';
import { extractSourceFacts } from './provenance.js';

/**
 * A group of commits that belong to the same logical change (same PR).
 */
export interface CommitGroup {
  readonly representative: RawCommit;
  readonly commits: readonly RawCommit[];
  readonly childHashes: readonly string[];
}

/**
 * Groups raw commits by their PR identity using git topology. The grouping
 * key is the terminal squash marker `(#N)` or classic merge marker
 * `Merge pull request #N` — never a `Fixes #N` issue reference, since two
 * distinct PRs can close the same issue and must not be merged into one
 * entry.
 *
 * Classic merge commits (two parents) are resolved via the TopologyResolver
 * to find their introduced child commits; those children are grouped under
 * the merge's PR identity and their hashes populate childHashes. This ensures
 * no commit is lost: the merge and all its children become one entry.
 *
 * Commits without any PR identity become individual entries. Process-noise
 * commits are dropped from model input but never lose PR identity.
 */
function moveCommitToOwnerGroup(
  commit: RawCommit,
  groups: CommitGroup[],
  childToGroup: ReadonlyMap<string, number>,
  groupByPrNumber: ReadonlyMap<number, number>,
): void {
  const ownerIndex = childToGroup.get(commit.hash);
  const prNumber = extractPrIdentity(commit);
  const ownIndex =
    prNumber === null ? undefined : groupByPrNumber.get(prNumber);
  if (
    ownerIndex === undefined ||
    ownIndex === undefined ||
    ownerIndex === ownIndex
  ) {
    return;
  }
  const ownerGroup = groups[ownerIndex];
  const ownGroup = groups[ownIndex];
  if (ownerGroup === undefined || ownGroup === undefined) {
    return;
  }
  groups[ownerIndex] = {
    ...ownerGroup,
    commits: [...ownerGroup.commits, commit],
  };
  groups[ownIndex] = {
    ...ownGroup,
    commits: ownGroup.commits.filter(
      (candidate) => candidate.hash !== commit.hash,
    ),
  };
}

function reconcileNestedMerges(
  groups: CommitGroup[],
  classicMerges: readonly RawCommit[],
  childToGroup: ReadonlyMap<string, number>,
  groupByPrNumber: ReadonlyMap<number, number>,
): void {
  for (const commit of classicMerges) {
    moveCommitToOwnerGroup(commit, groups, childToGroup, groupByPrNumber);
  }
  for (let index = 0; index < groups.length; index += 1) {
    const current = groups[index];
    if (current === undefined) {
      continue;
    }
    groups[index] = {
      ...current,
      childHashes: current.childHashes.filter(
        (hash) => childToGroup.get(hash) === index,
      ),
    };
  }
}

function resolveIntroducedHashes(
  commit: RawCommit,
  resolver: TopologyResolver | undefined,
): readonly string[] {
  if (resolver === undefined) {
    return [];
  }
  const [firstParent, secondParent] = commit.parents;
  if (firstParent === undefined || secondParent === undefined) {
    return [];
  }
  if (commit.parents.length === 2) {
    return resolver.getMergeIntroducedHashes(firstParent, secondParent);
  }
  return resolver.getOctopusMergeIntroducedHashes(commit.parents);
}

function registerMergeGroups(
  commits: readonly RawCommit[],
  resolver: TopologyResolver | undefined,
  groups: CommitGroup[],
  groupByPrNumber: Map<number, number>,
  childToGroup: Map<string, number>,
): RawCommit[] {
  const merges = commits.filter(
    (commit) => commit.isMerge && commit.parents.length >= 2,
  );
  for (const commit of merges) {
    const prNumber = extractPrIdentity(commit);
    if (prNumber === null) {
      continue;
    }
    const groupIndex = groups.length;
    const childHashes = [...new Set(resolveIntroducedHashes(commit, resolver))];
    for (const hash of childHashes) {
      childToGroup.set(hash, groupIndex);
    }
    groupByPrNumber.set(prNumber, groupIndex);
    groups.push({ representative: commit, commits: [commit], childHashes });
  }
  return merges;
}

/**
 * Assigns a non-merge commit that is a child of a registered classic merge
 * to its owning group. Returns true when the commit was mapped to a group
 * (whether or not the group exists), so the caller knows to skip further
 * processing. Returns false when the commit is not a mapped child.
 */
function assignChildToGroup(
  commit: RawCommit,
  groups: CommitGroup[],
  childToGroup: ReadonlyMap<string, number>,
): boolean {
  const mappedGroup = childToGroup.get(commit.hash);
  if (mappedGroup === undefined) {
    return false;
  }
  const existing = groups[mappedGroup];
  if (existing !== undefined) {
    const childHashes = existing.childHashes.includes(commit.hash)
      ? existing.childHashes
      : [...existing.childHashes, commit.hash];
    groups[mappedGroup] = {
      representative: existing.representative,
      commits: [...existing.commits, commit],
      childHashes,
    };
  }
  return true;
}

/**
 * Assigns a non-merge commit by its PR identity: joins an existing group
 * for that PR, or creates a new group. Commits without a PR identity form
 * a new individual group.
 */
function assignByPrIdentity(
  commit: RawCommit,
  groups: CommitGroup[],
  groupByPrNumber: Map<number, number>,
): void {
  const prNumber = extractPrIdentity(commit);
  if (prNumber === null) {
    groups.push({
      representative: commit,
      commits: [commit],
      childHashes: [],
    });
    return;
  }
  const existingIndex = groupByPrNumber.get(prNumber);
  if (existingIndex === undefined) {
    groupByPrNumber.set(prNumber, groups.length);
    groups.push({
      representative: commit,
      commits: [commit],
      childHashes: [],
    });
    return;
  }
  const existing = groups[existingIndex];
  if (existing === undefined) {
    return;
  }
  groups[existingIndex] = {
    representative: existing.representative,
    commits: [...existing.commits, commit],
    childHashes: existing.childHashes,
  };
}

export function groupPrCommits(
  commits: readonly RawCommit[],
  resolver?: TopologyResolver,
): readonly CommitGroup[] {
  const groups: CommitGroup[] = [];
  const groupByPrNumber = new Map<number, number>();
  const childToGroup = new Map<string, number>();
  const multiParentMerges = registerMergeGroups(
    commits,
    resolver,
    groups,
    groupByPrNumber,
    childToGroup,
  );

  reconcileNestedMerges(
    groups,
    multiParentMerges,
    childToGroup,
    groupByPrNumber,
  );

  // Second pass: assign non-merge commits to a group by PR identity, or by
  // being a child of a registered classic merge. Commits without either form
  // a new individual group.
  const nonMergeCommits = commits.filter((candidate) => !candidate.isMerge);
  for (const commit of nonMergeCommits) {
    if (assignChildToGroup(commit, groups, childToGroup)) {
      continue;
    }
    assignByPrIdentity(commit, groups, groupByPrNumber);
  }

  return groups;
}

/**
 * Collects all unique ref numbers from a set of commit groups for batched
 * gh dereferencing. This includes both PR identity numbers and Fixes/Closes
 * issue references (kept as enrichment).
 */
function collectRefNumbers(groups: readonly CommitGroup[]): number[] {
  const numbers = new Set<number>();
  for (const group of groups) {
    for (const commit of group.commits) {
      for (const ref of parseRefs(commit.subject)) {
        numbers.add(ref.number);
      }
    }
  }
  return [...numbers];
}

/**
 * Builds enriched refs for a single group's refs, using the batched map.
 *
 * Refs whose PR number is the identity of a different group are excluded to
 * prevent label contamination in nested merge topology: when the outer PR
 * owns the inner merge commit topologically, the inner merge's PR identity
 * must NOT bleed into the outer group's enrichment. Conversely, the group's
 * own PR identity ref is always included even when the merge commit that
 * carries it has moved to an outer group (nested merge topology).
 */
function unavailableRef(number: number): EnrichedRef {
  return {
    number,
    title: '',
    body: '',
    labels: [],
    labelsTruncated: false,
    metadataAvailable: false,
    author: '',
    isPr: false,
    userImpact: null,
  };
}

function resolveGroupRefs(
  group: CommitGroup,
  enrichedMap: ReadonlyMap<number, EnrichedRef>,
  foreignPrNumbers: ReadonlySet<number>,
  ownPrNumber: number | null,
): { refs: ParsedRef[]; enriched: EnrichedRef[] } {
  const refs: ParsedRef[] = [];
  const enriched: EnrichedRef[] = [];
  const seenNumbers = new Set<number>();

  // The group's own PR identity is always retained, even when the merge commit
  // carrying it has moved to an outer group in nested merge topology.
  if (ownPrNumber !== null) {
    refs.push({ number: ownPrNumber, verb: 'pr' });
    seenNumbers.add(ownPrNumber);
    enriched.push(enrichedMap.get(ownPrNumber) ?? unavailableRef(ownPrNumber));
  }

  for (const commit of group.commits) {
    for (const ref of parseRefs(commit.subject)) {
      if (seenNumbers.has(ref.number) || foreignPrNumbers.has(ref.number)) {
        continue;
      }
      seenNumbers.add(ref.number);
      refs.push(ref);
      enriched.push(enrichedMap.get(ref.number) ?? unavailableRef(ref.number));
    }
  }
  return { refs, enriched: dedupeEnriched(enriched) };
}

function dedupeEnriched(enriched: EnrichedRef[]): EnrichedRef[] {
  const seen = new Set<number>();
  const result: EnrichedRef[] = [];
  for (const ref of enriched) {
    if (!seen.has(ref.number)) {
      seen.add(ref.number);
      result.push(ref);
    }
  }
  return result;
}

/**
 * Processes raw commits into classified, enriched change entries. The core
 * transformation pipeline:
 *   group (topology-aware, PR-identity-keyed) → filter noise → dereference → classify
 *
 * Classic merge commits and their child commits are kept through grouping
 * (no commits lost), then grouped into one entry per PR. Process noise is
 * filtered without losing PR identity. Enrichment failure degrades gracefully.
 */
export async function buildChangeEntries(
  commits: readonly RawCommit[],
  ghPort: GhPort,
  resolver?: TopologyResolver,
): Promise<readonly ChangeEntry[]> {
  const groups = groupPrCommits(commits, resolver);
  const refNumbers = collectRefNumbers(groups);
  const allPrNumbers = new Set<number>(
    groups
      .map((group) => extractPrIdentity(group.representative))
      .filter((num): num is number => num !== null),
  );

  let enrichedMap: ReadonlyMap<number, EnrichedRef> = new Map();
  if (refNumbers.length > 0) {
    try {
      enrichedMap = await ghPort.fetchRefs(refNumbers);
    } catch {
      console.warn(
        `GitHub enrichment failed for ${refNumbers.length} release-note references; continuing without metadata.`,
      );
    }
  }

  const entries: ChangeEntry[] = [];
  for (const group of groups) {
    const entry = buildGroupEntry(group, enrichedMap, allPrNumbers);
    if (entry !== null) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Determines whether a group should be omitted from the categorized entry
 * list. A group is omitted when all commits are process noise, or when a
 * classic merge wrapper has no non-noise child commits (all children are
 * process noise). Returns true when the group should be skipped.
 */
function shouldOmitGroup(
  group: CommitGroup,
  nonNoiseCommits: readonly RawCommit[],
): boolean {
  if (nonNoiseCommits.length === 0 && isProcessNoise(group.representative)) {
    return true;
  }
  // Classic merge wrapper whose only non-noise commit is the merge itself
  // (all child commits are process noise): omit the logical categorized
  // entry. Raw commits (merge + children) are retained in All Changes
  // because the orchestrator formats rawCommits directly.
  return (
    group.representative.isMerge &&
    group.commits.length > 1 &&
    nonNoiseCommits.length === 1 &&
    nonNoiseCommits[0] === group.representative
  );
}

/**
 * Builds a ChangeEntry for a single commit group, or returns null when the
 * group should be omitted (all process noise, or a classic merge wrapper
 * with no substantive child commits).
 *
 * For classic merge groups, the first non-noise child commit is preferred as
 * the representative — a substantive child carries classification signal that
 * the merge commit's boilerplate subject does not.
 */
function buildGroupEntry(
  group: CommitGroup,
  enrichedMap: ReadonlyMap<number, EnrichedRef>,
  allPrNumbers: ReadonlySet<number>,
): ChangeEntry | null {
  const nonNoiseCommits = group.commits.filter(
    (commit) => !isProcessNoise(commit),
  );
  if (shouldOmitGroup(group, nonNoiseCommits)) {
    return null;
  }
  const nonMergeNonNoise = group.representative.isMerge
    ? nonNoiseCommits.filter((commit) => !commit.isMerge)
    : nonNoiseCommits;
  const representative =
    nonMergeNonNoise.length > 0
      ? (nonMergeNonNoise[0] ?? group.representative)
      : group.representative;
  const ownPrIdentity = extractPrIdentity(group.representative);
  // PR numbers owned by other groups must not contaminate this group's
  // enrichment. The own PR identity is retained; all others are foreign.
  const foreignPrNumbers =
    ownPrIdentity === null
      ? allPrNumbers
      : new Set([...allPrNumbers].filter((num) => num !== ownPrIdentity));
  const { refs, enriched } = resolveGroupRefs(
    group,
    enrichedMap,
    foreignPrNumbers,
    ownPrIdentity,
  );
  const commitCategory = classifyCommit(representative);
  const ownRef =
    ownPrIdentity === null
      ? undefined
      : enriched.find((ref) => ref.number === ownPrIdentity);
  const hasOwnPrMetadata = ownRef?.metadataAvailable === true;
  const prefixCategory = hasOwnPrMetadata
    ? strongerCategory(commitCategory, classifyEnrichedRefs(enriched))
    : commitCategory;
  const category = deriveEffectiveCategory(prefixCategory, enriched);
  const eligible = isEligibleForHighlights(category, enriched);
  const prIdentity = extractPrIdentity(group.representative);
  const source = {
    id:
      prIdentity === null
        ? `commit:${representative.hash}`
        : `ref:${prIdentity}`,
    enriched,
    category,
  };
  return {
    ...source,
    subject: representative.subject,
    hash: representative.hash,
    author: representative.author,
    refs,
    eligibleForHighlights: eligible,
    childHashes: group.childHashes,
    sourceFacts: extractSourceFacts(source),
  };
}
