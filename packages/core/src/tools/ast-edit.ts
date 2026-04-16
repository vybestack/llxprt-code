/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * ## Change Log
 * - 2025-01-19: Performance Optimization (Phase 2)
 *   - Disabled eager symbol indexing by default (ENABLE_SYMBOL_INDEXING = false).
 *   - Implemented 'Lazy' on-demand `findInFiles` queries with strict limits.
 *   - Added `prioritizeSymbolsFromDeclarations` for smarter symbol selection.
 *   - Added timeout mechanism and `Promise.allSettled` for fault tolerance.
 *   - Added performance metrics logging (duration, memory delta).
 *   - Added env-based override: LLXPRT_ENABLE_SYMBOL_INDEXING.
 *   - Added MAX_WORKSPACE_FILES guard to prevent OOM in large repos.
 */

import * as path from 'path';
import type { ToolInvocation } from './tools.js';
import { BaseDeclarativeTool, Kind, type ToolResult } from './tools.js';
import { isNodeError } from '../utils/errors.js';
import type { Config } from '../config/config.js';
import type {
  ModifiableDeclarativeTool,
  ModifyContext,
} from './modifiable-tool.js';

// Import types and constants from extracted modules
import type {
  EnhancedDeclaration,
  ASTEditToolParams,
  ASTReadFileToolParams,
} from './ast-edit/types.js';

import {
  KEYWORDS,
  COMMENT_PREFIXES,
  REGEX,
  LANGUAGE_MAP,
  JAVASCRIPT_FAMILY_EXTENSIONS,
} from './ast-edit/constants.js';

import { ASTContextCollector } from './ast-edit/context-collector.js';
import { applyReplacement } from './ast-edit/edit-helpers.js';
import { ASTEditToolInvocation } from './ast-edit/ast-edit-invocation.js';
import { ASTReadFileToolInvocation } from './ast-edit/ast-read-file-invocation.js';
import { validatePathWithinWorkspace } from '../safety/index.js';

// Re-export types and constants for external consumers
export type { EnhancedDeclaration, ASTEditToolParams, ASTReadFileToolParams };
export {
  KEYWORDS,
  COMMENT_PREFIXES,
  REGEX,
  LANGUAGE_MAP,
  JAVASCRIPT_FAMILY_EXTENSIONS,
};

// ===== ASTEdit Tool Implementation =====
export class ASTEditTool
  extends BaseDeclarativeTool<ASTEditToolParams, ToolResult>
  implements ModifiableDeclarativeTool<ASTEditToolParams>
{
  static readonly Name = 'ast_edit';
  private contextCollector: ASTContextCollector;

  static applyReplacement = applyReplacement;

  constructor(private readonly config: Config) {
    super(
      ASTEditTool.Name,
      'ASTEdit',
      `Enhanced edit tool with intelligent context awareness. Performs precise text replacement with validation.

      Replaces exact text matches in files with comprehensive analysis:
      - AST syntax validation and structure analysis
      - Context-aware suggestions and related code
      - File freshness and safety checks
      - Preview before applying changes

      **Parameters:**
      - file_path: Absolute path to the file to modify
      - old_string: Text to replace (must match exactly)
      - new_string: Replacement text`,
      Kind.Edit,
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to modify. Must start with '/'.",
            type: 'string',
          },
          old_string: {
            description:
              'The exact literal text to replace. Must match existing content exactly including whitespace and indentation.',
            type: 'string',
          },
          new_string: {
            description:
              'The exact literal text to replace old_string with. Provide the complete replacement text.',
            type: 'string',
          },
          force: {
            type: 'boolean',
            description: 'Internal execution control. Managed automatically.',
            default: false,
          },
          last_modified: {
            type: 'number',
            description:
              'Timestamp of the file when last read. Used for concurrency control.',
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
        type: 'object',
      },
    );

    this.contextCollector = new ASTContextCollector();
  }

  protected override validateToolParamValues(
    params: ASTEditToolParams,
  ): string | null {
    if (!params.file_path) {
      return "The 'file_path' parameter must be non-empty.";
    }

    if (!path.isAbsolute(params.file_path)) {
      return `File path must be absolute: ${params.file_path}`;
    }

    const workspaceContext = this.config.getWorkspaceContext();
    const pathError = validatePathWithinWorkspace(
      workspaceContext,
      params.file_path,
    );
    if (pathError) {
      return pathError;
    }

    return null;
  }

  protected createInvocation(
    params: ASTEditToolParams,
  ): ToolInvocation<ASTEditToolParams, ToolResult> {
    return new ASTEditToolInvocation(
      this.config,
      params,
      this.contextCollector,
    );
  }

  getModifyContext(_: AbortSignal): ModifyContext<ASTEditToolParams> {
    return {
      getFilePath: (params: ASTEditToolParams) => params.file_path,
      getCurrentContent: async (params: ASTEditToolParams): Promise<string> => {
        try {
          return await this.config
            .getFileSystemService()
            .readTextFile(params.file_path);
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      getProposedContent: async (
        params: ASTEditToolParams,
      ): Promise<string> => {
        try {
          const currentContent = await this.config
            .getFileSystemService()
            .readTextFile(params.file_path);
          return ASTEditTool.applyReplacement(
            currentContent,
            params.old_string,
            params.new_string,
            false,
          );
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return params.new_string;
        }
      },
      createUpdatedParams: (
        oldContent: string,
        modifiedProposedContent: string,
        originalParams: ASTEditToolParams,
      ): ASTEditToolParams => ({
        ...originalParams,
        old_string: oldContent,
        new_string: modifiedProposedContent,
      }),
    };
  }
}

// ===== ASTReadFile Tool Implementation =====
export class ASTReadFileTool extends BaseDeclarativeTool<
  ASTReadFileToolParams,
  ToolResult
> {
  static readonly Name = 'ast_read_file';
  private contextCollector: ASTContextCollector;

  constructor(private readonly config: Config) {
    super(
      ASTReadFileTool.Name,
      'ASTReadFile',
      `Enhanced file reading with AST-inspired context analysis. Reads file content with intelligent context extraction.

      **Context-Aware Features:**
      - Language detection and AST structure analysis
      - Function/class/variable declaration extraction  
      - Relevant code snippet collection
      - Language-specific context information

      **Parameters:**
      - file_path: Absolute path to the file to read
      - offset: Line number to start reading from (optional)
      - limit: Number of lines to read (optional)`,
      Kind.Read,
      {
        properties: {
          file_path: {
            description:
              "The absolute path to the file to read. Must start with '/'.",
            type: 'string',
          },
          offset: {
            type: 'number',
            description:
              'The line number to start reading from (1-based, optional).',
            minimum: 1,
          },
          limit: {
            type: 'number',
            description: 'The number of lines to read (optional).',
            minimum: 1,
          },
        },
        required: ['file_path'],
        type: 'object',
      },
    );

    this.contextCollector = new ASTContextCollector();
  }

  protected override validateToolParamValues(
    params: ASTReadFileToolParams,
  ): string | null {
    if (!params.file_path) {
      return "The 'file_path' parameter must be non-empty.";
    }

    if (!path.isAbsolute(params.file_path)) {
      return `File path must be absolute: ${params.file_path}`;
    }

    const workspaceContext = this.config.getWorkspaceContext();
    const pathError = validatePathWithinWorkspace(
      workspaceContext,
      params.file_path,
    );
    if (pathError) {
      return pathError;
    }

    return null;
  }

  protected createInvocation(
    params: ASTReadFileToolParams,
  ): ToolInvocation<ASTReadFileToolParams, ToolResult> {
    return new ASTReadFileToolInvocation(
      this.config,
      params,
      this.contextCollector,
    );
  }
}
