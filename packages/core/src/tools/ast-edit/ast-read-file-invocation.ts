/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * AST Read File Tool Invocation - Handles execution of file read operations with context
 */

import * as path from 'path';
import {
  type ToolInvocation,
  type ToolLocation,
  type ToolResult,
} from '../tools.js';
import { ToolErrorType } from '../tool-error.js';
import { makeRelative, shortenPath } from '../../utils/paths.js';
import { isNodeError } from '../../utils/errors.js';
import { countLines } from '../../utils/fileUtils.js';
import type { Config } from '../../config/config.js';
import type { AnsiOutput } from '../../utils/terminalSerializer.js';

import type { ASTReadFileToolParams } from './types.js';
import { ASTConfig } from './ast-config.js';
import type { ASTContextCollector } from './context-collector.js';

export class ASTReadFileToolInvocation
  implements ToolInvocation<ASTReadFileToolParams, ToolResult>
{
  constructor(
    private readonly config: Config,
    public params: ASTReadFileToolParams,
    private readonly contextCollector: ASTContextCollector,
  ) {}

  toolLocations(): ToolLocation[] {
    return [{ path: this.params.file_path, line: this.params.offset }];
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.file_path,
      this.config.getTargetDir(),
    );
    return shortenPath(relativePath);
  }

  async shouldConfirmExecute(): Promise<false> {
    return false; // Read operations don't need confirmation
  }

  async execute(
    _signal?: AbortSignal,
    _updateOutput?: (output: string | AnsiOutput) => void,
    _terminalColumns?: number,
    _terminalRows?: number,
    _setPidCallback?: (pid: number) => void,
  ): Promise<ToolResult> {
    try {
      // Read file content
      const content = await this.config
        .getFileSystemService()
        .readTextFile(this.params.file_path);

      // Process line range
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

      // Collect enhanced context (same as ASTEdit)
      const workspaceRoot = this.config.getTargetDir();
      const enhancedContext =
        await this.contextCollector.collectEnhancedContext(
          this.params.file_path,
          content,
          workspaceRoot,
        );

      const readLlmContent = [
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
        enhancedContext.connectedFiles &&
        enhancedContext.connectedFiles.length > 0
          ? [
              '',
              'WORKING SET CONTEXT:',
              ...enhancedContext.connectedFiles
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
            ]
          : [],
      ]
        .flat()
        .filter(Boolean)
        .join('\n');

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
}
