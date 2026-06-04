/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import React from 'react';
import { Text, Box } from 'ink';
import { theme } from '../semantic-colors.js';
import { colorizeCode } from './CodeColorizer.js';
import { TableRenderer } from './TableRenderer.js';
import { RenderInline } from './InlineMarkdownRenderer.js';
import { useSettings } from '../contexts/SettingsContext.js';

interface MarkdownDisplayProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
  renderMarkdown?: boolean;
}

// Constants for Markdown parsing and rendering

const EMPTY_LINE_HEIGHT = 1;
const CODE_BLOCK_PREFIX_PADDING = 1;
const LIST_ITEM_PREFIX_PADDING = 1;
const LIST_ITEM_TEXT_FLEX_GROW = 1;

const MarkdownDisplayInternal: React.FC<MarkdownDisplayProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  terminalWidth,
  renderMarkdown = true,
}) => {
  const settings = useSettings();
  const responseColor = theme.text.response;

  if (!text) return <></>;

  if (!renderMarkdown) {
    const colorizedMarkdown = colorizeCode(
      text,
      'markdown',
      availableTerminalHeight,
      terminalWidth - CODE_BLOCK_PREFIX_PADDING,
      undefined,
      settings,
      true,
    );
    return (
      <Box paddingLeft={CODE_BLOCK_PREFIX_PADDING} flexDirection="column">
        {colorizedMarkdown}
      </Box>
    );
  }

  const lines = text.split(/\r?\n/);
  const regexes = buildMarkdownRegexes();
  const {
    contentBlocks,
    codeBlockState: finalCodeBlockState,
    inTable: endedInTable,
    tableHeaders: finalHeaders,
    tableRows: finalRows,
  } = processLines(
    lines,
    regexes,
    isPending,
    availableTerminalHeight,
    terminalWidth,
    responseColor,
  );

  if (finalCodeBlockState.inCodeBlock) {
    contentBlocks.push(
      <RenderCodeBlock
        key="line-eof"
        content={finalCodeBlockState.codeBlockContent}
        lang={finalCodeBlockState.codeBlockLang}
        isPending={isPending}
        availableTerminalHeight={availableTerminalHeight}
        terminalWidth={terminalWidth}
      />,
    );
  }

  if (endedInTable && finalHeaders.length > 0 && finalRows.length > 0) {
    contentBlocks.push(
      <RenderTable
        key={`table-${contentBlocks.length}`}
        headers={finalHeaders}
        rows={finalRows}
        terminalWidth={terminalWidth}
      />,
    );
  }

  return <>{contentBlocks}</>;
};

// Helper functions (adapted from static methods of MarkdownRenderer)

interface MarkdownRegexes {
  headerRegex: RegExp;
  codeFenceRegex: RegExp;
  ulItemRegex: RegExp;
  olItemRegex: RegExp;
  hrRegex: RegExp;
  tableRowRegex: RegExp;
  tableSeparatorRegex: RegExp;
}

function buildMarkdownRegexes(): MarkdownRegexes {
  // Static regexes for markdown parsing - no dynamic parts
  // eslint-disable-next-line sonarjs/regular-expr
  const headerRegex = /^ *(#{1,4}) +(.*)/;
  // eslint-disable-next-line sonarjs/regular-expr, sonarjs/slow-regex -- Static regex reviewed for lint hardening; bounded inputs preserve behavior.
  const codeFenceRegex = /^ *(`{3,}|~{3,}) *(\w*?) *$/;
  // eslint-disable-next-line sonarjs/regular-expr
  const ulItemRegex = /^([ \t]*)([-*+]) +(.*)/;
  // eslint-disable-next-line sonarjs/regular-expr
  const olItemRegex = /^([ \t]*)(\d+)\. +(.*)/;
  // eslint-disable-next-line sonarjs/regular-expr, sonarjs/slow-regex -- Static regex reviewed for lint hardening; bounded inputs preserve behavior.
  const hrRegex = /^ *([-*_] *){3,} *$/;
  // eslint-disable-next-line sonarjs/regular-expr
  const tableRowRegex = /^\s*\|(.+)\|\s*$/;
  // eslint-disable-next-line sonarjs/regular-expr, sonarjs/slow-regex -- Static regex reviewed for lint hardening; bounded inputs preserve behavior.
  const tableSeparatorRegex = /^\s*\|?\s*(:?-+:?)\s*(\|\s*(:?-+:?)\s*)+\|?\s*$/;

  return {
    headerRegex,
    codeFenceRegex,
    ulItemRegex,
    olItemRegex,
    hrRegex,
    tableRowRegex,
    tableSeparatorRegex,
  };
}

interface LineMatchResult {
  codeFenceMatch: RegExpMatchArray | null;
  headerMatch: RegExpMatchArray | null;
  ulMatch: RegExpMatchArray | null;
  olMatch: RegExpMatchArray | null;
  hrMatch: RegExpMatchArray | null;
  tableRowMatch: RegExpMatchArray | null;
  tableSeparatorMatch: RegExpMatchArray | null;
}

function matchLine(line: string, regexes: MarkdownRegexes): LineMatchResult {
  return {
    codeFenceMatch: line.match(regexes.codeFenceRegex),
    headerMatch: line.match(regexes.headerRegex),
    ulMatch: line.match(regexes.ulItemRegex),
    olMatch: line.match(regexes.olItemRegex),
    hrMatch: line.match(regexes.hrRegex),
    tableRowMatch: line.match(regexes.tableRowRegex),
    tableSeparatorMatch: line.match(regexes.tableSeparatorRegex),
  };
}

interface ProcessLinesResult {
  contentBlocks: React.ReactNode[];
  codeBlockState: CodeBlockState;
  inTable: boolean;
  tableHeaders: string[];
  tableRows: string[][];
}

function handleCodeBlockLine(
  line: string,
  key: string,
  codeBlockFence: string,
  regexes: MarkdownRegexes,
  isPending: boolean,
  availableTerminalHeight: number | undefined,
  terminalWidth: number,
  codeBlockContent: string[],
  codeBlockLang: string | null,
  addContentBlock: (block: React.ReactNode) => void,
): CodeBlockState {
  const fenceMatch = line.match(regexes.codeFenceRegex);
  if (
    fenceMatch !== null &&
    fenceMatch[1].startsWith(codeBlockFence[0]) &&
    fenceMatch[1].length >= codeBlockFence.length
  ) {
    addContentBlock(
      <RenderCodeBlock
        key={key}
        content={codeBlockContent}
        lang={codeBlockLang}
        isPending={isPending}
        availableTerminalHeight={availableTerminalHeight}
        terminalWidth={terminalWidth}
      />,
    );
    return {
      inCodeBlock: false,
      codeBlockContent: [],
      codeBlockLang: null,
      codeBlockFence: '',
    };
  }
  return {
    inCodeBlock: true,
    codeBlockContent: [...codeBlockContent, line],
    codeBlockLang,
    codeBlockFence,
  };
}

interface CodeBlockState {
  inCodeBlock: boolean;
  codeBlockContent: string[];
  codeBlockLang: string | null;
  codeBlockFence: string;
}

function processLineEntry(
  line: string,
  index: number,
  lines: string[],
  regexes: MarkdownRegexes,
  isPending: boolean,
  availableTerminalHeight: number | undefined,
  terminalWidth: number,
  codeBlockState: CodeBlockState,
  inTable: boolean,
  tableHeaders: string[],
  tableRows: string[][],
  responseColor: string,
  addContentBlock: (block: React.ReactNode) => void,
  applyLineResult: (result: LineProcessResult, index: number) => void,
): CodeBlockState {
  if (codeBlockState.inCodeBlock) {
    return handleCodeBlockLine(
      line,
      `line-${index}`,
      codeBlockState.codeBlockFence,
      regexes,
      isPending,
      availableTerminalHeight,
      terminalWidth,
      codeBlockState.codeBlockContent,
      codeBlockState.codeBlockLang,
      addContentBlock,
    );
  }

  const matches = matchLine(line, regexes);

  if (matches.codeFenceMatch !== null) {
    return {
      ...codeBlockState,
      inCodeBlock: true,
      codeBlockFence: matches.codeFenceMatch[1],
      codeBlockLang: matches.codeFenceMatch[2] || null,
    };
  }

  applyLineResult(
    processLine(
      line,
      `line-${index}`,
      index,
      lines,
      matches,
      inTable,
      tableHeaders,
      tableRows,
      regexes,
      responseColor,
    ),
    index,
  );
  return codeBlockState;
}

function processLines(
  lines: string[],
  regexes: MarkdownRegexes,
  isPending: boolean,
  availableTerminalHeight: number | undefined,
  terminalWidth: number,
  responseColor: string,
): ProcessLinesResult {
  const contentBlocks: React.ReactNode[] = [];
  const renderState = { lastLineEmpty: true };
  let inTable = false;
  let tableRows: string[][] = [];
  let tableHeaders: string[] = [];

  function addContentBlock(block: React.ReactNode) {
    contentBlocks.push(block);
    renderState.lastLineEmpty = false;
  }

  function applyLineResult(result: LineProcessResult, index: number) {
    if (result.tableFlush && tableHeaders.length > 0 && tableRows.length > 0) {
      addContentBlock(
        <RenderTable
          key={`table-${contentBlocks.length}`}
          headers={tableHeaders}
          rows={tableRows}
          terminalWidth={terminalWidth}
        />,
      );
    }
    inTable = result.inTable;
    tableHeaders = result.tableHeaders;
    tableRows = result.tableRows;

    if (result.block !== null) {
      addContentBlock(result.block);
    } else if (result.emptyLine && !renderState.lastLineEmpty) {
      contentBlocks.push(
        <Box key={`spacer-${index}`} height={EMPTY_LINE_HEIGHT} />,
      );
      renderState.lastLineEmpty = true;
    }
  }

  let codeBlockState: CodeBlockState = {
    inCodeBlock: false,
    codeBlockContent: [],
    codeBlockLang: null,
    codeBlockFence: '',
  };

  for (const [index, line] of lines.entries()) {
    codeBlockState = processLineEntry(
      line,
      index,
      lines,
      regexes,
      isPending,
      availableTerminalHeight,
      terminalWidth,
      codeBlockState,
      inTable,
      tableHeaders,
      tableRows,
      responseColor,
      addContentBlock,
      applyLineResult,
    );
  }

  return {
    contentBlocks,
    codeBlockState,
    inTable,
    tableHeaders,
    tableRows,
  };
}

interface LineProcessResult {
  block: React.ReactNode | null;
  emptyLine: boolean;
  inTable: boolean;
  tableHeaders: string[];
  tableRows: string[][];
  tableFlush: boolean;
}

function renderHeaderNode(
  headerMatch: RegExpMatchArray,
  responseColor: string,
): React.ReactNode {
  const level = headerMatch[1].length;
  const headerText = headerMatch[2];
  switch (level) {
    case 1:
    case 2:
      return (
        <Text bold color={theme.text.link}>
          <RenderInline text={headerText} defaultColor={theme.text.link} />
        </Text>
      );
    case 3:
      return (
        <Text bold color={responseColor}>
          <RenderInline text={headerText} defaultColor={responseColor} />
        </Text>
      );
    case 4:
      return (
        <Text italic color={theme.text.secondary}>
          <RenderInline text={headerText} defaultColor={theme.text.secondary} />
        </Text>
      );
    default:
      return (
        <Text color={responseColor}>
          <RenderInline text={headerText} defaultColor={responseColor} />
        </Text>
      );
  }
}

function processTableLine(
  line: string,
  key: string,
  matches: LineMatchResult,
  currentInTable: boolean,
  currentTableHeaders: string[],
  currentTableRows: string[][],
  responseColor: string,
): LineProcessResult {
  const empty: LineProcessResult = {
    block: null,
    emptyLine: false,
    inTable: currentInTable,
    tableHeaders: currentTableHeaders,
    tableRows: currentTableRows,
    tableFlush: false,
  };

  if (matches.tableRowMatch && !currentInTable) {
    return {
      ...empty,
      inTable: true,
      tableHeaders: matches.tableRowMatch[1]
        .split('|')
        .map((cell) => cell.trim()),
      tableRows: [],
    };
  }

  if (currentInTable && matches.tableSeparatorMatch) {
    return empty;
  }

  if (currentInTable && matches.tableRowMatch) {
    const cells = matches.tableRowMatch[1]
      .split('|')
      .map((cell) => cell.trim());
    while (cells.length < currentTableHeaders.length) {
      cells.push('');
    }
    if (cells.length > currentTableHeaders.length) {
      cells.length = currentTableHeaders.length;
    }
    return {
      ...empty,
      tableRows: [...currentTableRows, cells],
    };
  }

  if (currentInTable) {
    const block =
      line.trim().length > 0 ? (
        <Box key={key}>
          <Text wrap="wrap" color={responseColor}>
            <RenderInline text={line} defaultColor={responseColor} />
          </Text>
        </Box>
      ) : null;
    return {
      ...empty,
      block,
      inTable: false,
      tableHeaders: [],
      tableRows: [],
      tableFlush: true,
    };
  }

  return empty;
}

function processNonTableLine(
  line: string,
  key: string,
  matches: LineMatchResult,
  responseColor: string,
): LineProcessResult {
  const empty: LineProcessResult = {
    block: null,
    emptyLine: false,
    inTable: false,
    tableHeaders: [],
    tableRows: [],
    tableFlush: false,
  };

  if (matches.hrMatch) {
    return {
      ...empty,
      block: (
        <Box key={key}>
          <Text color={theme.ui.comment}>---</Text>
        </Box>
      ),
    };
  }

  if (matches.headerMatch) {
    return {
      ...empty,
      block: (
        <Box key={key}>
          {renderHeaderNode(matches.headerMatch, responseColor)}
        </Box>
      ),
    };
  }

  if (matches.ulMatch) {
    return {
      ...empty,
      block: (
        <RenderListItem
          key={key}
          itemText={matches.ulMatch[3]}
          type="ul"
          marker={matches.ulMatch[2]}
          leadingWhitespace={matches.ulMatch[1]}
        />
      ),
    };
  }

  if (matches.olMatch) {
    return {
      ...empty,
      block: (
        <RenderListItem
          key={key}
          itemText={matches.olMatch[3]}
          type="ol"
          marker={matches.olMatch[2]}
          leadingWhitespace={matches.olMatch[1]}
        />
      ),
    };
  }

  if (line.trim().length === 0) {
    return { ...empty, emptyLine: true };
  }

  return {
    ...empty,
    block: (
      <Box key={key}>
        <Text wrap="wrap" color={responseColor}>
          <RenderInline text={line} defaultColor={responseColor} />
        </Text>
      </Box>
    ),
  };
}

function processLine(
  line: string,
  key: string,
  index: number,
  lines: string[],
  matches: LineMatchResult,
  currentInTable: boolean,
  currentTableHeaders: string[],
  currentTableRows: string[][],
  regexes: MarkdownRegexes,
  responseColor: string,
): LineProcessResult {
  if (matches.tableRowMatch && !currentInTable) {
    if (
      index + 1 < lines.length &&
      lines[index + 1].match(regexes.tableSeparatorRegex)
    ) {
      return processTableLine(
        line,
        key,
        matches,
        currentInTable,
        currentTableHeaders,
        currentTableRows,
        responseColor,
      );
    }
    return {
      block: (
        <Box key={key}>
          <Text wrap="wrap" color={responseColor}>
            <RenderInline text={line} defaultColor={responseColor} />
          </Text>
        </Box>
      ),
      emptyLine: false,
      inTable: false,
      tableHeaders: currentTableHeaders,
      tableRows: currentTableRows,
      tableFlush: false,
    };
  }

  if (currentInTable) {
    return processTableLine(
      line,
      key,
      matches,
      currentInTable,
      currentTableHeaders,
      currentTableRows,
      responseColor,
    );
  }

  return processNonTableLine(line, key, matches, responseColor);
}

interface RenderCodeBlockProps {
  content: string[];
  lang: string | null;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

const RenderCodeBlockInternal: React.FC<RenderCodeBlockProps> = ({
  content,
  lang,
  isPending,
  availableTerminalHeight,
  terminalWidth,
}) => {
  const settings = useSettings();
  const MIN_LINES_FOR_MESSAGE = 1; // Minimum lines to show before the "generating more" message
  const RESERVED_LINES = 2; // Lines reserved for the message itself and potential padding

  if (isPending && availableTerminalHeight !== undefined) {
    const MAX_CODE_LINES_WHEN_PENDING = Math.max(
      0,
      availableTerminalHeight - RESERVED_LINES,
    );

    if (content.length > MAX_CODE_LINES_WHEN_PENDING) {
      if (MAX_CODE_LINES_WHEN_PENDING < MIN_LINES_FOR_MESSAGE) {
        // Not enough space to even show the message meaningfully
        return (
          <Box paddingLeft={CODE_BLOCK_PREFIX_PADDING}>
            <Text color={theme.text.secondary}>
              ... code is being written ...
            </Text>
          </Box>
        );
      }
      const truncatedContent = content.slice(0, MAX_CODE_LINES_WHEN_PENDING);
      const colorizedTruncatedCode = colorizeCode(
        truncatedContent.join('\n'),
        lang,
        availableTerminalHeight,
        terminalWidth - CODE_BLOCK_PREFIX_PADDING,
        undefined,
        settings,
      );
      return (
        <Box paddingLeft={CODE_BLOCK_PREFIX_PADDING} flexDirection="column">
          {colorizedTruncatedCode}
          <Text color={theme.text.secondary}>... generating more ...</Text>
        </Box>
      );
    }
  }

  const fullContent = content.join('\n');
  const colorizedCode = colorizeCode(
    fullContent,
    lang,
    availableTerminalHeight,
    terminalWidth - CODE_BLOCK_PREFIX_PADDING,
    undefined,
    settings,
  );

  return (
    <Box
      paddingLeft={CODE_BLOCK_PREFIX_PADDING}
      flexDirection="column"
      width={terminalWidth}
      flexShrink={0}
    >
      {colorizedCode}
    </Box>
  );
};

const RenderCodeBlock = React.memo(RenderCodeBlockInternal);

interface RenderListItemProps {
  itemText: string;
  type: 'ul' | 'ol';
  marker: string;
  leadingWhitespace?: string;
}

const RenderListItemInternal: React.FC<RenderListItemProps> = ({
  itemText,
  type,
  marker,
  leadingWhitespace = '',
}) => {
  const prefix = type === 'ol' ? `${marker}. ` : `${marker} `;
  const prefixWidth = prefix.length;
  const indentation = leadingWhitespace.length;
  const listResponseColor = theme.text.response;

  return (
    <Box
      paddingLeft={indentation + LIST_ITEM_PREFIX_PADDING}
      flexDirection="row"
    >
      <Box width={prefixWidth}>
        <Text color={listResponseColor}>{prefix}</Text>
      </Box>
      <Box flexGrow={LIST_ITEM_TEXT_FLEX_GROW}>
        <Text wrap="wrap" color={listResponseColor}>
          <RenderInline text={itemText} defaultColor={listResponseColor} />
        </Text>
      </Box>
    </Box>
  );
};

const RenderListItem = React.memo(RenderListItemInternal);

interface RenderTableProps {
  headers: string[];
  rows: string[][];
  terminalWidth: number;
}

const RenderTableInternal: React.FC<RenderTableProps> = ({
  headers,
  rows,
  terminalWidth,
}) => (
  <TableRenderer headers={headers} rows={rows} terminalWidth={terminalWidth} />
);

const RenderTable = React.memo(RenderTableInternal);

export const MarkdownDisplay = React.memo(MarkdownDisplayInternal);
