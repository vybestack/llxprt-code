/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import React from 'react';
import { Text } from 'ink';
import { theme } from '../semantic-colors.js';
import stringWidth from 'string-width';
import { debugLogger } from '@vybestack/llxprt-code-core';

// Constants for Markdown parsing
const BOLD_MARKER_LENGTH = 2; // For "**"
const ITALIC_MARKER_LENGTH = 1; // For "*" or "_"
const STRIKETHROUGH_MARKER_LENGTH = 2; // For "~~")
const UNDERLINE_TAG_START_LENGTH = 3; // For "<u>"
const UNDERLINE_TAG_END_LENGTH = 4; // For "</u>"

interface RenderInlineProps {
  text: string;
  defaultColor?: string;
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
  const markerLength = countLeadingChars(fullMatch, '`');
  if (markerLength === 0 || fullMatch.length <= markerLength * 2) {
    return null;
  }
  const closingMarker = '`'.repeat(markerLength);
  if (fullMatch.endsWith(closingMarker)) {
    return (
      <Text key={key} color={theme.text.accent}>
        {fullMatch.slice(markerLength, -markerLength)}
      </Text>
    );
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
    const separator = fullMatch.indexOf('](');
    if (separator > 0) {
      const linkText = fullMatch.slice(1, separator);
      const url = fullMatch.slice(separator + 2, -1);
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

interface InlineMatch {
  readonly value: string;
  readonly index: number;
  readonly end: number;
}

function countLeadingChars(value: string, char: string): number {
  let count = 0;
  while (value[count] === char) {
    count += 1;
  }
  return count;
}

function findUrlEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && ![' ', '\t', '\n', '\r'].includes(text[end])) {
    end += 1;
  }
  return end;
}

function findUrlMatch(text: string, index: number): InlineMatch | null {
  if (
    !text.startsWith('http://', index) &&
    !text.startsWith('https://', index)
  ) {
    return null;
  }
  const end = findUrlEnd(text, index);
  return { value: text.slice(index, end), index, end };
}

function findDelimitedMatch(
  text: string,
  index: number,
  marker: string,
): InlineMatch | null {
  if (!text.startsWith(marker, index)) return null;
  const contentStart = index + marker.length;
  const end = text.indexOf(marker, contentStart);
  if (end === -1 || end === contentStart) return null;
  const matchEnd = end + marker.length;
  return { value: text.slice(index, matchEnd), index, end: matchEnd };
}

function findUnderlineMatch(text: string, index: number): InlineMatch | null {
  if (!text.startsWith('<u>', index)) return null;
  const end = text.indexOf('</u>', index + UNDERLINE_TAG_START_LENGTH);
  if (end === -1) return null;
  const matchEnd = end + UNDERLINE_TAG_END_LENGTH;
  return { value: text.slice(index, matchEnd), index, end: matchEnd };
}

function findCodeMatch(text: string, index: number): InlineMatch | null {
  if (text[index] !== '`') return null;
  const markerLength = countLeadingChars(text.slice(index), '`');
  const marker = '`'.repeat(markerLength);
  const end = text.indexOf(marker, index + markerLength);
  if (end === -1 || end <= index + markerLength) return null;
  const matchEnd = end + markerLength;
  return { value: text.slice(index, matchEnd), index, end: matchEnd };
}

function findLinkMatch(text: string, index: number): InlineMatch | null {
  if (text[index] !== '[') return null;
  const separator = text.indexOf('](', index + 1);
  const end = separator === -1 ? -1 : text.indexOf(')', separator + 2);
  if (end === -1) return null;
  return { value: text.slice(index, end + 1), index, end: end + 1 };
}

function findItalicMatchCandidate(
  text: string,
  index: number,
): InlineMatch | null {
  if (text[index] !== '*' && text[index] !== '_') return null;
  if (text[index + 1] === text[index]) return null;
  const end = text.indexOf(text[index], index + ITALIC_MARKER_LENGTH);
  if (end === -1) return null;
  return { value: text.slice(index, end + 1), index, end: end + 1 };
}

function findInlineMatchAt(text: string, index: number): InlineMatch | null {
  for (const find of [
    findUrlMatch,
    findUnderlineMatch,
    findCodeMatch,
    findLinkMatch,
  ]) {
    const match = find(text, index);
    if (match !== null) return match;
  }

  const boldMatch = findDelimitedMatch(text, index, '**');
  if (boldMatch !== null) return boldMatch;

  const strikeMatch = findDelimitedMatch(text, index, '~~');
  if (strikeMatch !== null) return strikeMatch;

  return findItalicMatchCandidate(text, index);
}

function findNextInlineMatch(text: string, start: number): InlineMatch | null {
  for (let index = start; index < text.length; index++) {
    const match = findInlineMatchAt(text, index);
    if (match !== null) return match;
  }
  return null;
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

  if (fullMatch.startsWith('http://') || fullMatch.startsWith('https://')) {
    return (
      <Text key={key} color={theme.text.link}>
        {fullMatch}
      </Text>
    );
  }

  return null;
}

const RenderInlineInternal: React.FC<RenderInlineProps> = ({
  text,
  defaultColor,
}) => {
  const baseColor = defaultColor ?? theme.text.primary;
  const firstMatch = findNextInlineMatch(text, 0);
  if (firstMatch === null) {
    return <Text color={baseColor}>{text}</Text>;
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: InlineMatch | null = firstMatch;

  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <Text key={`t-${lastIndex}`} color={baseColor}>
          {text.slice(lastIndex, match.index)}
        </Text>,
      );
    }

    const fullMatch = match.value;
    let renderedNode: React.ReactNode = null;
    const key = `m-${match.index}`;

    try {
      renderedNode = renderMatchedNode(
        fullMatch,
        key,
        baseColor,
        text,
        match.index,
        match.end,
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
    lastIndex = match.end;
    match = findNextInlineMatch(text, lastIndex);
  }

  if (lastIndex < text.length) {
    nodes.push(
      <Text key={`t-${lastIndex}`} color={baseColor}>
        {text.slice(lastIndex)}
      </Text>,
    );
  }

  return <>{nodes.filter((node) => node !== null)}</>;
};

export const RenderInline = React.memo(RenderInlineInternal);

/**
 * Utility function to get the plain text length of a string with markdown formatting
 * This is useful for calculating column widths in tables
 */
export const getPlainTextLength = (text: string): number => {
  const parts: string[] = [];
  let cursor = 0;
  let match = findNextInlineMatch(text, 0);
  while (match !== null) {
    parts.push(text.slice(cursor, match.index));
    const value = match.value;
    if (value.startsWith('**') && value.endsWith('**')) {
      parts.push(value.slice(BOLD_MARKER_LENGTH, -BOLD_MARKER_LENGTH));
    } else if (value.startsWith('~~') && value.endsWith('~~')) {
      parts.push(
        value.slice(STRIKETHROUGH_MARKER_LENGTH, -STRIKETHROUGH_MARKER_LENGTH),
      );
    } else if (value.startsWith('`') && value.endsWith('`')) {
      const markerLength = countLeadingChars(value, '`');
      parts.push(value.slice(markerLength, -markerLength));
    } else if (value.startsWith('<u>') && value.endsWith('</u>')) {
      parts.push(
        value.slice(UNDERLINE_TAG_START_LENGTH, -UNDERLINE_TAG_END_LENGTH),
      );
    } else if (value.startsWith('[')) {
      const separator = value.indexOf('](');
      parts.push(separator === -1 ? value : value.slice(1, separator));
    } else if (
      (value.startsWith('*') && value.endsWith('*')) ||
      (value.startsWith('_') && value.endsWith('_'))
    ) {
      parts.push(value.slice(ITALIC_MARKER_LENGTH, -ITALIC_MARKER_LENGTH));
    } else {
      parts.push(value);
    }
    cursor = match.end;
    match = findNextInlineMatch(text, cursor);
  }
  parts.push(text.slice(cursor));
  return stringWidth(parts.join(''));
};
