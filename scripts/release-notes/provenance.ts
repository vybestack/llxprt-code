/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChangeEntry, SourceFact } from './types.js';
import { sanitizeMarkdown } from './markdown.js';

/**
 * Regular-expression patterns for lines that are structural boilerplate rather
 * than user-impact prose: Markdown headings, closing keywords, and
 * issue/PR template section labels. Each is matched case-insensitively at the
 * start of a trimmed raw line (before markdown stripping).
 */
const BOILERPLATE_LINE_PATTERNS: readonly RegExp[] = [
  /^#+\s+/i,
  /^\s*(summary|description|motivation|context|background)\b\s*:?\s*/i,
  /^\s*(what|why|how|steps to reproduce|reproduction|expected|actual)\b\s*:?\s*/i,
  /^\s*(checklist|checkbox|verification|verified|testing|test plan|implementation)\b\s*:?\s*/i,
  /^\s*(checklist for submitter|submitter checklist|reviewer checklist)\b\s*:?\s*/i,
  /^\s*(clos(?:e|es|ed)|fix(?:e|es|ed)|resolv(?:e|es|ed)|address(?:e|es|ed))\s+#\d+/i,
  /^\s*(fixes|closes|resolves)\s+https?:\/\//i,
  /^\s*(\[[ x]\])\s*/i,
  /^\s*\d+\.\s*/i,
  /^\s*[-*]\s+/i,
];

/**
 * Section headings that introduce provenance/test/verification boilerplate.
 * These sections must be suppressed until another heading — blank lines do
 * NOT end them, because their content is never user-impact prose.
 */
const HARD_SUPPRESS_SECTION_HEADINGS: readonly RegExp[] = [
  /^#+\s*(checklist|checkbox|verification|verified|testing|test plan|reproduction|implementation)\b/i,
  /^#+\s*(checklist for submitter|submitter checklist|reviewer checklist)\b/i,
  /^#+\s*(how|steps to reproduce)\b/i,
];

/**
 * Section headings that introduce template boilerplate (Summary, Description,
 * Motivation, etc.). These are skipped as headings but their body content
 * can still contain defensible prose after a blank line — the heading itself
 * and immediately-following boilerplate lines (like Fixes #N) are skipped.
 */
const SOFT_BOILERPLATE_HEADINGS: readonly RegExp[] = [
  /^#+\s*(summary|description|motivation|context|background)\b/i,
];

const CAPABILITY_SIGNALS: readonly string[] = [
  'can now',
  'can use',
  'can configure',
  'can select',
  'can run',
  'can specify',
  'can access',
  'can create',
  'can manage',
  'can view',
  'can export',
  'can import',
  'can pin',
  'allows',
  'lets',
  'adds support',
  'add support',
  'supports',
  'support for',
  'ability to',
  'will see',
  'will receive',
  'will get',
  'new command',
  'new option',
  'new setting',
  'new capability',
];

const DIRECTIONAL_IMPACT_SIGNALS: readonly string[] = [
  'no longer',
  'crash-free',
  'now receive',
  'now get',
  'now see',
  'now have',
  'faster',
  'safer',
  'simpler',
  'easier',
  'cleaner',
  'clearer',
  'better',
  'enhances',
  'improves',
  'improved',
  'prevents',
  'restores',
  'reduces',
  'removes the need',
  'benefit',
  'lower latency',
  'more reliable',
];

/**
 * Returns true for ANY Markdown heading line.
 */
function isHeading(rawLine: string): boolean {
  return /^#+\s+/.test(rawLine);
}

function isHardSuppressSection(rawLine: string): boolean {
  return HARD_SUPPRESS_SECTION_HEADINGS.some((pattern) =>
    pattern.test(rawLine),
  );
}

function isSoftBoilerplateHeading(rawLine: string): boolean {
  return SOFT_BOILERPLATE_HEADINGS.some((pattern) => pattern.test(rawLine));
}

/**
 * Returns true when a raw (unmodified) line is a standalone boilerplate marker
 * — a heading, closing keyword, checklist item, or list item — rather than
 * user-impact prose.
 */
function isBoilerplateLine(rawLine: string): boolean {
  return BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(rawLine));
}

/**
 * Extracts a defensible user impact statement from an enriched ref body.
 * The impact must be a non-empty, plain-text sentence that does not contain
 * mechanism-only language, template boilerplate, or closing-keyword noise.
 *
 * The body is split into lines. Lines under a hard-suppress section heading
 * (Verification, Checklist, Reproduction, Implementation, etc.) are skipped
 * until the next heading — blank lines do NOT end a hard-suppress section.
 * Lines under a soft-boilerplate heading (Summary, Description) are skipped
 * only as headings and immediately-following boilerplate; content after a
 * blank line can be selected. Code blocks are removed entirely. The first
 * remaining prose line that forms a complete sentence (ending in `.`, `!`,
 * or `?`) or is long enough to be meaningful is used. Returns null when no
 * defensible impact can be established.
 */
interface ImpactScanState {
  inHardSuppressSection: boolean;
  activeFence: FenceMarker | null;
}

/**
 * Describes an active fenced code block: the fence character (backtick or
 * tilde) and the opening fence length. A closing fence must use the same
 * character with at least this many markers.
 */
type FenceMarker = { readonly char: '`' | '~'; readonly length: number };

/**
 * Matches the opening fence of a line: up to three spaces of indentation
 * (per CommonMark), then three or more backticks or tildes. The info
 * string after the fence characters is irrelevant for block detection.
 */
const MARKDOWN_CONTAINER_RE = /^(?: {0,3}> ?| {0,3}(?:[-+*]|\d+[.)]) +)/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

function stripMarkdownContainers(rawLine: string): string {
  let line = rawLine;
  let previous: string;
  do {
    previous = line;
    line = line.replace(MARKDOWN_CONTAINER_RE, '');
  } while (line !== previous);
  return line;
}

function parseFenceOpen(rawLine: string): FenceMarker | null {
  const match = FENCE_OPEN_RE.exec(stripMarkdownContainers(rawLine));
  if (match === null) {
    return null;
  }
  const seq = match[1]!;
  const char = seq[0];
  if (char !== '`' && char !== '~') {
    return null;
  }
  return { char, length: seq.length };
}

/**
 * Returns true when a line closes the currently active fence. Per CommonMark,
 * the closing fence may be indented up to three spaces, must use the same
 * character as the opening fence, must have at least as many markers, and
 * may only contain trailing whitespace after the fence characters.
 */
function isFenceClose(rawLine: string, active: FenceMarker): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(
    stripMarkdownContainers(rawLine),
  );
  if (match === null) {
    return false;
  }
  const seq = match[1]!;
  return seq[0] === active.char && seq.length >= active.length;
}

function impactCandidate(
  rawLine: string,
  state: ImpactScanState,
): string | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // Any heading resets hard-suppress state.
  if (isHeading(trimmed)) {
    state.inHardSuppressSection = false;
  }
  // A hard-suppress heading starts the suppression until another heading.
  if (isHardSuppressSection(trimmed)) {
    state.inHardSuppressSection = true;
    return null;
  }
  if (state.inHardSuppressSection) {
    return null;
  }
  // A soft-boilerplate heading is skipped as a heading, but does not
  // suppress content below it.
  if (isSoftBoilerplateHeading(trimmed)) {
    return null;
  }
  if (isBoilerplateLine(trimmed)) {
    return null;
  }
  const line = rawLine
    .replace(/[#>*_`~[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sentenceEnd = line.search(/[.!?](?:\s|$)/);
  const sentence = sentenceEnd === -1 ? line : line.slice(0, sentenceEnd + 1);
  const bounded = sentence.slice(0, 240).trim();
  if (bounded.length < 10 || isMechanismOnly(bounded)) {
    return null;
  }
  return sanitizeMarkdown(bounded);
}

function extractUserImpact(body: string): string | null {
  const state: ImpactScanState = {
    inHardSuppressSection: false,
    activeFence: null,
  };
  for (const rawLine of body.split('\n')) {
    const candidate = scanLine(rawLine, state);
    if (candidate !== null) {
      return candidate;
    }
  }
  return null;
}

/**
 * Processes a single body line for user-impact extraction. Returns a
 * candidate impact string when found, or null to continue scanning.
 * Manages fenced-code-block state: lines inside an open fence are skipped
 * (with potential close detection), and opening fence lines enter the
 * fenced state.
 */
function scanLine(rawLine: string, state: ImpactScanState): string | null {
  if (state.activeFence !== null) {
    if (isFenceClose(rawLine, state.activeFence)) {
      state.activeFence = null;
    }
    return null;
  }
  const fenceOpen = parseFenceOpen(rawLine);
  if (fenceOpen !== null) {
    state.activeFence = fenceOpen;
    return null;
  }
  return impactCandidate(rawLine, state);
}

/**
 * Determines whether an impact sentence has a defensible user-facing
 * subject: an explicit user actor (users, developers), a user capability
 * ("can now", "allows", "ability to"), or an observable outcome ("faster",
 * "fixes", "no longer"). Weak signals alone ("new", "option",
 * "configuration", "cli") are NOT sufficient — they describe what changed
 * but not who benefits or what the user observes.
 *
 * Matching uses word boundaries to prevent substring collisions: "fix" must
 * not match "prefix", "new" must not match "renew", "option" must not match
 * "optional", "user" must not match "username", etc.
 */
function hasUserImpactSignal(impact: string): boolean {
  const lower = impact.toLowerCase();
  const capabilityStatement = /\bcan (?:now )?[a-z]+\b/.test(lower);
  const negativeCapability =
    /\bcan (?:now )?(?:crash|fail|hang|stall|lose|break|corrupt)\b/.test(lower);
  const concreteFix =
    /\bfix(?:es|ed)?\b/.test(lower) &&
    /\b(?:crash|hang|memory leak|data loss|startup failure|login failure)s?\b/.test(
      lower,
    );
  const explicitCapability = CAPABILITY_SIGNALS.some((signal) =>
    containsWordOrPhrase(lower, signal),
  );
  const explicitActor =
    /\b(?:users?|customers?|developers?|operators?|administrators?|you)\b/.test(
      lower,
    );
  const actorCapability =
    explicitActor &&
    (explicitCapability || (capabilityStatement && !negativeCapability));
  const directionalImpact = DIRECTIONAL_IMPACT_SIGNALS.some((signal) =>
    containsWordOrPhrase(lower, signal),
  );
  const observableSubject =
    explicitActor ||
    /\b(?:startup|commands?|sessions?|errors?|output|responses?|requests?|inputs?|files?|messages?|authentication|login|memory|latency|performance|stability|reliability|workflows?|compatibility)\b/.test(
      lower,
    );
  return [
    actorCapability,
    concreteFix,
    directionalImpact && observableSubject,
  ].some(Boolean);
}

/**
 * Heuristic: determines whether an impact sentence is mechanism-only (internal
 * refactoring, test, CI, build, implementation detail) rather than
 * user-facing. Returns true when the sentence describes internal mechanics
 * with no user benefit. A sentence is mechanism-only when it contains a
 * mechanism phrase, OR when it lacks any positive user-facing signal.
 *
 * Matching uses word/phrase boundaries to prevent substring collisions.
 */
function isMechanismOnly(impact: string): boolean {
  if (!hasUserImpactSignal(impact)) {
    return true;
  }
  const lower = impact.toLowerCase();
  const describesMaintenanceMechanism =
    /\b(?:internal|state machine|refactor|ci|build|tests?|test harness|code quality|release process|dependencies|dependency update)\b/.test(
      lower,
    );
  const observableResolution =
    /\b(?:prevents?|fix(?:es|ed)?|no longer|restores?)\b/.test(lower) &&
    /\b(?:startup|crash|failure|data loss|memory leak|login|errors?)s?\b/.test(
      lower,
    );
  if (describesMaintenanceMechanism && !observableResolution) {
    return true;
  }
  const normalized = lower.replace(/[-/]/g, ' ');
  const describesProductMechanism =
    /\b(?:parser|registry|adapter layer)\b/.test(normalized);
  const identifiesBeneficiary =
    /\b(?:users?|customers?|developers?|operators?|administrators?|you)\b/.test(
      lower,
    );
  return describesProductMechanism && !identifiesBeneficiary;
}

/**
 * Matches a word or phrase at word boundaries within a lowercased string.
 * For single-word signals, uses `\b` boundaries to prevent substring
 * collisions (e.g. "fix" must not match "prefix", "new" must not match
 * "renew", "option" must not match "optional", "user" must not match
 * "username"). For multi-word phrases, the phrase is matched as a
 * contiguous sequence of words with boundaries on both ends.
 */
function containsWordOrPhrase(text: string, signal: string): boolean {
  const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\b`);
  return pattern.test(text);
}

/**
 * Extracts validated SourceFacts from an enriched change entry. Each fact
 * carries a defensible user impact statement derived from the enriched issue
 * or PR body — never from free-form prose. Returns an empty array when no
 * defensible impact can be established.
 */
type SourceFactInput = Pick<ChangeEntry, 'id' | 'enriched' | 'category'>;

export function extractSourceFacts(
  entry: SourceFactInput,
): readonly SourceFact[] {
  const facts: SourceFact[] = [];
  for (const ref of entry.enriched) {
    const impact = extractUserImpact(ref.body);
    if (impact === null || isMechanismOnly(impact)) {
      continue;
    }
    const title = sanitizeMarkdown(ref.title);
    facts.push(
      Object.freeze({
        sourceId: entry.id,
        title: isMechanismOnly(title) ? '' : title,
        category: entry.category,
        userImpact: impact,
        evidence: `Issue/PR #${ref.number}: ${sanitizeMarkdown(ref.title)}`,
      }),
    );
  }
  return Object.freeze(facts);
}

/**
 * Constructs deterministic highlight text from validated source facts. The
 * model selects eligible source IDs; this function builds the final text
 * from the facts bound to those IDs — untrusted prose cannot inject
 * arbitrary Markdown or claims.
 *
 * Returns 3–6 highlights when at least 3 defensible eligible impacts exist.
 * Returns fewer (or none) when impact cannot be established, rather than
 * inventing claims.
 */
export function buildHighlightsFromSelection(
  selection: readonly string[],
  entries: readonly ChangeEntry[],
): readonly string[] {
  const factsById = new Map<string, readonly SourceFact[]>();
  for (const entry of entries) {
    if (entry.eligibleForHighlights && entry.sourceFacts.length > 0) {
      factsById.set(entry.id, entry.sourceFacts);
    }
  }

  const highlights: string[] = [];
  const seen = new Set<string>();
  for (const sourceId of selection) {
    if (seen.has(sourceId)) {
      continue;
    }
    const facts = factsById.get(sourceId);
    if (facts !== undefined && facts.length > 0) {
      const first = facts[0];
      if (first !== undefined) {
        appendHighlight(sourceId, first, highlights, seen);
      }
    }
  }

  return highlights;
}

/**
 * Builds the deterministic fallback highlights from validated source facts.
 * Returns 3–6 when at least 3 defensible impacts exist; fewer or none
 * otherwise.
 */
export function buildFallbackHighlights(
  entries: readonly ChangeEntry[],
): readonly string[] {
  const allHighlights: string[] = [];
  for (const entry of entries) {
    if (!entry.eligibleForHighlights) {
      continue;
    }
    const first = entry.sourceFacts[0];
    if (first !== undefined) {
      appendFallbackHighlight(first, allHighlights);
    }
  }
  return allHighlights.slice(0, 6);
}

/**
 * Appends a sanitized deterministic highlight from a validated SourceFact.
 * The fact's title and user impact are combined as "{title}: {userImpact}"
 * and sanitized; empty results are skipped.
 */
function sourceFactText(fact: SourceFact): string {
  return fact.title.length > 0
    ? `${fact.title}: ${fact.userImpact}`
    : fact.userImpact;
}

function appendFallbackHighlight(fact: SourceFact, highlights: string[]): void {
  const sanitized = sanitizeMarkdown(sourceFactText(fact));
  if (sanitized.length > 0) {
    highlights.push(sanitized);
  }
}

/**
 * Appends a sanitized deterministic highlight from a validated SourceFact,
 * also marking the sourceId as seen to prevent duplicates.
 */
function appendHighlight(
  sourceId: string,
  fact: SourceFact,
  highlights: string[],
  seen: Set<string>,
): void {
  const sanitized = sanitizeMarkdown(sourceFactText(fact));
  if (sanitized.length > 0) {
    highlights.push(sanitized);
    seen.add(sourceId);
  }
}

/**
 * Validates that the model's source ID selection contains only eligible
 * source IDs with defensible impact. Returns the validated selection, or
 * null when the selection is invalid.
 */
export function validateSelection(
  selection: readonly string[],
  entries: readonly ChangeEntry[],
): readonly string[] | null {
  const eligibleIds = new Set(
    entries
      .filter(
        (entry) => entry.eligibleForHighlights && entry.sourceFacts.length > 0,
      )
      .map((entry) => entry.id),
  );

  const seen = new Set<string>();
  for (const id of selection) {
    if (!eligibleIds.has(id) || seen.has(id)) {
      return null;
    }
    seen.add(id);
  }

  const maxHighlights = Math.min(6, eligibleIds.size);
  if (selection.length < Math.min(3, eligibleIds.size)) {
    return null;
  }
  if (selection.length > maxHighlights) {
    return null;
  }

  return selection;
}
