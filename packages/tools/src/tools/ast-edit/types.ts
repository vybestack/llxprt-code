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
  type:
    | 'function'
    | 'class'
    | 'variable'
    | 'import'
    | 'struct'
    | 'trait'
    | 'enum'
    | 'impl'
    | 'typedef'
    | 'union';
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
  readonly filePath: string;
  readonly declarations: readonly EnhancedDeclaration[];
}

// ===== Working-Set Acquisition Interfaces =====
export type WorkingSetPartialReason =
  | 'file-count'
  | 'source-bytes'
  | 'declarations'
  | 'cancelled'
  | 'git-error'
  | 'discovery-limit'
  | 'skipped-files';

/**
 * Bounded accounting for one working-set acquisition. Counts only — retained
 * declarations live in {@link ConnectedFile} entries and are never duplicated
 * here, so a partial result is described without a second copy of its data.
 *
 * Discriminated on {@link WorkingSetAcquisitionStatusBase.complete}: a
 * complete acquisition may not carry a partial reason, and an incomplete one
 * must carry exactly one.
 */
export interface WorkingSetAcquisitionStatusBase {
  /**
   * True only when the context is complete: every eligible working-set file
   * was observed, retained, and none was omitted. Any skip, early policy
   * stop, cancellation, Git failure, or discovery truncation makes this
   * false even when {@link traversalComplete} is true.
   */
  readonly complete: boolean;
  /**
   * True when the traversal itself ran to exhaustion: discovery completed
   * and no policy stop ended acquisition early. Distinct from context
   * completeness — a fully-traversed run with skips is traversal-complete
   * but partial.
   */
  readonly traversalComplete: boolean;
  /**
   * True when Git discovery stopped at its finite candidate cap: at least
   * {@link eligibleFiles} eligible files existed and more were never counted.
   */
  readonly discoveryTruncated: boolean;
  readonly retainedFiles: number;
  readonly retainedDeclarations: number;
  readonly retainedSourceBytes: number;
  /** Eligible working-set candidates observed (bounded by the discovery cap). */
  readonly eligibleFiles: number;
  /** Files skipped because reading failed (missing permissions, not a file). */
  readonly skippedFiles: number;
  /** Files skipped because one alone exceeds the aggregate byte budget. */
  readonly oversizedFiles: number;
  /** Files that Git reported but that no longer exist when acquisition ran. */
  readonly missingFiles: number;
}

/** A complete acquisition: nothing was omitted, so no partial reason exists. */
export interface CompleteWorkingSetAcquisitionStatus
  extends WorkingSetAcquisitionStatusBase {
  readonly complete: true;
  readonly partialReason?: undefined;
}

/** An incomplete acquisition: exactly one terminating reason is required. */
export interface PartialWorkingSetAcquisitionStatus
  extends WorkingSetAcquisitionStatusBase {
  readonly complete: false;
  readonly partialReason: WorkingSetPartialReason;
}

export type WorkingSetAcquisitionStatus =
  | CompleteWorkingSetAcquisitionStatus
  | PartialWorkingSetAcquisitionStatus;

/** Bounded working-set acquisition result: retained files plus accounting. */
export interface WorkingSetAcquisition {
  readonly files: readonly ConnectedFile[];
  readonly status: WorkingSetAcquisitionStatus;
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
  connectedFiles?: readonly ConnectedFile[];
  workingSetStatus?: WorkingSetAcquisitionStatus;
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
