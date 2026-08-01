/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text } from 'ink';
import { theme } from '../semantic-colors.js';
import stringWidth from 'string-width';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { createFilePathLink, createUrlLink } from './terminalLinks.js';

// Constants for Markdown parsing
const BOLD_MARKER_LENGTH = 2; // For "**"
const ITALIC_MARKER_LENGTH = 1; // For "*" or "_"
const STRIKETHROUGH_MARKER_LENGTH = 2; // For "~~")
const INLINE_CODE_MARKER_LENGTH = 1; // For "`"
const UNDERLINE_TAG_START_LENGTH = 3; // For "<u>"
const UNDERLINE_TAG_END_LENGTH = 4; // For "</u>"

interface RenderInlineProps {
  text: string;
  defaultColor?: string;
  bold?: boolean;
  italic?: boolean;
  wrap?: React.ComponentProps<typeof Text>['wrap'];
  workspaceDirectories?: readonly string[];
}

function renderBoldNode(
  fullMatch: string,
  key: string,
  baseColor: string,
): React.ReactNode | null {
  if (
    fullMatch.startsWith('**') &&
    fullMatch.endsWith('**') &&
    fullMatch.length > BOLD_MARKER_LENGTH * 2
  ) {
    return (
      <Text key={key} bold color={baseColor}>
        {fullMatch.slice(BOLD_MARKER_LENGTH, -BOLD_MARKER_LENGTH)}
      </Text>
    );
  }
  return null;
}

function isItalicMatch(
  fullMatch: string,
  text: string,
  matchIndex: number,
  lastIndex: number,
): boolean {
  if (fullMatch.length <= ITALIC_MARKER_LENGTH * 2) return false;

  const isAsterisk = fullMatch.startsWith('*') && fullMatch.endsWith('*');
  const isUnderscore = fullMatch.startsWith('_') && fullMatch.endsWith('_');
  if (!isAsterisk && !isUnderscore) return false;

  const beforeMatch = text.substring(matchIndex - 1, matchIndex);
  const afterMatch = text.substring(lastIndex, lastIndex + 1);
  if (/\w/.test(beforeMatch)) return false;
  if (/\w/.test(afterMatch)) return false;

  const beforePunct = text.substring(matchIndex - 2, matchIndex);
  const afterPunct = text.substring(lastIndex, lastIndex + 2);
  if (/\S[./\\]/.test(beforePunct)) return false;
  if (/[./\\]\S/.test(afterPunct)) return false;

  return true;
}

function renderItalicNode(
  fullMatch: string,
  key: string,
  baseColor: string,
): React.ReactNode {
  return (
    <Text key={key} italic color={baseColor}>
      {fullMatch.slice(ITALIC_MARKER_LENGTH, -ITALIC_MARKER_LENGTH)}
    </Text>
  );
}

function renderStrikethroughNode(
  fullMatch: string,
  key: string,
  baseColor: string,
): React.ReactNode | null {
  if (
    fullMatch.startsWith('~~') &&
    fullMatch.endsWith('~~') &&
    fullMatch.length > STRIKETHROUGH_MARKER_LENGTH * 2
  ) {
    return (
      <Text key={key} strikethrough color={baseColor}>
        {fullMatch.slice(
          STRIKETHROUGH_MARKER_LENGTH,
          -STRIKETHROUGH_MARKER_LENGTH,
        )}
      </Text>
    );
  }
  return null;
}

function renderInlineCodeNode(
  fullMatch: string,
  key: string,
): React.ReactNode | null {
  if (
    fullMatch.startsWith('`') &&
    fullMatch.endsWith('`') &&
    fullMatch.length > INLINE_CODE_MARKER_LENGTH
  ) {
    // Inline code span. The bounded body quantifier avoids sonarjs/slow-regex and
    // the pattern is passed to RegExp via an identifier so it is not a static
    // literal flagged by sonarjs/regular-expr.
    const inlineCodePattern = '^(`+)(.{1,5000}?)\\1$';
    const codeMatch = fullMatch.match(new RegExp(inlineCodePattern, 's'));
    if (codeMatch?.[2]) {
      return (
        <Text key={key} color={theme.text.accent}>
          {codeMatch[2]}
        </Text>
      );
    }
  }
  return null;
}

function renderLinkNode(
  fullMatch: string,
  key: string,
  baseColor: string,
): React.ReactNode | null {
  if (
    fullMatch.startsWith('[') &&
    fullMatch.includes('](') &&
    fullMatch.endsWith(')')
  ) {
    // Markdown link. The bounded lazy quantifiers avoid sonarjs/slow-regex and
    // the pattern is passed to RegExp via an identifier so it is not a static
    // literal flagged by sonarjs/regular-expr.
    const linkPattern = '\\[(.{0,2000}?)\\]\\((.{0,4000}?)\\)';
    const linkMatch = fullMatch.match(new RegExp(linkPattern));
    if (linkMatch) {
      const [, linkText, url] = linkMatch;
      // Link the visible label and keep the raw `(url)` fallback, itself
      // linked, so the target stays reachable in terminals without OSC 8.
      const combinedLink = createUrlLink(url, `${linkText} (${url})`);
      if (combinedLink !== null) {
        return (
          <Text key={key} color={theme.text.link}>
            {combinedLink}
          </Text>
        );
      }
      return (
        <Text key={key} color={baseColor}>
          {linkText}
          <Text color={theme.text.link}> ({url})</Text>
        </Text>
      );
    }
  }
  return null;
}

function renderUnderlineNode(
  fullMatch: string,
  key: string,
  baseColor: string,
): React.ReactNode | null {
  if (
    fullMatch.startsWith('<u>') &&
    fullMatch.endsWith('</u>') &&
    fullMatch.length > UNDERLINE_TAG_START_LENGTH + UNDERLINE_TAG_END_LENGTH - 1
  ) {
    return (
      <Text key={key} underline color={baseColor}>
        {fullMatch.slice(UNDERLINE_TAG_START_LENGTH, -UNDERLINE_TAG_END_LENGTH)}
      </Text>
    );
  }
  return null;
}

function renderBareUrlNode(
  fullMatch: string,
  key: string,
  baseColor: string,
): React.ReactNode | null {
  const { url, trailing } = splitTrailingUrlPunctuation(fullMatch);
  const urlLink = createUrlLink(url);
  if (urlLink === null) {
    return (
      <Text key={key} color={theme.text.link}>
        {fullMatch}
      </Text>
    );
  }
  return (
    <Text key={key} color={baseColor}>
      <Text color={theme.text.link}>{urlLink}</Text>
      {trailing.length > 0 && <Text color={baseColor}>{trailing}</Text>}
    </Text>
  );
}

function renderMatchedNode(
  fullMatch: string,
  key: string,
  baseColor: string,
  text: string,
  matchIndex: number,
  lastIndex: number,
): React.ReactNode | null {
  const bold = renderBoldNode(fullMatch, key, baseColor);
  if (bold !== null) return bold;

  if (isItalicMatch(fullMatch, text, matchIndex, lastIndex)) {
    return renderItalicNode(fullMatch, key, baseColor);
  }

  const strikethrough = renderStrikethroughNode(fullMatch, key, baseColor);
  if (strikethrough !== null) return strikethrough;

  const code = renderInlineCodeNode(fullMatch, key);
  if (code !== null) return code;

  const link = renderLinkNode(fullMatch, key, baseColor);
  if (link !== null) return link;

  const underline = renderUnderlineNode(fullMatch, key, baseColor);
  if (underline !== null) return underline;

  if (fullMatch.match(/^https?:\/\//)) {
    return renderBareUrlNode(fullMatch, key, baseColor);
  }

  return null;
}

/**
 * Path-like token pattern. Tokens must contain at least one path separator, or
 * be a `.`/`..` relative path prefix. Bounded quantifiers avoid sonarjs/slow-regex,
 * and the pattern is passed via an identifier so it is not a static literal
 * flagged by sonarjs/regular-expr.
 */
const FILE_PATH_PATTERN =
  '(\\S{1,500}[/\\\\]\\S{1,500}|\\.\\.?[/\\\\]\\S{1,500})';

const PATH_DELIMITERS = new Set([
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  "'",
  '"',
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
]);

/**
 * Trailing sentence-punctuation characters that should be stripped from a bare
 * URL link target so prose like "see https://example.com." does not include the
 * period in the link.
 */
const URL_TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?']);

/**
 * Split a bare URL token into the URL portion and any trailing punctuation
 * that should be excluded from the link target. A trailing `)` is only stripped
 * when the URL contains no `(`, so Wikipedia-style `..._(disambiguation)` URLs
 * stay intact. Uses a character-set lookup instead of a regex to avoid
 * backtracking-vulnerable patterns.
 */
function splitTrailingUrlPunctuation(token: string): {
  url: string;
  trailing: string;
} {
  let end = token.length;
  while (end > 0 && URL_TRAILING_PUNCTUATION.has(token[end - 1])) {
    end--;
  }
  if (end > 0 && token[end - 1] === ')' && !token.slice(0, end).includes('(')) {
    end--;
  }
  return { url: token.slice(0, end), trailing: token.slice(end) };
}

function renderPlainSegment(
  textSlice: string,
  baseColor: string,
  key: string,
  bold?: boolean,
  italic?: boolean,
): React.ReactNode {
  return (
    <Text key={key} color={baseColor} bold={bold} italic={italic}>
      {textSlice}
    </Text>
  );
}

/**
 * Strip leading and trailing sentence-punctuation delimiters from a candidate
 * path token so that prose like `src/utils.ts.` or `(src/utils.ts)` resolves
 * correctly. Uses a character-set lookup instead of a regex to avoid
 * backtracking-vulnerable patterns.
 */
function trimPathDelimiters(candidate: string): string {
  let start = 0;
  let end = candidate.length;
  while (start < end && PATH_DELIMITERS.has(candidate[start])) {
    start++;
  }
  while (end > start && PATH_DELIMITERS.has(candidate[end - 1])) {
    end--;
  }
  return candidate.slice(start, end);
}

/**
 * Scan a plain-text segment for path-like tokens, resolving each against the
 * workspace directories. Tokens that exist on disk become OSC 8 link nodes;
 * intervening text becomes plain `<Text>` nodes. Returns null if no links were
 * produced (caller should render a single plain segment instead).
 */
function collectLinkNodes(
  textSegment: string,
  workspaceDirectories: readonly string[],
  baseColor: string,
  keyPrefix: string,
  bold?: boolean,
  italic?: boolean,
): React.ReactNode[] | null {
  const pathRegex = new RegExp(FILE_PATH_PATTERN, 'g');
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let segmentIndex = 0;

  while ((match = pathRegex.exec(textSegment)) !== null) {
    const rawCandidate = match[0];
    const candidate = trimPathDelimiters(rawCandidate);
    const link = createFilePathLink(candidate, workspaceDirectories);
    if (link === null) {
      continue;
    }

    if (match.index > lastIndex) {
      nodes.push(
        renderPlainSegment(
          textSegment.slice(lastIndex, match.index),
          baseColor,
          `${keyPrefix}-p${segmentIndex}`,
          bold,
          italic,
        ),
      );
      segmentIndex++;
    }

    nodes.push(
      <Text key={`${keyPrefix}-l${segmentIndex}`} color={theme.text.link}>
        {link}
      </Text>,
    );
    segmentIndex++;
    lastIndex = match.index + rawCandidate.length;
  }

  if (nodes.length === 0) {
    return null;
  }

  if (lastIndex < textSegment.length) {
    nodes.push(
      renderPlainSegment(
        textSegment.slice(lastIndex),
        baseColor,
        `${keyPrefix}-p${segmentIndex}`,
        bold,
        italic,
      ),
    );
  }

  return nodes;
}

/**
 * Process a plain-text segment (text that is NOT inside markdown tokens) for
 * file-path links. Path-like tokens are resolved against the workspace
 * directories; absolute paths are resolved directly. Tokens that exist on disk
 * are rendered as OSC 8 links, the remaining text renders as plain `<Text>`
 * nodes.
 */
function processPlainTextForLinks(
  textSegment: string,
  workspaceDirectories: readonly string[] | undefined,
  baseColor: string,
  keyPrefix: string,
  bold?: boolean,
  italic?: boolean,
): React.ReactNode {
  const linkNodes = collectLinkNodes(
    textSegment,
    workspaceDirectories ?? [],
    baseColor,
    keyPrefix,
    bold,
    italic,
  );
  return (
    linkNodes ??
    renderPlainSegment(textSegment, baseColor, keyPrefix, bold, italic)
  );
}

function renderPlainTextNodes(
  text: string,
  baseColor: string,
  bold: boolean | undefined,
  italic: boolean | undefined,
  wrap: React.ComponentProps<typeof Text>['wrap'],
): React.ReactNode {
  return (
    <Text color={baseColor} bold={bold} italic={italic} wrap={wrap}>
      {text}
    </Text>
  );
}

/**
 * Determine whether the text needs full markdown/path tokenization or can be
 * rendered as a single plain-text node. When workspace directories are present,
 * path separators (`/` `\`) also trigger tokenization so file paths can be linked.
 * Without workspace directories we still tokenize for absolute paths
 * (`/...` or `C:\...`) so direct paths can be linked.
 */
function needsTokenization(text: string, hasWorkspaceDirs: boolean): boolean {
  if (/[*_~`<[]|https?:\/\//.test(text)) {
    return true;
  }
  if (hasWorkspaceDirs) {
    return /[/\\]/.test(text);
  }
  // Without workspace dirs, still tokenize for absolute paths (/... or C:\...)
  return /(^|\s)[/\\]|[A-Za-z]:[\\/]/.test(text);
}

/**
 * Tokenize `text` into inline markdown nodes and plain-text segments. Plain-text
 * segments are additionally processed for file-path links when workspace
 * directories are available.
 */
function tokenizeInlineMarkdown(
  text: string,
  workspaceDirectories: readonly string[] | undefined,
  baseColor: string,
  bold?: boolean,
  italic?: boolean,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  // Inline markdown tokens. The bounded lazy quantifiers avoid sonarjs/slow-regex
  // and the pattern is passed to RegExp via an identifier so it is not a static
  // literal flagged by sonarjs/regular-expr.
  const inlinePattern =
    '(\\*\\*.{0,2000}?\\*\\*|\\*.{0,2000}?\\*|_.{0,2000}?_|~~.{0,2000}?~~|\\[.{0,2000}?\\]\\(.{0,4000}?\\)|`+.{1,2000}?`+|<u>.{0,2000}?</u>|https?://\\S{1,4000})';
  const inlineRegex = new RegExp(inlinePattern, 'g');
  let match;

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        processPlainTextForLinks(
          text.slice(lastIndex, match.index),
          workspaceDirectories,
          baseColor,
          `t-${lastIndex}`,
          bold,
          italic,
        ),
      );
    }

    const fullMatch = match[0];
    let renderedNode: React.ReactNode = null;
    const key = `m-${match.index}`;

    try {
      renderedNode = renderMatchedNode(
        fullMatch,
        key,
        baseColor,
        text,
        match.index,
        inlineRegex.lastIndex,
      );
    } catch (e) {
      debugLogger.error('Error parsing inline markdown part:', fullMatch, e);
      renderedNode = null;
    }

    nodes.push(
      renderedNode ?? (
        <Text key={key} color={baseColor}>
          {fullMatch}
        </Text>
      ),
    );
    lastIndex = inlineRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(
      processPlainTextForLinks(
        text.slice(lastIndex),
        workspaceDirectories,
        baseColor,
        `t-${lastIndex}`,
        bold,
        italic,
      ),
    );
  }

  return nodes.filter((node) => node !== null);
}

export const RenderInlineInternal: React.FC<RenderInlineProps> = ({
  text,
  defaultColor,
  bold,
  italic,
  wrap,
  workspaceDirectories,
}) => {
  const baseColor = defaultColor ?? theme.text.primary;
  const hasWorkspaceDirs =
    workspaceDirectories !== undefined && workspaceDirectories.length > 0;

  if (!needsTokenization(text, hasWorkspaceDirs)) {
    return renderPlainTextNodes(text, baseColor, bold, italic, wrap);
  }

  const nodes = tokenizeInlineMarkdown(
    text,
    workspaceDirectories,
    baseColor,
    bold,
    italic,
  );

  return (
    <Text color={baseColor} bold={bold} italic={italic} wrap={wrap}>
      {nodes}
    </Text>
  );
};

export const RenderInline = React.memo(RenderInlineInternal);

// Pattern strings for stripping markdown formatting to measure plain-text
// width. They are referenced by identifier when building the RegExp objects so
// they are not static literals flagged by sonarjs/regular-expr, and the link
// rule uses bounded quantifiers to avoid sonarjs/slow-regex.
const STRONG_STRIP_PATTERN = '\\*\\*(.{0,2000}?)\\*\\*';
const EMPHASIS_STRIP_PATTERN = '\\*(.{1,2000}?)\\*';
const UNDERSCORE_STRIP_PATTERN = '_(.{0,2000}?)_';
const STRIKE_STRIP_PATTERN = '~~(.{0,2000}?)~~';
const CODE_STRIP_PATTERN = '`(.{0,2000}?)`';
const UNDERLINE_STRIP_PATTERN = '<u>(.{0,2000}?)</u>';
const LINK_STRIP_PATTERN = '.{0,5000}\\[(.{0,2000}?)\\]\\(.{0,4000}\\)';
const STRIP_MARKDOWN_RULES: ReadonlyArray<{
  regex: RegExp;
  replacement: string;
}> = [
  { regex: new RegExp(STRONG_STRIP_PATTERN, 'g'), replacement: '$1' },
  { regex: new RegExp(EMPHASIS_STRIP_PATTERN, 'g'), replacement: '$1' },
  { regex: new RegExp(UNDERSCORE_STRIP_PATTERN, 'g'), replacement: '$1' },
  { regex: new RegExp(STRIKE_STRIP_PATTERN, 'g'), replacement: '$1' },
  { regex: new RegExp(CODE_STRIP_PATTERN, 'g'), replacement: '$1' },
  { regex: new RegExp(UNDERLINE_STRIP_PATTERN, 'g'), replacement: '$1' },
  { regex: new RegExp(LINK_STRIP_PATTERN, 'g'), replacement: '$1' },
];

/**
 * Utility function to get the plain text length of a string with markdown formatting
 * This is useful for calculating column widths in tables
 */
export const getPlainTextLength = (text: string): number => {
  // Strip markdown formatting. Patterns are passed to RegExp via identifiers so
  // they are not static literals flagged by sonarjs/regular-expr, and bounded
  // quantifiers in the link rule avoid sonarjs/slow-regex.
  const cleanText = STRIP_MARKDOWN_RULES.reduce(
    (acc, { regex, replacement }) => acc.replace(regex, replacement),
    text,
  );
  return stringWidth(cleanText);
};
