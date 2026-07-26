/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ChangeEntry,
  GhPort,
  LlmPort,
  RawCommit,
  ReleaseNotesData,
  TopologyResolver,
} from './types.js';
import { buildChangeEntries } from './processing.js';
import {
  buildDeterministicFallback,
  entriesToCategorizedBullets,
  validateHighlights,
  validateLlmOutput,
} from './validation.js';
import { buildHighlightsFromSelection } from './provenance.js';
import { renderReleaseNotes } from './rendering.js';
import { sanitizeSubject } from './markdown.js';

export interface GenerateReleaseNotesInput {
  readonly releaseTag: string;
  readonly lastTag: string;
  readonly isFirstRelease: boolean;
  readonly isNightly: boolean;
  readonly rawCommits: readonly RawCommit[];
  readonly contributors: readonly string[];
  readonly ghPort: GhPort;
  readonly llmPort: LlmPort;
  readonly curatedHeadline: string | null;
  readonly repository?: string;
  readonly topologyResolver?: TopologyResolver;
}

/**
 * Validates that a value is a plausible Git commit hash: 7–40 hex characters.
 * Anything else is treated as missing to prevent injection in "All Changes".
 */
const HASH_PATTERN = /^[0-9a-fA-F]{7,40}$/;

/**
 * Sanitizes a single raw commit into a safe "All Changes" bullet line.
 * The subject is sanitized as plain text and the hash is validated and
 * bounded; invalid hashes are omitted from the parenthetical.
 */
function formatCommitLine(commit: RawCommit): string {
  const subject = sanitizeSubject(commit.subject);
  const hashValid = HASH_PATTERN.test(commit.hash);
  return hashValid ? `- ${subject} (${commit.hash})` : `- ${subject}`;
}

function formatAllChanges(commits: readonly RawCommit[]): string[] {
  return commits.map(formatCommitLine);
}

const MAX_LLM_CONTEXT_BYTES = 64 * 1024;

type LlmContextChange = {
  readonly id: string;
  readonly category: ChangeEntry['category'];
  readonly title: string;
  readonly userImpact: string | null;
  readonly references: ReadonlyArray<{
    readonly number: number;
    readonly title: string;
    readonly labels: readonly string[];
  }>;
};

function toLlmContextChange(entry: ChangeEntry): LlmContextChange | null {
  const first = entry.sourceFacts[0];
  if (!entry.eligibleForHighlights || first === undefined) {
    return null;
  }
  return {
    id: entry.id,
    category: entry.category,
    title: first.title,
    userImpact: first.userImpact,
    references: entry.enriched.map((ref) => ({
      number: ref.number,
      title: ref.title.slice(0, 200),
      labels: ref.labels,
    })),
  };
}

function buildLlmContext(entries: readonly ChangeEntry[]): string {
  const candidates = entries
    .map(toLlmContextChange)
    .filter((change): change is LlmContextChange => change !== null);
  const changes: LlmContextChange[] = [];
  for (const change of candidates) {
    const candidate = JSON.stringify({ changes: [...changes, change] });
    if (Buffer.byteLength(candidate, 'utf8') <= MAX_LLM_CONTEXT_BYTES) {
      changes.push(change);
    }
  }
  return JSON.stringify({ changes });
}

async function generateHighlights(
  llmPort: LlmPort,
  entries: readonly ChangeEntry[],
): Promise<readonly string[] | null> {
  const eligibleEntries = entries.filter(
    (entry) => entry.eligibleForHighlights,
  );
  if (eligibleEntries.length === 0) {
    return [];
  }

  const entriesWithFacts = eligibleEntries.filter(
    (entry) => entry.sourceFacts.length > 0,
  );
  if (entriesWithFacts.length === 0) {
    return [];
  }

  const context = buildLlmContext(entries);
  if (context === '{"changes":[]}') {
    return null;
  }

  try {
    const parsed = validateLlmOutput(await llmPort.generateHighlights(context));
    if (parsed === null) {
      return null;
    }
    const validated = validateHighlights(parsed.sourceIds, eligibleEntries);
    if (validated === null) {
      return null;
    }
    return buildHighlightsFromSelection(validated, entriesWithFacts);
  } catch {
    console.warn(
      'LLM highlight selection failed; using deterministic release-note highlights.',
    );
    return null;
  }
}

/**
 * Validates the repository string as `owner/name` and builds a GitHub
 * compare URL. Returns null when the repository is missing or malformed
 * so the comparison section is omitted rather than rendering a broken URL.
 */
function buildComparisonUrl(
  repository: string | undefined,
  lastTag: string,
  releaseTag: string,
  isFirstRelease: boolean,
): string | null {
  if (isFirstRelease) {
    return null;
  }
  if (repository === undefined) {
    return null;
  }
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository)) {
    return null;
  }
  const safeRef = (ref: string): boolean =>
    /^[A-Za-z0-9._/-]+$/.test(ref) &&
    !ref.startsWith('/') &&
    !ref.endsWith('/') &&
    !ref.includes('//');
  if (!safeRef(lastTag) || !safeRef(releaseTag)) {
    return null;
  }
  return `https://github.com/${repository}/compare/${encodeURIComponent(lastTag)}...${encodeURIComponent(releaseTag)}`;
}

export async function generateReleaseNotes(
  input: GenerateReleaseNotesInput,
): Promise<string> {
  const entries = await buildChangeEntries(
    input.rawCommits,
    input.ghPort,
    input.topologyResolver,
  );
  const generatedHighlights = await generateHighlights(input.llmPort, entries);
  const fallback = buildDeterministicFallback(entries);
  const highlights = generatedHighlights ?? fallback.highlights;
  const comparisonUrl = buildComparisonUrl(
    input.repository,
    input.lastTag,
    input.releaseTag,
    input.isFirstRelease,
  );
  const data: ReleaseNotesData = {
    releaseTag: input.releaseTag,
    highlights,
    categorized: entriesToCategorizedBullets(entries),
    allChanges: formatAllChanges(input.rawCommits),
    contributors: input.contributors,
    lastTag: input.lastTag,
    isFirstRelease: input.isFirstRelease,
    comparisonUrl,
    curatedHeadline: input.isNightly ? null : input.curatedHeadline,
  };
  return renderReleaseNotes(data);
}
