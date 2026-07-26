/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CategorizedBullets, ReleaseNotesData } from './types.js';
import {
  renderContributor,
  sanitizeAllChangesLine,
  sanitizeMarkdown,
} from './markdown.js';

/**
 * Pattern matching an @mention at the start of a word boundary. GitHub
 * renders `@user` and `@org/team` as mention links in rendered Markdown.
 * Untrusted prose (PR titles, bodies, commit subjects) must not carry live
 * mentions into the rendered release notes.
 */
const MENTION_PATTERN = /@[A-Za-z0-9](?:[A-Za-z0-9-]*)(?:\/[A-Za-z0-9._-]+)?/g;

function isAsciiAlphanumeric(code: number): boolean {
  if (code >= 48 && code <= 57) {
    return true;
  }
  if (code >= 65 && code <= 90) {
    return true;
  }
  return code >= 97 && code <= 122;
}

function isEmailAt(text: string, atIndex: number): boolean {
  let start = atIndex;
  while (start > 0) {
    const character = text[start - 1];
    if (character === undefined || !/[A-Za-z0-9._%+-]/.test(character)) {
      break;
    }
    start -= 1;
  }
  let end = atIndex + 1;
  while (end < text.length) {
    const character = text[end];
    if (character === undefined || !/[A-Za-z0-9.-]/.test(character)) {
      break;
    }
    end += 1;
  }
  while (end > atIndex + 1 && text[end - 1] === '.') {
    end -= 1;
  }
  const local = text.slice(start, atIndex);
  const domain = text.slice(atIndex + 1, end);
  const localStartsWithAlphanumeric = isAsciiAlphanumeric(local.charCodeAt(0));
  const localEndsWithAlphanumeric = isAsciiAlphanumeric(
    local.charCodeAt(local.length - 1),
  );
  const domainStartsWithAlphanumeric = isAsciiAlphanumeric(
    domain.charCodeAt(0),
  );
  const domainEndsWithAlphanumeric = isAsciiAlphanumeric(
    domain.charCodeAt(domain.length - 1),
  );
  if (
    !localStartsWithAlphanumeric ||
    !localEndsWithAlphanumeric ||
    !domainStartsWithAlphanumeric ||
    !domainEndsWithAlphanumeric
  ) {
    return false;
  }
  if (local.includes('..') || domain.includes('..')) {
    return false;
  }
  return domain.includes('.') && !domain.endsWith('.');
}

/**
 * Neutralizes @mentions in untrusted prose by removing the @ sigil, so
 * GitHub does not render them as live mention links. This is applied to
 * all untrusted text channels (highlights, categorized bullets, all changes)
 * EXCEPT the contributor thanks section, which uses renderContributor for
 * validated, intentional @mentions.
 */
function neutralizeMentions(text: string): string {
  return text.replace(MENTION_PATTERN, (match, offset: number) =>
    isEmailAt(text, offset) ? match : match.slice(1),
  );
}

/**
 * Renders the static installation instructions block.
 */
function renderInstallation(): string {
  return [
    '### Installation',
    '',
    'Install or upgrade LLxprt Code using npm:',
    '',
    '```bash',
    'npm install -g @vybestack/llxprt-code',
    '```',
    '',
    'Or use directly with npx:',
    '',
    '```bash',
    'npx @vybestack/llxprt-code',
    '```',
    '',
  ].join('\n');
}

/**
 * Renders the curated headline section (if any) followed by highlights.
 * Highlights are sanitized to neutralize @mentions from untrusted prose.
 */
function renderHighlights(
  curated: string | null,
  highlights: readonly string[],
): string {
  const lines: string[] = [];
  if (curated !== null && curated.trim().length > 0) {
    lines.push(curated, '');
  }
  lines.push('### Highlights', '');
  if (highlights.length === 0) {
    lines.push('No major user-facing changes in this release.');
  } else {
    for (const item of highlights) {
      lines.push(`- ${neutralizeMentions(sanitizeMarkdown(item))}`);
    }
  }
  lines.push('');
  return lines.length > 0 ? lines.join('\n') : '';
}

/**
 * Renders a single categorized section, or empty string when the section
 * has no bullets. Each bullet is sanitized to neutralize @mentions that
 * could survive from untrusted prose.
 */
function renderCategorySection(
  heading: string,
  bullets: readonly string[],
): string {
  if (bullets.length === 0) {
    return '';
  }
  const lines = [heading, ''];
  for (const bullet of bullets) {
    lines.push(`- ${neutralizeMentions(sanitizeMarkdown(bullet))}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Renders all four categorized sections in order, skipping empties.
 */
function renderCategorized(categorized: CategorizedBullets): string {
  const sections = [
    renderCategorySection('#### New', categorized.new),
    renderCategorySection('#### Improvements', categorized.improvements),
    renderCategorySection('#### Fixes', categorized.fixes),
    renderCategorySection('#### Breaking changes', categorized.breaking),
  ];
  return sections.filter((s) => s.length > 0).join('');
}

/**
 * Renders the contributor thanks section using the safe renderContributor
 * helper, which validates the login grammar and sanitizes each handle.
 */
function renderThanks(contributors: readonly string[]): string {
  if (contributors.length === 0) {
    return '';
  }
  const lines = [
    '### Thanks',
    '',
    'Huge thanks to the following contributors for their pull requests in this release:',
    '',
  ];
  for (const contributor of contributors) {
    const rendered = renderContributor(contributor);
    if (rendered.length > 0) {
      lines.push(rendered);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Renders the All Changes section with raw commit lines. Each line is
 * sanitized to neutralize @mentions that could survive in commit subjects.
 */
function renderAllChanges(allChanges: readonly string[]): string {
  if (allChanges.length === 0) {
    return '';
  }
  const sanitized = allChanges
    .map((line) => neutralizeMentions(sanitizeAllChangesLine(line)))
    .filter((line) => line.length > 0);
  return ['### All Changes', '', ...sanitized].join('\n');
}

/**
 * Renders the comparison link footer. For first releases, renders a banner
 * noting that this is the initial release instead of a compare URL.
 */
function isSafeRefCharacter(character: string): boolean {
  const code = character.codePointAt(0);
  if (code === undefined) {
    return false;
  }
  const isDigit = code >= 48 && code <= 57;
  const isUppercase = code >= 65 && code <= 90;
  const isLowercase = code >= 97 && code <= 122;
  return isDigit || isUppercase || isLowercase || '._-/'.includes(character);
}

function hasSafeSlashPlacement(ref: string): boolean {
  return !ref.startsWith('/') && !ref.endsWith('/') && !ref.includes('//');
}

function isSafeRef(ref: string): boolean {
  return (
    ref.length > 0 &&
    hasSafeSlashPlacement(ref) &&
    [...ref].every(isSafeRefCharacter)
  );
}

function isSafeComparisonRange(range: string): boolean {
  const separator = range.indexOf('...');
  if (separator <= 0 || separator !== range.lastIndexOf('...')) {
    return false;
  }
  const from = range.slice(0, separator);
  const to = range.slice(separator + 3);
  return isSafeRef(from) && isSafeRef(to);
}

function isSafeComparisonUrl(comparisonUrl: string): boolean {
  try {
    const url = new URL(comparisonUrl);
    const parts = url.pathname.split('/').filter((part) => part.length > 0);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
      return false;
    }
    const encodedRange = parts[3];
    if (
      parts.length !== 4 ||
      parts[2] !== 'compare' ||
      encodedRange === undefined
    ) {
      return false;
    }
    return isSafeComparisonRange(decodeURIComponent(encodedRange));
  } catch {
    return false;
  }
}

function renderComparison(
  comparisonUrl: string | null,
  isFirstRelease: boolean,
): string {
  if (isFirstRelease) {
    return ['', '---', '', '*Initial release.*'].join('\n');
  }
  if (comparisonUrl === null || !isSafeComparisonUrl(comparisonUrl)) {
    return '';
  }
  return ['', '---', '', `**Full Changelog**: ${comparisonUrl}`].join('\n');
}

const MAX_RELEASE_BODY_BYTES = 120_000;
const OMITTED_CHANGES_NOTICE =
  '_Additional details omitted; use All Changes and the release history for traceability._';
const ALL_CHANGES_BUDGET_BYTES = 40_000;

function takeWholeLines(text: string, maxBytes: number): string {
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const candidate = [...lines, line].join('\n');
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) {
      break;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function fitReleaseBody(
  body: string,
  allChanges: string,
  comparison: string,
): string {
  const complete = [body, allChanges, comparison].filter(Boolean).join('\n');
  if (Buffer.byteLength(complete, 'utf8') + 1 <= MAX_RELEASE_BODY_BYTES) {
    return `${complete.trim()}\n`;
  }
  const boundedAllChanges = takeWholeLines(
    allChanges,
    ALL_CHANGES_BUDGET_BYTES,
  );
  const reserved = [OMITTED_CHANGES_NOTICE, boundedAllChanges, comparison]
    .filter(Boolean)
    .join('\n\n');
  const bodyBudget =
    MAX_RELEASE_BODY_BYTES - Buffer.byteLength(reserved, 'utf8') - 4;
  const boundedBody = takeWholeLines(body, bodyBudget);
  return `${[boundedBody, OMITTED_CHANGES_NOTICE, boundedAllChanges, comparison]
    .filter(Boolean)
    .join('\n\n')}\n`;
}

/**
 * Renders complete release notes markdown from structured data through a
 * deterministic template. The output order is always:
 * Release header, Installation, Curated headline/Highlights, categorized
 * sections, Thanks, All Changes, comparison link.
 */
export function renderReleaseNotes(data: ReleaseNotesData): string {
  const parts: string[] = [];

  parts.push(`## Release ${sanitizeMarkdown(data.releaseTag)}`, '');

  parts.push(renderInstallation());

  const highlightsSection = renderHighlights(
    data.curatedHeadline,
    data.highlights,
  );
  if (highlightsSection.length > 0) {
    parts.push(highlightsSection);
  }

  const categorizedSection = renderCategorized(data.categorized);
  if (categorizedSection.length > 0) {
    parts.push(categorizedSection);
  }

  const thanksSection = renderThanks(data.contributors);
  if (thanksSection.length > 0) {
    parts.push(thanksSection);
  }

  const allChangesSection = renderAllChanges(data.allChanges);
  const comparisonSection = renderComparison(
    data.comparisonUrl,
    data.isFirstRelease,
  );
  return fitReleaseBody(
    parts.join('\n').trim(),
    allChangesSection,
    comparisonSection,
  );
}
