/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';
import type { ReleaseMetadata } from './types.js';

export interface TagInfo {
  readonly name: string;
  readonly createdAt: number;
}

export interface ReleaseMetadataLookup {
  (tag: string): ReleaseMetadata;
  readonly candidates?: ReadonlySet<string>;
}

/**
 * Extracts the nightly suffix from a tag name, e.g. for
 * `v0.11.0-nightly.260714.abcdef` returns `260714.abcdef`.
 * Returns null when the tag is not a nightly for the given base version.
 */
function nightlySuffix(tagName: string, baseVersion: string): string | null {
  const prefix = `v${baseVersion}-nightly.`;
  if (!tagName.startsWith(prefix)) {
    return null;
  }
  return tagName.slice(prefix.length);
}

/**
 * Parses the date portion (YYMMDD) from a nightly suffix. Returns the date
 * as an integer for comparison, or null when no parseable date is present.
 */
function parseNightlyDate(suffix: string): number | null {
  const match = /^(\d{6})\b/.exec(suffix);
  if (match === null) {
    return null;
  }
  return Number(match[1]);
}

/**
 * Internal structure for locally plausible nightly candidates with pre-parsed
 * chronology fields. Local selection uses these fields only when no release
 * metadata lookup is available.
 */
interface NightlyCandidate {
  readonly name: string;
  readonly createdAt: number;
  readonly date: number | null;
  readonly suffix: string;
}

interface PublishedNightlyCandidate {
  readonly name: string;
  readonly publishedAt: number;
  readonly suffix: string;
}

function compareLocalNightlyChronology(
  left: NightlyCandidate,
  right: NightlyCandidate,
): number {
  if (left.date !== null && right.date !== null) {
    if (left.date !== right.date) {
      return left.date - right.date;
    }
  } else if (left.date !== null) {
    return -1;
  } else if (right.date !== null) {
    return 1;
  }
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }
  return left.suffix.localeCompare(right.suffix);
}

function comparePublicationChronology(
  left: PublishedNightlyCandidate,
  right: PublishedNightlyCandidate,
): number {
  if (left.publishedAt !== right.publishedAt) {
    return left.publishedAt - right.publishedAt;
  }
  return left.suffix.localeCompare(right.suffix);
}

function currentBaseVersion(currentTag: string): string | null {
  const parsed = semver.parse(currentTag.replace(/^v/, ''));
  return parsed === null
    ? null
    : `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function isOlderStableTag(tag: TagInfo, currentTag: string): boolean {
  if (tag.name === currentTag) {
    return false;
  }
  const parsed = semver.parse(tag.name.replace(/^v/, ''));
  const current = semver.parse(currentTag.replace(/^v/, ''));
  if (parsed === null || parsed.prerelease.length > 0) {
    return false;
  }
  if (current === null) {
    return true;
  }
  const currentStable = `${current.major}.${current.minor}.${current.patch}`;
  const isNightly = current.prerelease[0] === 'nightly';
  return isNightly
    ? semver.lte(parsed, currentStable)
    : semver.lt(parsed, current);
}

function latestStable(
  tags: readonly TagInfo[],
  currentTag: string,
): string | null {
  const candidates = tags.filter((tag) => isOlderStableTag(tag, currentTag));
  candidates.sort((left, right) => {
    const leftSemver = semver.parse(left.name.replace(/^v/, ''));
    const rightSemver = semver.parse(right.name.replace(/^v/, ''));
    if (leftSemver === null || rightSemver === null) {
      return 0;
    }
    return semver.compare(rightSemver, leftSemver); // descending
  });
  return candidates[0]?.name ?? null;
}

/**
 * Extracts the current tag's timestamp for use in chronological comparison.
 * When available, this avoids relying solely on tag createdAt from the ref
 * listing.
 */
function currentTagTimestamp(
  tags: readonly TagInfo[],
  currentTag: string,
): number | null {
  const found = tags.find((tag) => tag.name === currentTag);
  return found === undefined ? null : found.createdAt;
}

/**
 * Selects a locally plausible nightly predecessor. Without metadata it uses
 * parsed date, tag creation time, and suffix. With metadata it fails closed:
 * only confirmed published releases are eligible, ordered by publication time
 * and suffix. Confirmed-absent and unknown candidates are never selected.
 */
function predatesUnpublishedCurrent(
  releaseMetadata: ReleaseMetadataLookup | undefined,
  currentCreatedAt: number | null,
  currentDate: number | null,
  candidateDate: number | null,
): boolean {
  if (releaseMetadata !== undefined || currentCreatedAt !== null) {
    return true;
  }
  return (
    currentDate === null ||
    candidateDate === null ||
    candidateDate < currentDate
  );
}

function latestNightly(
  tags: readonly TagInfo[],
  currentTag: string,
  releaseMetadata: ReleaseMetadataLookup | undefined,
): string | null {
  const base = currentBaseVersion(currentTag);
  if (base === null) return null;
  const currentSuffix = nightlySuffix(currentTag, base);
  if (currentSuffix === null) return null;
  const currentDate = parseNightlyDate(currentSuffix);
  const currentCreatedAt = currentTagTimestamp(tags, currentTag);
  const priorCandidates: NightlyCandidate[] = tags
    .filter((tag) => tag.name !== currentTag)
    .flatMap((tag) => {
      const suffix = nightlySuffix(tag.name, base);
      if (suffix === null) {
        return [];
      }
      const candidate = {
        name: tag.name,
        createdAt: tag.createdAt,
        date: parseNightlyDate(suffix),
        suffix,
      };
      const predatesMissingTag = predatesUnpublishedCurrent(
        releaseMetadata,
        currentCreatedAt,
        currentDate,
        candidate.date,
      );
      return predatesMissingTag &&
        isPlausiblePredecessor(
          candidate,
          currentDate,
          currentCreatedAt ?? Number.MAX_SAFE_INTEGER,
        )
        ? [candidate]
        : [];
    });

  if (releaseMetadata === undefined) {
    return (
      priorCandidates.sort((left, right) =>
        compareLocalNightlyChronology(right, left),
      )[0]?.name ?? null
    );
  }

  const metadata = priorCandidates
    .filter(
      (candidate) =>
        releaseMetadata.candidates === undefined ||
        releaseMetadata.candidates.has(candidate.name),
    )
    .map((candidate) => ({
      candidate,
      release: releaseMetadata(candidate.name),
    }));
  if (metadata.some(({ release }) => release.status === 'unknown')) {
    throw new Error(
      'Unable to determine the previous published nightly release',
    );
  }
  const publishedCandidates: PublishedNightlyCandidate[] = metadata.flatMap(
    ({ candidate, release }) =>
      release.status === 'published'
        ? [
            {
              name: candidate.name,
              publishedAt: release.publishedAt,
              suffix: candidate.suffix,
            },
          ]
        : [],
  );
  return (
    publishedCandidates.sort((left, right) =>
      comparePublicationChronology(right, left),
    )[0]?.name ?? null
  );
}

/**
 * Proximity-sortable candidate shape for nightlyCandidateNames. Carries the
 * parsed date and createdAt used to compute chronological distance from the
 * current tag.
 */
interface ProximityCandidate {
  readonly name: string;
  readonly suffix: string;
  readonly date: number | null;
  readonly createdAt: number;
}

/**
 * Computes the absolute chronological distance (proximity) of a candidate
 * from the current tag's date. Candidates with parseable dates use the date
 * difference; candidates without are deprioritized when the current date
 * is known. Smaller value = closer to the current tag.
 */
function candidateDateProximity(
  candidateDate: number | null,
  currentDate: number | null,
): number {
  if (candidateDate !== null && currentDate !== null) {
    return Math.abs(candidateDate - currentDate);
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Compares two candidates by chronological proximity to the current tag.
 * The nearest candidate (smallest distance) comes first. Ties in parsed
 * date are broken by reverse chronological createdAt, then by deterministic
 * suffix order.
 *
 * Returns negative when `left` is closer (should come first).
 */
function compareCandidateProximity(
  left: ProximityCandidate,
  right: ProximityCandidate,
  currentDate: number | null,
): number {
  const leftProx = candidateDateProximity(left.date, currentDate);
  const rightProx = candidateDateProximity(right.date, currentDate);
  if (leftProx !== rightProx) {
    return leftProx - rightProx;
  }
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }
  if (left.suffix < right.suffix) {
    return -1;
  }
  if (left.suffix > right.suffix) {
    return 1;
  }
  return 0;
}

/**
 * Returns true when a candidate is chronologically before the current tag
 * by parsed date — i.e. a plausible predecessor. When neither date is
 * parseable, createdAt is used instead. Candidates with a date equal to
 * the current date are NOT future candidates (same-date with earlier
 * createdAt is a valid same-day predecessor).
 */
function isPlausiblePredecessor(
  candidate: ProximityCandidate,
  currentDate: number | null,
  currentCreatedAt: number,
): boolean {
  if (candidate.date !== null && currentDate !== null) {
    return (
      candidate.date < currentDate ||
      (candidate.date === currentDate &&
        candidate.createdAt <= currentCreatedAt)
    );
  }
  return candidate.createdAt <= currentCreatedAt;
}

/**
 * Returns the tag names of same-base nightly candidates that are
 * chronologically before the current tag (plausible predecessors only),
 * sorted by chronological proximity to the current tag. This is a local
 * filter (no network calls): it identifies tags matching
 * `v<base>-nightly.<suffix>` for the same base version as the current
 * nightly tag.
 *
 * Chronologically future candidates are EXCLUDED before the proximity
 * sort so that MAX_NIGHTLY_CANDIDATES never wastes metadata lookups on
 * tags that cannot be predecessors, and so they can never be selected
 * as the diff base. A candidate is future when its parsed date is
 * greater than the current tag's parsed date (same-date is NOT future —
 * same-date tags with earlier createdAt are valid same-day predecessors).
 *
 * Candidates are ordered so that the chronologically nearest plausible
 * predecessors come first. This ensures that when MAX_NIGHTLY_CANDIDATES
 * is applied downstream (in createBoundedReleaseMetadataLookup), the most
 * relevant tags — those closest to the target — are queried for
 * publication metadata, rather than arbitrary refname-order tags.
 *
 * Returns an empty array when the current tag is not a nightly.
 */
export function nightlyCandidateNames(
  tags: readonly TagInfo[],
  currentTag: string,
): string[] {
  const base = currentBaseVersion(currentTag);
  if (base === null) {
    return [];
  }
  const currentSuffix = nightlySuffix(currentTag, base);
  if (currentSuffix === null) {
    return [];
  }
  const currentDate = parseNightlyDate(currentSuffix);
  const currentTagInfo = tags.find((tag) => tag.name === currentTag);
  const currentCreatedAt = currentTagInfo?.createdAt ?? Number.MAX_SAFE_INTEGER;

  const candidates = tags
    .filter((tag) => tag.name !== currentTag)
    .map((tag) => {
      const suffix = nightlySuffix(tag.name, base);
      if (suffix === null) {
        return null;
      }
      return {
        name: tag.name,
        suffix,
        date: parseNightlyDate(suffix),
        createdAt: tag.createdAt,
      };
    })
    .filter(
      (
        c,
      ): c is {
        name: string;
        suffix: string;
        date: number | null;
        createdAt: number;
      } => c !== null,
    )
    .filter((candidate) =>
      isPlausiblePredecessor(candidate, currentDate, currentCreatedAt),
    );

  candidates.sort((left, right) =>
    compareCandidateProximity(left, right, currentDate),
  );

  return candidates.map((candidate) => candidate.name);
}

/**
 * Returns true when the current tag is a non-nightly prerelease (alpha, beta,
 * rc, etc.) — i.e. it has a prerelease component but does NOT match the
 * nightly pattern. Nightlies are handled by `latestNightly`, not here.
 */
function isPrereleaseTag(currentTag: string): boolean {
  const parsed = semver.parse(currentTag.replace(/^v/, ''));
  if (parsed === null) {
    return false;
  }
  if (parsed.prerelease.length === 0) {
    return false;
  }
  return !parsed.prerelease.includes('nightly');
}

/**
 * Finds the latest older prerelease tag with the same major.minor.patch base
 * version as the current tag. Only non-nightly prereleases are considered.
 * Returns null when the current tag is not a prerelease or when no eligible
 * predecessor exists.
 */
function latestPrerelease(
  tags: readonly TagInfo[],
  currentTag: string,
): string | null {
  if (!isPrereleaseTag(currentTag)) {
    return null;
  }
  const currentParsed = semver.parse(currentTag.replace(/^v/, ''));
  if (currentParsed === null) {
    return null;
  }
  const currentBase = `${currentParsed.major}.${currentParsed.minor}.${currentParsed.patch}`;
  const candidates = tags
    .filter((tag) => tag.name !== currentTag)
    .map((tag) => {
      const parsed = semver.parse(tag.name.replace(/^v/, ''));
      if (parsed === null || parsed.prerelease.length === 0) {
        return null;
      }
      if (parsed.prerelease.includes('nightly')) {
        return null;
      }
      const tagBase = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
      if (tagBase !== currentBase) {
        return null;
      }
      if (!semver.lt(parsed, currentParsed)) {
        return null;
      }
      return { name: tag.name, version: parsed };
    })
    .filter(
      (
        c,
      ): c is {
        name: string;
        version: semver.SemVer;
      } => c !== null,
    );
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((left, right) => semver.compare(right.version, left.version));
  return candidates[0]?.name ?? null;
}

/**
 * Selects the diff base tag. Nightly releases use authoritative publication
 * order when release metadata is available and local tag chronology only when
 * no metadata lookup was created. In metadata mode, incomplete or absent
 * releases are excluded rather than mixed with local timestamps.
 *
 * Non-nightly prereleases prefer the latest older prerelease with the same
 * base version. All release kinds fall back to the latest older stable tag.
 */
export function selectDiffBase(
  tags: readonly TagInfo[],
  currentTag: string,
  isNightly: boolean,
  releaseMetadata?: ReleaseMetadataLookup,
): string | null {
  if (isNightly) {
    return (
      latestNightly(tags, currentTag, releaseMetadata) ??
      latestStable(tags, currentTag)
    );
  }
  return latestPrerelease(tags, currentTag) ?? latestStable(tags, currentTag);
}
