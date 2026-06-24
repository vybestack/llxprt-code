/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text, useIsScreenReaderEnabled } from 'ink';
import { Colors, SemanticColors } from '../../colors.js';
import crypto from 'node:crypto';
import { colorizeCode, colorizeLine } from '../../utils/CodeColorizer.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';
import type { Theme } from '../../themes/theme.js';
import { firstNonEmptyString } from '../../../utils/coalesce.js';

interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'other';
  oldLine?: number;
  newLine?: number;
  content: string;
}

function isNewFileDiffLine(line: DiffLine): boolean {
  if (line.type === 'add' || line.type === 'hunk' || line.type === 'other') {
    return true;
  }
  return (
    line.content.startsWith('diff --git') ||
    line.content.startsWith('new file mode')
  );
}

function diffLineBackgroundColor(type: DiffLine['type']): string | undefined {
  if (type === 'add') {
    return Colors.DiffAddedBackground;
  }
  if (type === 'del') {
    return Colors.DiffRemovedBackground;
  }
  return undefined;
}

interface DiffParseState {
  result: DiffLine[];
  currentOldLine: number;
  currentNewLine: number;
  inHunk: boolean;
}

function processDiffLine(
  line: string,
  hunkHeaderRegex: RegExp,
  state: DiffParseState,
): void {
  const hunkMatch = line.match(hunkHeaderRegex);
  if (hunkMatch) {
    // First line number applies to the *first* actual line; we increment
    // before pushing, so decrement here to compensate.
    state.currentOldLine = parseInt(hunkMatch[1], 10) - 1;
    state.currentNewLine = parseInt(hunkMatch[2], 10) - 1;
    state.inHunk = true;
    state.result.push({ type: 'hunk', content: line });
    return;
  }
  if (!state.inHunk) {
    // Outside a hunk we only have header/other lines, all skipped.
    return;
  }
  if (line.startsWith('+')) {
    state.currentNewLine++;
    state.result.push({
      type: 'add',
      newLine: state.currentNewLine,
      content: line.substring(1),
    });
  } else if (line.startsWith('-')) {
    state.currentOldLine++;
    state.result.push({
      type: 'del',
      oldLine: state.currentOldLine,
      content: line.substring(1),
    });
  } else if (line.startsWith(' ')) {
    state.currentOldLine++;
    state.currentNewLine++;
    state.result.push({
      type: 'context',
      oldLine: state.currentOldLine,
      newLine: state.currentNewLine,
      content: line.substring(1),
    });
  } else if (line.startsWith('\\')) {
    // Handle "\ No newline at end of file"
    state.result.push({ type: 'other', content: line });
  }
}

function parseDiffWithLineNumbers(diffContent: string): DiffLine[] {
  const lines = diffContent.split('\n');
  const state: DiffParseState = {
    result: [],
    currentOldLine: 0,
    currentNewLine: 0,
    inHunk: false,
  };
  // Unified diff hunk header. The pattern uses a non-overlapping optional comma
  // group and is passed to RegExp via an identifier so it is not a static
  // literal flagged by sonarjs/regular-expr and avoids sonarjs/slow-regex.
  const hunkHeaderPattern = '^@@ -(\\d+)(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@';
  const hunkHeaderRegex = new RegExp(hunkHeaderPattern);

  for (const line of lines) {
    processDiffLine(line, hunkHeaderRegex, state);
  }
  return state.result;
}

interface DiffRendererProps {
  diffContent: string;
  filename?: string;
  tabWidth?: number;
  availableTerminalHeight?: number;
  terminalWidth: number;
  theme?: Theme;
}

const DEFAULT_TAB_WIDTH = 4; // Spaces per tab for normalization

export const DiffRenderer: React.FC<DiffRendererProps> = ({
  diffContent,
  filename,
  tabWidth = DEFAULT_TAB_WIDTH,
  availableTerminalHeight,
  terminalWidth,
  theme,
}) => {
  const screenReaderEnabled = useIsScreenReaderEnabled();
  if (!diffContent || typeof diffContent !== 'string') {
    return <Text color={Colors.AccentYellow}>No diff content.</Text>;
  }

  const parsedLines = parseDiffWithLineNumbers(diffContent);

  if (parsedLines.length === 0) {
    return (
      <Box borderStyle="round" borderColor={Colors.Gray} padding={1}>
        <Text color={Colors.DimComment}>No changes detected.</Text>
      </Box>
    );
  }
  if (screenReaderEnabled) {
    return (
      <Box flexDirection="column">
        {parsedLines.map((line, index) => (
          <Text key={index} color={Colors.Foreground}>
            {line.type}: {line.content}
          </Text>
        ))}
      </Box>
    );
  }

  // Check if the diff represents a new file (only additions and header lines)
  const isNewFile = parsedLines.every(isNewFileDiffLine);

  let renderedOutput;

  if (isNewFile) {
    // Extract only the added lines' content
    const addedContent = parsedLines
      .filter((line) => line.type === 'add')
      .map((line) => line.content)
      .join('\n');
    // Attempt to infer language from filename, default to plain text if no filename
    const fileExtension =
      firstNonEmptyString(filename?.split('.').pop()) ?? null;
    const language = fileExtension
      ? getLanguageFromExtension(fileExtension)
      : null;
    renderedOutput = colorizeCode(
      addedContent,
      language,
      availableTerminalHeight,
      terminalWidth,
      theme,
    );
  } else {
    renderedOutput = renderDiffContent(
      parsedLines,
      filename,
      tabWidth,
      availableTerminalHeight,
      terminalWidth,
    );
  }

  return renderedOutput;
};

const MAX_CONTEXT_LINES_WITHOUT_GAP = 5;

interface DiffRenderContext {
  displayableLines: DiffLine[];
  gutterWidth: number;
  language: string | null;
  baseIndentation: number;
  key: string;
}

function prepareDiffRenderContext(
  parsedLines: DiffLine[],
  filename: string | undefined,
  tabWidth: number,
): DiffRenderContext | null {
  const normalizedLines = parsedLines.map((line) => ({
    ...line,
    content: line.content.replace(/\t/g, ' '.repeat(tabWidth)),
  }));

  const displayableLines = normalizedLines.filter(
    (l) => l.type !== 'hunk' && l.type !== 'other',
  );

  if (displayableLines.length === 0) {
    return null;
  }

  const maxLineNumber = Math.max(
    0,
    ...displayableLines.map((l) => l.oldLine ?? 0),
    ...displayableLines.map((l) => l.newLine ?? 0),
  );
  const gutterWidth = Math.max(1, maxLineNumber.toString().length);

  const fileExtension = firstNonEmptyString(filename?.split('.').pop()) ?? null;
  const language = fileExtension
    ? getLanguageFromExtension(fileExtension)
    : null;

  let baseIndentation = Infinity;
  for (const line of displayableLines) {
    if (line.content.trim() === '') continue;
    const firstCharIndex = line.content.search(/\S/);
    const currentIndent = firstCharIndex === -1 ? 0 : firstCharIndex;
    baseIndentation = Math.min(baseIndentation, currentIndent);
  }
  if (!isFinite(baseIndentation)) {
    baseIndentation = 0;
  }

  const key = filename
    ? `diff-box-${filename}`
    : `diff-box-${crypto.createHash('sha1').update(JSON.stringify(parsedLines)).digest('hex')}`;

  return { displayableLines, gutterWidth, language, baseIndentation, key };
}

function getLineInfo(line: DiffLine): {
  gutterNumStr: string;
  prefixSymbol: string;
  newLineNumber: number | null;
} | null {
  switch (line.type) {
    case 'add':
      return {
        gutterNumStr: (line.newLine ?? '').toString(),
        prefixSymbol: '+',
        newLineNumber: line.newLine ?? null,
      };
    case 'del':
      return {
        gutterNumStr: (line.oldLine ?? '').toString(),
        prefixSymbol: '-',
        newLineNumber: line.oldLine ?? null,
      };
    case 'context':
      return {
        gutterNumStr: (line.newLine ?? '').toString(),
        prefixSymbol: ' ',
        newLineNumber: line.newLine ?? null,
      };
    default:
      return null;
  }
}

function renderDiffLineContent(
  line: DiffLine,
  displayContent: string,
  prefixSymbol: string,
  context: DiffRenderContext,
): React.ReactNode {
  if (line.type === 'context') {
    return (
      <>
        <Text color={Colors.Foreground}>{prefixSymbol} </Text>
        <Text color={Colors.Foreground} wrap="wrap">
          {colorizeLine(displayContent, context.language)}
        </Text>
      </>
    );
  }

  const bgColor =
    line.type === 'add'
      ? Colors.DiffAddedBackground
      : Colors.DiffRemovedBackground;
  const fgColor =
    line.type === 'add'
      ? Colors.DiffAddedForeground
      : Colors.DiffRemovedForeground;

  return (
    <Text backgroundColor={bgColor} color={fgColor} wrap="wrap">
      <Text color={fgColor}>{prefixSymbol}</Text>{' '}
      {colorizeLine(displayContent, context.language, undefined, fgColor)}
    </Text>
  );
}

function renderDiffLineRow(
  line: DiffLine,
  index: number,
  context: DiffRenderContext,
  lastLineNumberRef: { current: number | null },
  terminalWidth: number,
): React.ReactNode {
  let relevantLineNumberForGapCalc: number | null = null;
  if (line.type === 'add' || line.type === 'context') {
    relevantLineNumberForGapCalc = line.newLine ?? null;
  } else if (line.type === 'del') {
    relevantLineNumberForGapCalc = line.oldLine ?? null;
  }

  const elements: React.ReactNode[] = [];

  if (
    lastLineNumberRef.current !== null &&
    relevantLineNumberForGapCalc !== null &&
    relevantLineNumberForGapCalc >
      lastLineNumberRef.current + MAX_CONTEXT_LINES_WITHOUT_GAP + 1
  ) {
    elements.push(
      <Box key={`gap-${index}`}>
        <Text wrap="truncate" color={Colors.Gray}>
          {'═'.repeat(terminalWidth)}
        </Text>
      </Box>,
    );
  }

  const lineInfo = getLineInfo(line);
  if (!lineInfo) {
    return elements;
  }

  lastLineNumberRef.current = lineInfo.newLineNumber;
  const displayContent = line.content.substring(context.baseIndentation);

  elements.push(
    <Box key={`diff-line-${index}`} flexDirection="row">
      <Text
        color={SemanticColors.text.secondary}
        backgroundColor={diffLineBackgroundColor(line.type)}
      >
        {lineInfo.gutterNumStr.padStart(context.gutterWidth)}{' '}
      </Text>
      {renderDiffLineContent(
        line,
        displayContent,
        lineInfo.prefixSymbol,
        context,
      )}
    </Box>,
  );

  return elements;
}

const renderDiffContent = (
  parsedLines: DiffLine[],
  filename: string | undefined,
  tabWidth = DEFAULT_TAB_WIDTH,
  availableTerminalHeight: number | undefined,
  terminalWidth: number,
) => {
  const context = prepareDiffRenderContext(parsedLines, filename, tabWidth);

  if (!context) {
    return (
      <Box borderStyle="round" borderColor={Colors.Gray} padding={1}>
        <Text color={Colors.DimComment}>No changes detected.</Text>
      </Box>
    );
  }

  const lastLineNumberRef: { current: number | null } = { current: null };

  const renderedLines = context.displayableLines.flatMap((line, index) =>
    renderDiffLineRow(line, index, context, lastLineNumberRef, terminalWidth),
  );

  return (
    <MaxSizedBox
      maxHeight={availableTerminalHeight}
      maxWidth={terminalWidth}
      key={context.key}
    >
      {renderedLines}
    </MaxSizedBox>
  );
};

const getLanguageFromExtension = (extension: string): string | null => {
  const languageMap: { [key: string]: string } = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    json: 'json',
    css: 'css',
    html: 'html',
    sh: 'bash',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    txt: 'plaintext',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    rb: 'ruby',
  };
  return languageMap[extension] || null; // Return null if extension not found
};
