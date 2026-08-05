/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { type ContentPartUnion } from '../types/wire-types.js';
import { ToolErrorType } from '../types/tool-error.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolLocation,
  type ToolResult,
} from './tools.js';
import type { IToolHost, IToolMessageBus } from '../interfaces/index.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { stringOrDefault } from '../utils/stringCoalescing.js';
import {
  processSingleFileContent,
  getSpecificMimeType,
  type ProcessedFileReadResult,
} from '../utils/fileUtils.js';
import { validatePathWithinWorkspace } from '../utils/pathValidation.js';
import type { GitLineChangeMarker } from '../utils/gitLineChanges.js';
import { getGitLineChanges } from '../utils/gitLineChanges.js';

/**
 * Parameters for the ReadLineRange tool
 */
export interface ReadLineRangeToolParams {
  /**
   * The absolute path to the file to read
   */
  absolute_path: string;

  /**
   * The 1-based line number to start reading from (inclusive)
   */
  start_line: number;

  /**
   * The 1-based line number to end reading at (inclusive)
   */
  end_line: number;

  /**
   * Alternative parameter name for absolute_path (for compatibility)
   */
  file_path?: string;

  /**
   * When true, prefixes each returned line with a virtual line number.
   */
  showLineNumbers?: boolean;

  /**
   * When true, prefixes each returned text line with a git-change marker column.
   */
  showGitChanges?: boolean;
}

function formatWithLineNumbers(content: string, startLine: number): string {
  const lines = content.split('\n');
  const maxLine = startLine + lines.length - 1;
  const width = Math.max(4, String(maxLine).length);
  return lines
    .map((line, index) => {
      const lineNo = startLine + index;
      const padded = String(lineNo).padStart(width, ' ');
      return `${padded}| ${line}`;
    })
    .join('\n');
}

function formatWithGitChanges(
  content: string,
  startLine: number,
  markers: Map<number, Exclude<GitLineChangeMarker, '░'>>,
  deletionAfterLines: Set<number>,
  showLineNumbers: boolean,
): string {
  const lines = content.split('\n');
  const maxLine = startLine + lines.length - 1;
  const width = showLineNumbers ? Math.max(4, String(maxLine).length) : 0;

  const formattedLines: string[] = [];

  const hasDeletionBeforeRange =
    deletionAfterLines.has(startLine - 1) ||
    deletionAfterLines.has(startLine) ||
    (startLine === 1 && deletionAfterLines.has(0));

  if (hasDeletionBeforeRange) {
    if (showLineNumbers) {
      const padded = ''.padStart(width, ' ');
      formattedLines.push(`D${padded}|`);
    } else {
      formattedLines.push('D');
    }
  }

  formattedLines.push(
    ...lines.map((line, index) => {
      const lineNo = startLine + index;
      const baseMarker: GitLineChangeMarker = markers.get(lineNo) ?? '░';
      const marker = deletionAfterLines.has(lineNo) ? 'D' : baseMarker;

      if (showLineNumbers) {
        const padded = String(lineNo).padStart(width, ' ');
        return `${marker}${padded}| ${line}`;
      }

      return `${marker}${line}`;
    }),
  );

  return formattedLines.join('\n');
}

/**
 * A processed read result narrowed to carry the numeric line-range fields that
 * text reads always populate. Used to avoid non-null assertions when reading
 * `linesShown`/`originalLineCount` (issue #3036).
 */
type LineRangeResult = ProcessedFileReadResult & {
  linesShown: [number, number];
  originalLineCount: number;
};

function hasLineRange(
  result: ProcessedFileReadResult,
): result is LineRangeResult {
  return (
    Array.isArray(result.linesShown) &&
    typeof result.originalLineCount === 'number'
  );
}

class ReadLineRangeToolInvocation extends BaseToolInvocation<
  ReadLineRangeToolParams,
  ToolResult
> {
  constructor(
    private host: IToolHost,
    params: ReadLineRangeToolParams,
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.absolute_path,
      this.host.getTargetDir(),
    );
    return shortenPath(relativePath);
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.params.absolute_path, line: this.params.start_line }];
  }

  private async fetchGitAnnotations(filePath: string): Promise<{
    gitWarning: string | undefined;
    markersByLine: Map<number, Exclude<GitLineChangeMarker, '░'>> | undefined;
    deletionAfterLines: Set<number> | undefined;
  }> {
    const gitResult = await getGitLineChanges(filePath);
    return {
      gitWarning: gitResult.warning,
      markersByLine: gitResult.markersByLine,
      deletionAfterLines: gitResult.deletionAfterLines,
    };
  }

  private applyTextFormatting(
    content: string,
    startLine: number,
    markersByLine: Map<number, Exclude<GitLineChangeMarker, '░'>> | undefined,
    deletionAfterLines: Set<number> | undefined,
  ): string {
    if (
      this.params.showGitChanges === true &&
      markersByLine &&
      deletionAfterLines
    ) {
      return formatWithGitChanges(
        content,
        startLine,
        markersByLine,
        deletionAfterLines,
        this.params.showLineNumbers === true,
      );
    }
    if (this.params.showLineNumbers === true) {
      return formatWithLineNumbers(content, startLine);
    }
    return content;
  }

  private prependGitHeader(
    llmContent: string,
    gitWarning: string | undefined,
  ): string {
    if (this.params.showGitChanges !== true) {
      return llmContent;
    }
    const headerParts: string[] = [];
    if (gitWarning) {
      headerParts.push(`NOTE: Failed to read git change status: ${gitWarning}`);
    }
    headerParts.push(
      'Git changes legend: ░ unchanged, N new, M modified, D deletion after line.',
    );
    return `${headerParts.join('\n')}\n\n${llmContent}`;
  }

  private buildRangeLlmContent(
    content: string,
    range: LineRangeResult,
    shortened: boolean,
    gitWarning: string | undefined,
    markersByLine: Map<number, Exclude<GitLineChangeMarker, '░'>> | undefined,
    deletionAfterLines: Set<number> | undefined,
  ): ContentPartUnion {
    const [start, end] = range.linesShown;
    const total = range.originalLineCount;

    const formattedContent = this.applyTextFormatting(
      content,
      this.params.start_line,
      markersByLine,
      deletionAfterLines,
    );

    const headerParts: string[] = [];
    if (this.params.showGitChanges === true) {
      if (gitWarning !== undefined) {
        headerParts.push(
          `NOTE: Failed to read git change status: ${gitWarning}`,
        );
      }
      headerParts.push(
        'Git changes legend: ░ unchanged, N new, M modified, D deletion after line.',
      );
    }
    if (shortened) {
      headerParts.push(
        'NOTE: Some lines were shortened because they exceed the maximum line length.',
      );
    }
    headerParts.push(
      `Status: Showing lines ${start}-${end} of ${total} total lines.`,
    );

    return `${headerParts.join('\n')}\n\n${formattedContent}`;
  }

  private buildFullLlmContent(
    content: string,
    gitWarning: string | undefined,
    markersByLine: Map<number, Exclude<GitLineChangeMarker, '░'>> | undefined,
    deletionAfterLines: Set<number> | undefined,
  ): ContentPartUnion {
    const formatted = this.applyTextFormatting(
      content,
      this.params.start_line,
      markersByLine,
      deletionAfterLines,
    );
    return this.prependGitHeader(formatted, gitWarning);
  }

  private recordReadMetric(
    llmContent: ContentPartUnion,
    filePath: string,
  ): void {
    const lines =
      typeof llmContent === 'string'
        ? llmContent.split('\n').length
        : undefined;
    const mimetype = getSpecificMimeType(filePath);
    void lines;
    void mimetype;
    void filePath;
  }

  private startBeyondEofResult(totalLines: number): ToolResult {
    const lineWord = totalLines === 1 ? 'line' : 'lines';
    const message = `start_line ${this.params.start_line} is beyond end of file (${totalLines} ${lineWord})`;
    return {
      llmContent: message,
      returnDisplay: message,
      error: {
        message,
        type: ToolErrorType.INVALID_TOOL_PARAMS,
      },
    };
  }

  private assembleContent(
    result: ProcessedFileReadResult,
    gitWarning: string | undefined,
    markersByLine: Map<number, Exclude<GitLineChangeMarker, '░'>> | undefined,
    deletionAfterLines: Set<number> | undefined,
  ): ContentPartUnion {
    if (typeof result.llmContent !== 'string') {
      return result.llmContent;
    }
    const content = result.llmContent;
    if (result.isTruncated === true && hasLineRange(result)) {
      return this.buildRangeLlmContent(
        content,
        result,
        result.linesShortened === true,
        gitWarning,
        markersByLine,
        deletionAfterLines,
      );
    }
    return this.buildFullLlmContent(
      content,
      gitWarning,
      markersByLine,
      deletionAfterLines,
    );
  }

  async execute(): Promise<ToolResult> {
    const offset = this.params.start_line - 1;
    const limit = this.params.end_line - this.params.start_line + 1;

    const result = await processSingleFileContent(
      this.params.absolute_path,
      this.host.getTargetDir(),
      offset,
      limit,
    );

    if (result.error) {
      return {
        llmContent: result.llmContent,
        returnDisplay: result.returnDisplay || 'Error reading file',
        error: { message: result.error, type: result.errorType },
      };
    }

    if (
      typeof result.llmContent === 'string' &&
      hasLineRange(result) &&
      this.params.start_line > result.originalLineCount
    ) {
      return this.startBeyondEofResult(result.originalLineCount);
    }

    const gitAnnotations = await this.loadGitAnnotations(result);
    const llmContent = this.assembleContent(
      result,
      gitAnnotations.gitWarning,
      gitAnnotations.markersByLine,
      gitAnnotations.deletionAfterLines,
    );

    this.recordReadMetric(result.llmContent, this.params.absolute_path);

    return {
      llmContent,
      returnDisplay: result.returnDisplay || '',
    };
  }

  private async loadGitAnnotations(result: ProcessedFileReadResult): Promise<{
    gitWarning: string | undefined;
    markersByLine: Map<number, Exclude<GitLineChangeMarker, '░'>> | undefined;
    deletionAfterLines: Set<number> | undefined;
  }> {
    if (
      this.params.showGitChanges !== true ||
      typeof result.llmContent !== 'string'
    ) {
      return {
        gitWarning: undefined,
        markersByLine: undefined,
        deletionAfterLines: undefined,
      };
    }
    return this.fetchGitAnnotations(this.params.absolute_path);
  }
}

/**
 * Implementation of the ReadLineRange tool logic
 */
export class ReadLineRangeTool extends BaseDeclarativeTool<
  ReadLineRangeToolParams,
  ToolResult
> {
  static readonly Name: string = 'read_line_range';

  constructor(private host: IToolHost) {
    super(
      ReadLineRangeTool.Name,
      'ReadLineRange',
      `Reads a specific range of lines from a file. This is very useful for "copying" a function or class after finding its definition. The 'start_line' and 'end_line' parameters are 1-based and inclusive.

Optional: when 'showGitChanges' is true, prefixes each returned text line with a single-character git-change marker column and includes a legend.
Legend: '░' unchanged, 'N' new, 'M' modified, 'D' deletion after line.
Column order: git marker first, then (optional) virtual line number column, then line content.
The git marker column is virtual and not part of the file content.
If git status cannot be read, the tool will still return file content and include a brief warning.`,
      Kind.Read,
      {
        properties: {
          absolute_path: {
            description:
              "The absolute path to the file to read (e.g., '/home/user/project/file.txt'). Relative paths are not supported. You must provide an absolute path.",
            type: 'string',
          },
          file_path: {
            description:
              'Alternative parameter name for absolute_path (for backward compatibility). The absolute path to the file to read.',
            type: 'string',
          },
          start_line: {
            description:
              'The 1-based line number to start reading from (inclusive).',
            type: 'number',
            minimum: 1,
          },
          end_line: {
            description:
              'The 1-based line number to end reading at (inclusive). Must be >= start_line.',
            type: 'number',
            minimum: 1,
          },
          showLineNumbers: {
            description:
              'Optional: When true, prefixes each returned line with its 1-based virtual line number and a separator bar (for example, " 294| const x = 1;"). This numbering is not part of the underlying file; it is only a visual aid. Recommended when you need to precisely understand line numbers in large files for follow-up editing operations.',
            type: 'boolean',
          },
          showGitChanges: {
            description:
              "Optional: When true (text files only), prefixes each returned line with a single-character git-change marker column computed relative to HEAD (includes both staged and unstaged changes). This marker column is virtual and not part of the file content. Legend: '░' unchanged, 'N' new, 'M' modified, 'D' deletion after line. Column order: git marker first, then (optional) the virtual line number column, then line content. If git status cannot be read, content is still returned and a brief warning is included.",
            type: 'boolean',
          },
        },
        required: ['start_line', 'end_line'],
        type: 'object',
      },
    );
  }

  protected override validateToolParamValues(
    params: ReadLineRangeToolParams,
  ): string | null {
    const filePath = stringOrDefault(
      params.absolute_path,
      stringOrDefault(params.file_path, ''),
    );
    if (filePath.trim() === '') {
      return "Either 'absolute_path' or 'file_path' parameter must be provided and non-empty.";
    }

    if (!path.isAbsolute(filePath)) {
      return `File path must be absolute: ${filePath}`;
    }

    const pathError = validatePathWithinWorkspace(
      this.host.getWorkspaceRoots(),
      filePath,
    );
    if (pathError) {
      return pathError;
    }

    if (params.start_line < 1) {
      return 'start_line must be a positive integer (>= 1)';
    }

    if (params.end_line < 1) {
      return 'end_line must be a positive integer (>= 1)';
    }

    if (params.end_line < params.start_line) {
      return 'end_line must be greater than or equal to start_line';
    }

    const fileService = this.host.getFileService();
    if (fileService.shouldLlxprtIgnoreFile(filePath)) {
      return `File path '${filePath}' is ignored by .llxprtignore pattern(s).`;
    }

    return null;
  }

  protected createInvocation(
    params: ReadLineRangeToolParams,
    messageBus: IToolMessageBus,
  ): ToolInvocation<ReadLineRangeToolParams, ToolResult> {
    const normalizedParams = { ...params };
    if (!normalizedParams.absolute_path && normalizedParams.file_path) {
      normalizedParams.absolute_path = normalizedParams.file_path;
    }
    return new ReadLineRangeToolInvocation(
      this.host,
      normalizedParams,
      messageBus,
    );
  }
  async execute(
    params: ReadLineRangeToolParams,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ToolResult> {
    const result = await this.build(params).execute(signal);
    if (typeof result.llmContent === 'string') {
      return { ...result, returnDisplay: result.llmContent };
    }
    return result;
  }
}
