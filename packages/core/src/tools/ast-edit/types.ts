/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ===== Core Context Interfaces =====
export interface ASTContext {
  filePath: string;
  language: string;
  fileSize: number;
  astNodes: ASTNode[];
  declarations: Declaration[];
  imports: Import[];
  relevantSnippets: CodeSnippet[];
  languageContext: {
    functions: FunctionInfo[];
    classes: ClassInfo[];
    variables: VariableInfo[];
  };
}

export interface ASTNode {
  type: string;
  text: string;
  startPosition: Position;
  endPosition: Position;
  children: ASTNode[];
}

export interface Declaration {
  name: string;
  type: 'function' | 'class' | 'variable' | 'import';
  line: number;
  column: number;
  signature?: string;
}

export interface CodeSnippet {
  text: string;
  relevance: number;
  line: number;
  source: 'declaration' | 'changed_file' | 'recent_file' | 'search' | 'local';
  priority: number;
  charLength: number;
}

export interface Import {
  module: string;
  items: string[];
  line: number;
}

export interface FunctionInfo {
  name: string;
  parameters: string[];
  returnType: string;
  line: number;
}

export interface ClassInfo {
  name: string;
  methods: string[];
  properties: string[];
  line: number;
}

export interface VariableInfo {
  name: string;
  type: string;
  line: number;
}

export interface Position {
  line: number;
  column: number;
}

export interface SgNode {
  range(): {
    start: Position;
    end: Position;
  };
}

// ===== Enhanced Context Interfaces (Phase 1-3) =====
export interface RepositoryContext {
  gitUrl: string;
  commitSha: string;
  branch: string;
  rootPath: string;
}

export interface SymbolReference {
  type: 'definition' | 'reference' | 'import';
  filePath: string;
  line: number;
  column: number;
  sourceModule?: string;
}

export interface FileContext {
  filePath: string;
  declarations: EnhancedDeclaration[];
  summary: string;
}

export interface CrossFileContext {
  files: FileContext[];
}

export interface ConnectedFile {
  filePath: string;
  declarations: EnhancedDeclaration[];
}

export interface EnhancedDeclaration extends Declaration {
  range: {
    start: Position;
    end: Position;
  };
  documentation?: string;
  visibility?: 'public' | 'private' | 'protected';
  signature?: string;
}

export interface EnhancedASTContext extends ASTContext {
  declarations: EnhancedDeclaration[];
  repositoryContext?: RepositoryContext;
  relatedFiles?: string[];
  relatedSymbols?: SymbolReference[];
  crossFileContext?: CrossFileContext;
  connectedFiles?: ConnectedFile[];
}

// ===== Simplified Parameter Interfaces =====
export interface ASTEditToolParams {
  /**
   * The absolute path to the file to modify
   */
  file_path: string;

  /**
   * The text to replace
   */
  old_string: string;

  /**
   * The text to replace it with
   */
  new_string: string;

  /**
   * Force execution after preview. Default is false.
   * IMPORTANT: This tool ALWAYS operates in two steps:
   * 1. First call: Preview changes (force: false or omitted)
   * 2. Second call: Apply changes (force: true)
   */
  force?: boolean;

  /**
   * Timestamp (ms) of the file when last read.
   * If provided, the tool will verify the file hasn't been modified since this time.
   */
  last_modified?: number;
}

// ===== ReadFile Parameter Interface =====
export interface ASTReadFileToolParams {
  /**
   * The absolute path to the file to read
   */
  file_path: string;

  /**
   * The line number to start reading from (optional)
   */
  offset?: number;

  /**
   * The number of lines to read (optional)
   */
  limit?: number;
}
