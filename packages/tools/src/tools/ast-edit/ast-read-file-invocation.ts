/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * AST Read File Tool Invocation - Handles execution of file read operations with context
 */

import * as path from 'path';
import fs from 'fs';
import {
  type ToolInvocation,
  type ToolLocation,
  type ToolResult,
} from '../tools.js';
import { ToolErrorType } from '../../types/tool-error.js';
import { makeRelative, shortenPath } from '../../utils/paths.js';
import { isNodeError } from '../../utils/errors.js';
import {
  countLines,
  statFileSizeGate,
  validateFileSizeBytes,
} from '../../utils/fileUtils.js';
import type { IToolHost } from '../../interfaces/index.js';
import type { LiveOutputUpdate } from '../../utils/terminalSerializer.js';

import type {
  ASTReadFileToolParams,
  WorkingSetAcquisitionStatus,
  WorkingSetPartialReason,
} from './types.js';
import { ASTConfig } from './ast-config.js';
import type { ASTContextCollector } from './context-collector.js';
import {
  MAX_WORKING_SET_DECLARATIONS,
  MAX_WORKING_SET_FILES,
} from './workspace-context-provider.js';

/**
 * Rendered phrase per partial reason. The Record over the full
 * WorkingSetPartialReason union is compile-time exhaustive: a future union
 * member without a phrase fails typecheck instead of silently rendering a
 * generic fallback at runtime.
 */
const WORKING_SET_PARTIAL_PHRASES: Readonly<
  Record<WorkingSetPartialReason, string>
> = {
  'file-count': `stopped at the file-count limit (${MAX_WORKING_SET_FILES})`,
  'source-bytes': 'stopped at the aggregate source-byte budget',
  declarations: `stopped at the retained-declaration limit (${MAX_WORKING_SET_DECLARATIONS})`,
  cancelled: 'cancelled before completion',
  'git-error': 'stopped because Git working-set discovery failed',
  'discovery-limit': 'stopped at the working-set discovery limit',
  'skipped-files': 'partial because eligible working-set files were skipped',
};

function workingSetPartialPhrase(
  reason: WorkingSetPartialReason | undefined,
): string {
  if (reason === undefined) {
    return 'stopped early';
  }
  return WORKING_SET_PARTIAL_PHRASES[reason];
}

/**
 * Eligible-file count for the partial header. When discovery was truncated,
 * the file-count policy stopped acquisition, Git discovery failed after
 * candidates were observed, or cancellation stopped acquisition mid-run, the
 * counted candidates are only a lower bound on the true eligible set.
 */
function eligibleFilesPhrase(status: WorkingSetAcquisitionStatus): string {
  const isLowerBound =
    status.discoveryTruncated ||
    status.partialReason === 'file-count' ||
    status.partialReason === 'git-error' ||
    status.partialReason === 'cancelled';
  return isLowerBound
    ? `at least ${status.eligibleFiles}`
    : String(status.eligibleFiles);
}

/** Bounded skip accounting rendered to the model alongside partial context. */
function skipAccountingLines(
  status: WorkingSetAcquisitionStatus | undefined,
): string[] {
  if (status === undefined) {
    return [];
  }
  const skippedParts: string[] = [];
  if (status.oversizedFiles > 0) {
    skippedParts.push(`${status.oversizedFiles} oversized`);
  }
  if (status.skippedFiles > 0) {
    skippedParts.push(`${status.skippedFiles} unreadable`);
  }
  if (status.missingFiles > 0) {
    skippedParts.push(`${status.missingFiles} missing`);
  }
  return skippedParts.length > 0
    ? [`- (skipped: ${skippedParts.join(', ')})`]
    : [];
}

export class ASTReadFileToolInvocation
  implements ToolInvocation<ASTReadFileToolParams, ToolResult>
{
  constructor(
    private readonly host: IToolHost,
    public params: ASTReadFileToolParams,
    private readonly contextCollector: ASTContextCollector,
  ) {}

  toolLocations(): ToolLocation[] {
    return [{ path: this.params.file_path, line: this.params.offset }];
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.file_path,
      this.host.getTargetDir(),
    );
    return shortenPath(relativePath);
  }

  async shouldConfirmExecute(): Promise<false> {
    return false; // Read operations don't need confirmation
  }

  async execute(
    signal?: AbortSignal,
    _updateOutput?: (update: LiveOutputUpdate) => void,
    _terminalColumns?: number,
    _terminalRows?: number,
    _setPidCallback?: (pid: number) => void,
  ): Promise<ToolResult> {
    try {
      const sizeError = await statFileSizeGate(this.params.file_path);
      if (sizeError) {
        return {
          llmContent: sizeError.message,
          returnDisplay: sizeError.message,
          error: { message: sizeError.message, type: sizeError.type },
        };
      }
      const fileSystemService = this.host.getFileSystemService?.() as
        | { readTextFile?: (filePath: string) => Promise<string> }
        | undefined;
      const content = fileSystemService?.readTextFile
        ? await fileSystemService.readTextFile(this.params.file_path)
        : await fs.promises.readFile(this.params.file_path, 'utf-8');

      // Validate authoritative content immediately after acquisition: a host
      // file service may return bytes divergent from native stat, so the same
      // shared byte-size primitive is applied here before parsing/copying.
      const contentGate = validateFileSizeBytes(
        this.params.file_path,
        Buffer.byteLength(content),
      );
      if (contentGate) {
        return {
          llmContent: contentGate.message,
          returnDisplay: contentGate.message,
          error: { message: contentGate.message, type: contentGate.type },
        };
      }

      const { selectedContent, startLine, endLine, totalLineCount } =
        this.computeLineRange(content);

      const workspaceRoot = this.host.getTargetDir();
      const enhancedContext =
        await this.contextCollector.collectEnhancedContext(
          this.params.file_path,
          content,
          workspaceRoot,
          {
            // The read path renders none of the repository/related-symbol
            // results, so their native whole-workspace searches are opted
            // out; local analysis and the working set are still collected.
            collectRepositoryContext: false,
            signal,
          },
        );

      const readLlmContent = this.buildReadLlmContent(
        enhancedContext,
        workspaceRoot,
        startLine,
        endLine,
        totalLineCount,
      );

      return {
        llmContent: readLlmContent,
        returnDisplay: {
          content: selectedContent,
          fileName: path.basename(this.params.file_path),
          filePath: this.params.file_path,
          metadata: {
            language: enhancedContext.language,
            declarationsCount: enhancedContext.declarations.length,
          },
        },
      };
    } catch (error) {
      return this.handleReadError(error);
    }
  }

  private computeLineRange(content: string): {
    selectedContent: string;
    startLine: number;
    endLine: number;
    totalLineCount: number;
  } {
    const lines = content.split('\n');
    const totalLineCount = countLines(lines);
    const startLine = Math.min(
      typeof this.params.offset === 'number' && this.params.offset > 0
        ? Math.max(1, this.params.offset) - 1
        : 0,
      totalLineCount,
    );
    const endLine =
      typeof this.params.limit === 'number' && this.params.limit > 0
        ? Math.min(totalLineCount, startLine + this.params.limit)
        : totalLineCount;
    const selectedContent = lines.slice(startLine, endLine).join('\n');
    return { selectedContent, startLine, endLine, totalLineCount };
  }

  private buildReadLlmContent(
    enhancedContext: Awaited<
      ReturnType<ASTContextCollector['collectEnhancedContext']>
    >,
    workspaceRoot: string,
    startLine: number,
    endLine: number,
    totalLineCount: number,
  ): string {
    return [
      `LLXPRT READ: ${this.params.file_path}`,
      `- Language: ${enhancedContext.language}`,
      `- Lines ${Math.min(startLine + 1, totalLineCount)}-${endLine} of ${totalLineCount}`,
      `- Declarations: ${enhancedContext.declarations.length}`,
      '',
      'CONTEXT ANALYSIS:',
      ...enhancedContext.declarations.map(
        (decl) =>
          `- ${decl.type}: ${decl.name}${decl.signature ?? ''} (line ${decl.line})`,
      ),
      '',
      'RELEVANT SNIPPETS:',
      ...enhancedContext.relevantSnippets
        .slice(0, ASTConfig.MAX_DISPLAY_RESULTS)
        .map(
          (snippet) =>
            `- Line ${snippet.line}: ${snippet.text.substring(0, 60)}...`,
        ),
      this.formatConnectedFilesContext(enhancedContext, workspaceRoot),
    ]
      .flat()
      .filter(Boolean)
      .join('\n');
  }

  private formatConnectedFilesContext(
    enhancedContext: Awaited<
      ReturnType<ASTContextCollector['collectEnhancedContext']>
    >,
    workspaceRoot: string,
  ): string[] {
    const status = enhancedContext.workingSetStatus;
    const connectedFiles = enhancedContext.connectedFiles ?? [];
    if (connectedFiles.length === 0) {
      if (status !== undefined && !status.complete) {
        return [
          '',
          `WORKING SET CONTEXT (partial: ${workingSetPartialPhrase(status.partialReason)}; no working-set files retained):`,
          ...skipAccountingLines(status),
        ];
      }
      return [];
    }
    const header =
      status !== undefined && !status.complete
        ? `WORKING SET CONTEXT (partial: ${workingSetPartialPhrase(status.partialReason)}; retained ${status.retainedFiles} of ${eligibleFilesPhrase(status)} files, ${status.retainedDeclarations} declarations, ${status.retainedSourceBytes} source bytes):`
        : 'WORKING SET CONTEXT:';
    return [
      '',
      header,
      ...skipAccountingLines(status),
      ...connectedFiles
        .map((file) => {
          const relPath = makeRelative(file.filePath, workspaceRoot);
          if (file.declarations.length === 0)
            return `- ${relPath} (No declarations)`;
          return [
            `- ${relPath}:`,
            ...file.declarations.map(
              (d) => `  - ${d.type}: ${d.name}${d.signature ?? ''}`,
            ),
          ];
        })
        .flat(),
    ];
  }

  private handleReadError(error: unknown): ToolResult {
    const errorMsg = error instanceof Error ? error.message : String(error);

    let errorType = ToolErrorType.READ_CONTENT_FAILURE;
    if (isNodeError(error)) {
      switch (error.code) {
        case 'ENOENT':
          errorType = ToolErrorType.FILE_NOT_FOUND;
          break;
        case 'EACCES':
          errorType = ToolErrorType.PERMISSION_DENIED;
          break;
        case 'EISDIR':
          errorType = ToolErrorType.TARGET_IS_DIRECTORY;
          break;
        case 'EMFILE':
        case 'ENFILE':
          errorType = ToolErrorType.READ_CONTENT_FAILURE;
          break;
        default:
          errorType = ToolErrorType.READ_CONTENT_FAILURE;
      }
    } else {
      errorType = ToolErrorType.UNKNOWN;
    }

    return {
      llmContent: `Error reading file: ${errorMsg}`,
      returnDisplay: `Error reading file: ${errorMsg}`,
      error: {
        message: errorMsg,
        type: errorType,
      },
    };
  }
}
