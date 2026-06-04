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
const INLINE_CODE_MARKER_LENGTH = 1; // For "`"
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
  if (
    fullMatch.startsWith('`') &&
    fullMatch.endsWith('`') &&
    fullMatch.length > INLINE_CODE_MARKER_LENGTH
  ) {
    // Static regex for inline code matching - no dynamic parts
    // eslint-disable-next-line sonarjs/regular-expr, sonarjs/slow-regex -- Static regex reviewed for lint hardening; bounded inputs preserve behavior.
    const codeMatch = fullMatch.match(/^(`+)(.+?)\1$/s);
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
    // Static regex for link matching - no dynamic parts
    // eslint-disable-next-line sonarjs/regular-expr, sonarjs/slow-regex -- Static regex reviewed for lint hardening; bounded inputs preserve behavior.
    const linkMatch = fullMatch.match(/\[(.*?)\]\((.*?)\)/);
    if (linkMatch) {
      const [, linkText, url] = linkMatch;
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
  // Early return for plain text without markdown or URLs
  // Static regex for markdown marker detection - no dynamic parts

  if (!/[*_~`<[]|https?:\/\//.test(text)) {
    return <Text color={baseColor}>{text}</Text>;
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  // Static regex for inline markdown parsing - no dynamic parts
  const inlineRegex =
    // eslint-disable-next-line sonarjs/regular-expr, sonarjs/slow-regex, sonarjs/regex-complexity -- Static regex reviewed for lint hardening; bounded inputs preserve behavior and existing token order.
    /(\*\*.*?\*\*|\*.*?\*|_.*?_|~~.*?~~|\[.*?\]\(.*?\)|`+.+?`+|<u>.*?<\/u>|https?:\/\/\S+)/g;
  let match;

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <Text key={`t-${lastIndex}`} color={baseColor}>
          {text.slice(lastIndex, match.index)}
        </Text>,
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
  // Static regexes for stripping markdown formatting - no dynamic parts
  /* eslint-disable sonarjs/regular-expr */
  const cleanText = text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/<u>(.*?)<\/u>/g, '$1')
    // eslint-disable-next-line sonarjs/slow-regex -- Static regex reviewed for lint hardening; bounded inputs preserve behavior.
    .replace(/.*\[(.*?)\]\(.*\)/g, '$1');
  /* eslint-enable sonarjs/regular-expr */
  return stringWidth(cleanText);
};
