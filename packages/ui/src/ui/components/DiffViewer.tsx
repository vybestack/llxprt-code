import type { JSX } from 'react';
import { useMemo } from 'react';
import type { ThemeDefinition } from '../../features/theme';

interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'other';
  oldLine?: number;
  newLine?: number;
  content: string;
}

interface ParsedDiffState {
  currentOldLine: number;
  currentNewLine: number;
  inHunk: boolean;
}

// Precompiled regex - simpler pattern that's not vulnerable to backtracking
const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function isGitHeaderLine(line: string): boolean {
  return (
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename from') ||
    line.startsWith('rename to') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode')
  );
}

function parseHunkHeader(
  line: string,
): { oldStart: number; newStart: number } | null {
  const execResult = HUNK_HEADER_REGEX.exec(line);
  if (!execResult) {
    return null;
  }
  const oldMatch = execResult[1];
  const newMatch = execResult[2];
  if (oldMatch === undefined || newMatch === undefined) {
    return null;
  }
  return {
    oldStart: parseInt(oldMatch, 10) - 1,
    newStart: parseInt(newMatch, 10) - 1,
  };
}

function parseDiffLine(
  line: string,
  state: ParsedDiffState,
): { diffLine: DiffLine | null; newState: ParsedDiffState } {
  const hunk = parseHunkHeader(line);
  if (hunk) {
    return {
      diffLine: { type: 'hunk', content: line },
      newState: {
        currentOldLine: hunk.oldStart,
        currentNewLine: hunk.newStart,
        inHunk: true,
      },
    };
  }

  if (!state.inHunk || isGitHeaderLine(line)) {
    return { diffLine: null, newState: state };
  }

  if (line.startsWith('+')) {
    const newLine = state.currentNewLine + 1;
    return {
      diffLine: { type: 'add', newLine, content: line.substring(1) },
      newState: { ...state, currentNewLine: newLine },
    };
  }

  if (line.startsWith('-')) {
    const oldLine = state.currentOldLine + 1;
    return {
      diffLine: { type: 'del', oldLine, content: line.substring(1) },
      newState: { ...state, currentOldLine: oldLine },
    };
  }

  if (line.startsWith(' ')) {
    const oldLine = state.currentOldLine + 1;
    const newLine = state.currentNewLine + 1;
    return {
      diffLine: {
        type: 'context',
        oldLine,
        newLine,
        content: line.substring(1),
      },
      newState: { ...state, currentOldLine: oldLine, currentNewLine: newLine },
    };
  }

  if (line.startsWith('\\')) {
    return { diffLine: { type: 'other', content: line }, newState: state };
  }

  return { diffLine: null, newState: state };
}

function parseDiff(diffContent: string): DiffLine[] {
  const lines = diffContent.split('\n');
  const result: DiffLine[] = [];
  let state: ParsedDiffState = {
    currentOldLine: 0,
    currentNewLine: 0,
    inHunk: false,
  };

  for (const line of lines) {
    const { diffLine, newState } = parseDiffLine(line, state);
    state = newState;
    if (diffLine) {
      result.push(diffLine);
    }
  }
  return result;
}

export interface DiffViewerProps {
  readonly diffContent: string;
  readonly filename?: string;
  readonly maxHeight?: number;
  readonly theme?: ThemeDefinition;
}

interface DiffColors {
  addedBg: string;
  addedFg: string;
  removedBg: string;
  removedFg: string;
  contextFg: string;
  gutterFg: string;
  borderColor: string;
  primaryFg: string;
}

function getDefaultColors(): DiffColors {
  return {
    addedBg: '#1a3318',
    addedFg: '#00ff00',
    removedBg: '#3a1a1a',
    removedFg: '#ff6b6b',
    contextFg: '#888888',
    gutterFg: '#666666',
    borderColor: '#444444',
    primaryFg: '#ffffff',
  };
}

function getColorsFromTheme(theme: ThemeDefinition | undefined): DiffColors {
  if (!theme) {
    return getDefaultColors();
  }
  // Theme properties are guaranteed to exist per ThemeColors interface
  return {
    addedBg: theme.colors.diff.addedBg,
    addedFg: theme.colors.diff.addedFg,
    removedBg: theme.colors.diff.removedBg,
    removedFg: theme.colors.diff.removedFg,
    contextFg: theme.colors.text.muted,
    gutterFg: theme.colors.text.muted,
    borderColor: theme.colors.panel.border,
    primaryFg: theme.colors.text.primary,
  };
}

function getLinePrefix(lineType: DiffLine['type']): string {
  switch (lineType) {
    case 'add':
      return '+';
    case 'del':
      return '-';
    case 'context':
    case 'hunk':
    case 'other':
      return ' ';
  }
}

interface DiffLineProps {
  readonly line: DiffLine;
  readonly index: number;
  readonly gutterWidth: number;
  readonly colors: DiffColors;
}

function DiffLineRow({
  line,
  index,
  gutterWidth,
  colors,
}: DiffLineProps): JSX.Element {
  const lineNum = line.type === 'del' ? line.oldLine : line.newLine;
  const lineNumStr = (lineNum ?? '').toString().padStart(gutterWidth);
  const prefix = getLinePrefix(line.type);

  let lineFg = colors.contextFg;
  let lineBg: string | undefined;
  if (line.type === 'add') {
    lineFg = colors.addedFg;
    lineBg = colors.addedBg;
  } else if (line.type === 'del') {
    lineFg = colors.removedFg;
    lineBg = colors.removedBg;
  }

  const textProps =
    lineBg !== undefined ? { fg: lineFg, bg: lineBg } : { fg: lineFg };

  return (
    <box
      key={`diff-line-${index}`}
      flexDirection="row"
      style={{ width: '100%' }}
    >
      <text fg={colors.gutterFg}>{lineNumStr} </text>
      <text {...textProps}>
        {prefix} {line.content}
      </text>
    </box>
  );
}

export function DiffViewer(props: DiffViewerProps): JSX.Element {
  const { diffContent, filename, maxHeight = 15, theme } = props;

  const parsedLines = useMemo(() => parseDiff(diffContent), [diffContent]);
  const colors = useMemo(() => getColorsFromTheme(theme), [theme]);

  const displayableLines = useMemo(
    () => parsedLines.filter((l) => l.type !== 'hunk' && l.type !== 'other'),
    [parsedLines],
  );

  const gutterWidth = useMemo(() => {
    const maxLineNumber = Math.max(
      0,
      ...displayableLines.map((l) => l.oldLine ?? 0),
      ...displayableLines.map((l) => l.newLine ?? 0),
    );
    return Math.max(3, maxLineNumber.toString().length);
  }, [displayableLines]);

  if (!diffContent || diffContent.trim() === '') {
    return (
      <box border style={{ padding: 1, borderColor: colors.borderColor }}>
        <text fg={colors.contextFg}>No diff content.</text>
      </box>
    );
  }

  if (displayableLines.length === 0) {
    return (
      <box border style={{ padding: 1, borderColor: colors.borderColor }}>
        <text fg={colors.contextFg}>No changes detected.</text>
      </box>
    );
  }

  const needsScroll = displayableLines.length > maxHeight;

  const content = (
    <box flexDirection="column" style={{ gap: 0, width: '100%' }}>
      {filename && (
        <text key="filename" fg={colors.primaryFg}>
          <b>{filename}</b>
        </text>
      )}
      {displayableLines.map((line, index) => (
        <DiffLineRow
          key={`line-${index}`}
          line={line}
          index={index}
          gutterWidth={gutterWidth}
          colors={colors}
        />
      ))}
    </box>
  );

  if (needsScroll) {
    return (
      <scrollbox
        style={{
          height: maxHeight,
          maxHeight,
          borderColor: colors.borderColor,
          overflow: 'hidden',
        }}
        scrollY
        scrollX={false}
      >
        {content}
      </scrollbox>
    );
  }

  return content;
}
