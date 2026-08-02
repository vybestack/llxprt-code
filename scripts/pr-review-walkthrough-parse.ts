/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure parsing, rendering, and magnitude logic extracted from
 * pr-review-walkthrough.ts to satisfy the 800-line file-size limit.
 * No public API surface beyond what the walkthrough module already exports.
 */

import { TRIAGE_TAGS } from './pr-review-prompts.ts';

const COMMENT_TAG = '<!-- llxprt-walkthrough -->';
const PLANNER_ISSUE = '#2256';
const MAGNITUDE_LABELS = ['S', 'M', 'L', 'XL', 'XXL'];
const RUNTIME_LAYERS = new Set([
  'api',
  'core',
  'ui',
  'server',
  'provider',
  'client',
  'service',
  'controller',
  'router',
]);

const MAX_SUMMARY_WORDS = 100;
const SUMMARY_HARD_LIMIT = 150;

// ---------------------------------------------------------------------------
// JSON extraction / parsers (pure)
// ---------------------------------------------------------------------------

function describeJsonValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertJsonObject(
  value: unknown,
  source: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(
      `${source}: expected JSON object but got ${describeJsonValue(value)}`,
    );
  }
  return value;
}

export function extractJsonObject(rawText: unknown): Record<string, unknown> {
  const text = String(rawText ?? '').trim();
  if (text === '') {
    throw new Error('Empty response: cannot parse JSON');
  }
  const direct = tryParseJson(text);
  if (direct.ok) {
    return assertJsonObject(direct.value, 'Direct parse');
  }
  const fenceMatch = text.match(/```(?:json)?[^\S\n]*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    const fenced = tryParseJson(fenceMatch[1].trim());
    if (fenced.ok) {
      return assertJsonObject(fenced.value, 'Fenced JSON parse');
    }
  }
  for (const candidate of findBalancedObjects(text)) {
    const parsed = tryParseJson(candidate);
    if (parsed.ok) {
      return assertJsonObject(parsed.value, 'Balanced-object parse');
    }
  }
  throw new Error('Cannot parse JSON from response');
}

function findBalancedObjects(text: string): string[] {
  const candidates = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') {
      continue;
    }
    const end = findBalancedObjectEnd(text, start);
    if (end !== -1) {
      candidates.push(text.slice(start, end + 1));
      start = end;
    }
  }
  return candidates;
}

function findBalancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function tryParseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function parseMapResponse(rawText: string): {
  summary: string;
  signature: string;
  triage: string;
} {
  const parsed = extractJsonObject(rawText);
  const summary = parsed.summary;
  const triageRaw = parsed.triage;
  if (typeof summary !== 'string' || typeof triageRaw !== 'string') {
    throw new Error('Invalid map response: missing summary or triage');
  }
  const triage = TRIAGE_TAGS.includes(triageRaw) ? triageRaw : 'chore';
  return {
    summary: truncateSummary(summary),
    signature: String(parsed.signature ?? ''),
    triage,
  };
}

function truncateSummary(summary: string): string {
  const words = summary.trim().split(/\s+/);
  if (words.length > SUMMARY_HARD_LIMIT) {
    return words.slice(0, MAX_SUMMARY_WORDS).join(' ') + '...';
  }
  return summary;
}

export function parseGroupResponse(rawText: string): { themes: GroupTheme[] } {
  const parsed = extractJsonObject(rawText);
  if (!Array.isArray(parsed.themes)) {
    throw new Error('Invalid group response: themes is not an array');
  }
  return { themes: validateGroupThemes(parsed.themes) };
}

export interface GroupTheme {
  layer: string;
  summary: string;
  files: string[];
}

/**
 * Validate that each theme has layer (string), files (array of strings),
 * and summary (string). Drop themes that are structurally invalid.
 */
export function validateGroupThemes(themes: unknown): GroupTheme[] {
  if (!Array.isArray(themes)) {
    return [];
  }
  return themes
    .filter((t): t is Record<string, unknown> => isRecord(t))
    .flatMap((t): GroupTheme[] => {
      const layer = t.layer;
      const summary = t.summary;
      const files = t.files;
      if (typeof layer !== 'string' || typeof summary !== 'string') {
        return [];
      }
      return [
        {
          layer,
          summary,
          files: Array.isArray(files)
            ? files.filter((f: unknown) => typeof f === 'string')
            : [],
        },
      ];
    });
}

// ---------------------------------------------------------------------------
// Renderer (pure)
// ---------------------------------------------------------------------------

export interface WalkthroughCommentParams {
  releaseNotes?: string;
  walkthrough?: string;
  themes?: unknown[];
  sequenceDiagram?: string;
  magnitude?: { score: number; label: string; basis: string };
  related?: string;
  preMergeChecks?: unknown;
}

export function renderWalkthroughComment({
  releaseNotes,
  walkthrough,
  themes,
  sequenceDiagram,
  magnitude,
  related,
  preMergeChecks,
}: WalkthroughCommentParams): string {
  const validThemes = validateGroupThemes(themes ?? []);
  const sections = [COMMENT_TAG, '# Walkthrough', walkthrough || ''];
  if (releaseNotes) {
    sections.push(releaseNotes);
  }
  sections.push(renderChangesTable(validThemes));
  if (sequenceDiagram) {
    sections.push(`## Sequence Diagram\n${sequenceDiagram}`);
  }
  if (magnitude) {
    sections.push(renderMagnitudeSection(magnitude));
  }
  sections.push(renderRelatedSection(related ?? ''));
  sections.push(renderPreMergeChecks(preMergeChecks));
  sections.push(renderFooter());
  return sections.filter((section) => section !== '').join('\n\n');
}

function renderRelatedSection(related: string) {
  const content = typeof related === 'string' ? related.trim() : '';
  return content
    ? `## Related\n${content}`
    : '## Related\nNo related items found.';
}

function renderChangesTable(themes: GroupTheme[]): string {
  if (!themes || themes.length === 0) {
    return '';
  }
  const header = '| Layer | File(s) | Summary |\n| --- | --- | --- |';
  const rows = themes.map((t) => {
    const layer = escapeMarkdownTableCell(t.layer);
    const files =
      t.files && t.files.length > 0
        ? t.files.map((f) => escapeMarkdownTableCell(f)).join(', ')
        : '(none)';
    const summary = escapeMarkdownTableCell(t.summary);
    return `| ${layer} | ${files} | ${summary} |`;
  });
  return `## Changes\n${header}\n${rows.join('\n')}`;
}

/**
 * Escape a string for safe interpolation into a markdown table cell.
 * Escapes backslash, pipe, and replaces newlines with <br>.
 */
export function escapeMarkdownTableCell(text: unknown): string {
  const value = text == null ? '' : String(text);
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n/g, '<br>')
    .replace(/\n/g, '<br>')
    .replace(/\r/g, '<br>');
}

function renderMagnitudeSection(magnitude: {
  score: number;
  label: string;
  basis: string;
}): string {
  return `## Magnitude\n\u{1F3AF} ${magnitude.score} (${magnitude.label})\n${magnitude.basis}`;
}

function renderPreMergeChecks(checks: unknown): string {
  if (!isRecord(checks)) {
    return '';
  }
  const c: Record<string, Record<string, unknown> | undefined> = {};
  for (const [key, value] of Object.entries(checks)) {
    c[key] = isRecord(value) ? value : undefined;
  }
  const ok = '\u2705';
  const no = '\u274C';
  const esc = escapeMarkdownTableCell;
  const rows = [
    '| Check | Status | Note |',
    '| --- | --- | --- |',
    `| Title | ${c.title?.ok ? ok : no} | ${esc(c.title?.note)} |`,
    `| Description | ${c.description?.ok ? ok : no} | ${esc(c.description?.note)} |`,
    `| Linked Issues | ${c.linked_issues?.ok ? ok : no} | ${esc(c.linked_issues?.note)} |`,
    `| Out of Scope | \u2014 | ${esc(c.out_of_scope?.note)} |`,
  ];
  return `## Pre-merge Checks\n${rows.join('\n')}`;
}

function renderFooter() {
  return `---\n\nWalkthrough generated by LLxprt PR Review. Planner issue: ${PLANNER_ISSUE}`;
}

// ---------------------------------------------------------------------------
// Magnitude (pure, deterministic)
// ---------------------------------------------------------------------------

export function computeMagnitude({
  additions,
  deletions,
  changedFiles,
  packageCount,
  criteriaCount,
}: {
  additions: number;
  deletions: number;
  changedFiles: number;
  packageCount: number;
  criteriaCount: number;
}): { score: number; label: string; basis: string } {
  const totalLoc = additions + deletions;
  const rawScore =
    Math.min(totalLoc / 500, 5) * 0.3 +
    Math.min(changedFiles / 5, 5) * 0.3 +
    Math.min(packageCount, 5) * 0.2 +
    Math.min(criteriaCount, 5) * 0.2;
  const score = Math.max(1, Math.min(5, Math.round(rawScore)));
  const label = MAGNITUDE_LABELS[score - 1];
  const basis = formatMagnitudeBasis(
    additions,
    deletions,
    changedFiles,
    packageCount,
    criteriaCount,
  );
  return { score, label, basis };
}

function formatMagnitudeBasis(
  additions: number,
  deletions: number,
  changedFiles: number,
  packageCount: number,
  criteriaCount: number,
): string {
  const pkgWord = packageCount === 1 ? 'package' : 'packages';
  const critWord = criteriaCount === 1 ? 'criterion' : 'criteria';
  return `${additions} additions, ${deletions} deletions, ${changedFiles} changed files across ${packageCount} ${pkgWord}, ${criteriaCount} acceptance ${critWord}`;
}

// ---------------------------------------------------------------------------
// Sequence diagram gate (pure heuristic)
// ---------------------------------------------------------------------------

export function gateSequenceDiagram(
  themes: GroupTheme[],
  changedFiles: string[],
): boolean {
  const packages = new Set(
    changedFiles
      .filter((f: string) => f.startsWith('packages/'))
      .map((f: string) => f.split('/')[1]),
  );
  if (packages.size > 1) {
    return true;
  }
  const runtimeLayerCount = themes.filter((t) =>
    RUNTIME_LAYERS.has(String(t.layer).toLowerCase()),
  ).length;
  return runtimeLayerCount >= 2;
}

/**
 * Re-encode every bare `;` in a Mermaid message as the `#59;` entity so the
 * statement separator cannot break rendering. Existing entity escapes
 * (`#59;`, `#9829;`, `&copy;`) are left intact — only a `;` that does not
 * terminate such an entity is escaped. Scanned left-to-right in linear time to
 * avoid regex backtracking on adversarial input.
 */
function escapeBareSemicolons(message: string): string {
  const parts: string[] = [];
  for (let i = 0; i < message.length; i++) {
    const char = message.charAt(i);
    if (char === ';') {
      parts.push(terminatesMermaidEntity(message, i) ? ';' : '#59;');
    } else {
      parts.push(char);
    }
  }
  return parts.join('');
}

/**
 * True when the `;` at `index` closes a Mermaid entity escape, i.e. it is
 * preceded by `#` or `&` and one or more entity-body characters.
 */
function terminatesMermaidEntity(text: string, index: number): boolean {
  let j = index - 1;
  while (j >= 0 && /[a-zA-Z0-9]/.test(text.charAt(j))) {
    j--;
  }
  if (j === index - 1 || j < 0) {
    return false;
  }
  const sigil = text.charAt(j);
  return sigil === '#' || sigil === '&';
}

/**
 * True when `prefix` (the slice of a line up to and including the first colon)
 * contains a Mermaid sequence arrow: a `-` immediately followed by `>`, `x`, or
 * `)`. Scanned left-to-right in linear time to avoid regex backtracking.
 */
function isInteractionPrefix(prefix: string): boolean {
  for (let i = 0; i < prefix.length; i++) {
    if (prefix.charAt(i) !== '-') {
      continue;
    }
    const next = prefix.charAt(i + 1);
    if (next === '>' || next === 'x' || next === ')') {
      return true;
    }
  }
  return false;
}

/**
 * True when `line` is a Mermaid `Note` directive (`Note over`, `Note left of`,
 * ...), recognized by the trimmed line starting with the word `Note` followed by
 * whitespace. Case-insensitive.
 */
function isNoteLine(line: string): boolean {
  const trimmed = line.trimStart().toLowerCase();
  if (!trimmed.startsWith('note')) {
    return false;
  }
  const after = trimmed.charAt(4);
  return after === ' ' || after === '	';
}

/**
 * Mermaid sequence-diagram block headers whose trailing free-text description can
 * contain a bare `;`. Keyword matching is case-insensitive.
 */
const BLOCK_HEADER_KEYWORDS = [
  'loop',
  'alt',
  'opt',
  'par',
  'and',
  'else',
  'critical',
  'option',
  'break',
  'rect',
];

/**
 * Escape a bare `;` in the description of a Mermaid block-header line
 * (`loop desc`, `alt desc`, ...). Lines that are not such a header are returned
 * unchanged. The keyword (any case) and leading indentation are preserved; only
 * the trailing description is re-encoded.
 */
function escapeBlockHeaderSemicolons(line: string): string {
  const keywordStart = line.length - line.trimStart().length;
  const rest = line.slice(keywordStart);
  const lower = rest.toLowerCase();
  for (const keyword of BLOCK_HEADER_KEYWORDS) {
    if (!lower.startsWith(keyword)) {
      continue;
    }
    const after = rest.charAt(keyword.length);
    if (after === ' ' || after === '	') {
      const keywordPart = rest.slice(0, keyword.length);
      const description = rest.slice(keyword.length);
      return (
        line.slice(0, keywordStart) +
        keywordPart +
        escapeBareSemicolons(description)
      );
    }
  }
  return line;
}

/**
 * Sanitize an LLM-generated Mermaid sequence diagram so a reserved character in
 * a message label cannot break GitHub rendering. Mermaid treats `;` as a
 * statement separator, so a label such as `A->>B: foo; bar` parses as two
 * statements and fails to render. Mermaid's supported way to embed a literal
 * semicolon in message text is the `#59;` entity, so each bare `;` in a message
 * or Note label is re-encoded as `#59;` while existing entity escapes
 * (`#9829;`, `&copy;`, ...) are preserved. Message (arrow) and `Note` labels
 * and block-header descriptions (`loop`/`alt`/...) are rewritten; inline
 * participant configuration and other structure lines are left untouched. Anything that is not a `sequenceDiagram` is dropped
 * (returns '') rather than publishing markup that will not render.
 */
export function sanitizeSequenceDiagram(diagram: string): string {
  const trimmed = diagram.trim();
  if (trimmed === '') {
    return '';
  }
  const fenceMatch = trimmed.match(
    /^```(?:mermaid)?[^\S\n]*\n([\s\S]*?)\n```[^\S\n]*$/,
  );
  const inner = fenceMatch ? fenceMatch[1] : trimmed;
  const directive = 'sequenceDiagram';
  const isSequenceDiagram = inner.split('\n').some((line) => {
    const stripped = line.trim();
    if (!stripped.startsWith(directive)) {
      return false;
    }
    const next = stripped[directive.length];
    return next === undefined || /\s/.test(next);
  });
  if (!isSequenceDiagram) {
    return '';
  }
  const sanitized = inner
    .split('\n')
    .map((line) => {
      const blockEscaped = escapeBlockHeaderSemicolons(line);
      if (blockEscaped !== line) {
        // Block-header lines (loop/alt/opt/par/...) carry a free-text
        // description that may contain a colon, so they are handled before the
        // message (arrow) branch; a bare `;` there breaks rendering too.
        return blockEscaped;
      }
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) {
        return line;
      }
      const prefix = line.slice(0, colonIndex + 1);
      // Only message text (arrow interactions) and Note lines can carry the
      // statement separator; inline participant config and other colon-bearing
      // structure lines are preserved verbatim.
      const isMessage = isInteractionPrefix(prefix) || isNoteLine(line);
      if (!isMessage) {
        return line;
      }
      const message = escapeBareSemicolons(line.slice(colonIndex + 1));
      return prefix + message;
    })
    .join('\n');
  return '```mermaid\n' + sanitized + '\n```';
}
