/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Context collector orchestrates all AST context gathering operations.
 */

import { DebugLogger } from '../../debug/index.js';
import type {
  ASTContext,
  EnhancedASTContext,
  EnhancedDeclaration,
  SymbolReference,
} from './types.js';
import { ASTConfig } from './ast-config.js';
import { detectLanguage, extractImports } from './language-analysis.js';
import { ASTQueryExtractor } from './ast-query-extractor.js';
import { RepositoryContextProvider } from './repository-context-provider.js';
import {
  CrossFileRelationshipAnalyzer,
  getWorkspaceFiles,
} from './cross-file-analyzer.js';
import {
  parseAST,
  collectSnippets,
  buildLanguageContext,
  optimizeContextCollection,
} from './local-context-analyzer.js';
import { enrichWithWorkingSetContext } from './workspace-context-provider.js';

const logger = new DebugLogger('llxprt:tools:ast-edit:context-collector');

/**
 * Prioritize important symbols from declarations for lazy cross-file lookups.
 * [CCR] Reason: Prevents querying low-value symbols (like parameters or local vars) to preserve I/O.
 * @internal Exported for testing only. Not part of public API.
 */
export function prioritizeSymbolsFromDeclarations(
  declarations: EnhancedDeclaration[],
): string[] {
  const scores = new Map<string, number>();

  for (const decl of declarations) {
    if (decl.name.length < ASTConfig.MIN_SYMBOL_LENGTH) continue;

    let score = 0;
    if (decl.type === 'class') score += 10;
    if (decl.type === 'function') score += 5;
    if (score === 0) continue;
    if (decl.visibility === 'public') score += 3;

    scores.set(decl.name, (scores.get(decl.name) || 0) + score);
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, ASTConfig.MAX_RELATED_SYMBOLS);
}

/**
 * Orchestrates all AST context gathering: local analysis, working set, and cross-file relationships.
 */
export class ASTContextCollector {
  private astExtractor: ASTQueryExtractor;
  private repoProvider: RepositoryContextProvider;
  private relationshipAnalyzer: CrossFileRelationshipAnalyzer;

  constructor() {
    this.astExtractor = new ASTQueryExtractor();
    this.repoProvider = new RepositoryContextProvider();
    this.relationshipAnalyzer = new CrossFileRelationshipAnalyzer();
  }

  async collectContext(filePath: string, content: string): Promise<ASTContext> {
    const language = detectLanguage(filePath);

    return {
      filePath,
      language,
      fileSize: content.length,
      astNodes: await parseAST(content, language),
      declarations: await this.astExtractor.extractDeclarations(
        filePath,
        content,
      ),
      imports: extractImports(content, language),
      relevantSnippets: collectSnippets(content),
      languageContext: buildLanguageContext(content, language),
    };
  }

  async collectEnhancedContext(
    targetFilePath: string,
    content: string,
    workspaceRoot: string,
  ): Promise<EnhancedASTContext> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    // Base context
    const baseContext = await this.collectContext(targetFilePath, content);

    const enhancedContext: EnhancedASTContext = {
      ...baseContext,
      declarations: baseContext.declarations as EnhancedDeclaration[],
      connectedFiles: [],
    };

    // Phase 1: AST enhanced parsing (reuse declarations from base context)
    if (ASTConfig.ENABLE_AST_PARSING) {
      enhancedContext.declarations =
        baseContext.declarations as EnhancedDeclaration[];
    }

    // Context optimization
    enhancedContext.relevantSnippets = optimizeContextCollection(
      enhancedContext.declarations,
      content,
      workspaceRoot,
    );

    // Phase 2: Working Set Context (Git-based)
    const connectedFiles = await enrichWithWorkingSetContext(
      targetFilePath,
      workspaceRoot,
      this.repoProvider,
      this.astExtractor,
    );
    enhancedContext.connectedFiles = connectedFiles;

    // Phase 3: Repository context and Cross-file Relationships
    const repoContext =
      await this.repoProvider.collectRepositoryContext(workspaceRoot);
    enhancedContext.repositoryContext = repoContext || undefined;

    // [CCR] Relation: Cross-file relationship analysis segment.
    // Reason: Optimized to use on-demand findInFiles instead of eager indexing.
    if (repoContext != null) {
      if (ASTConfig.ENABLE_SYMBOL_INDEXING) {
        const workspaceFiles = await getWorkspaceFiles(workspaceRoot);
        await this.relationshipAnalyzer.buildSymbolIndex(workspaceFiles);

        const relatedFiles =
          await this.relationshipAnalyzer.findRelatedFiles(targetFilePath);
        enhancedContext.relatedFiles = relatedFiles;
      }

      // Prioritize symbols for Lazy search
      const topSymbols = prioritizeSymbolsFromDeclarations(
        enhancedContext.declarations,
      );

      // Execute atomic queries with strict limits and Survivability (Promise.allSettled)
      const relatedSymbolsTasks = topSymbols.map((symbol) =>
        this.relationshipAnalyzer.findRelatedSymbols(symbol, workspaceRoot),
      );

      const relatedSymbolsResults =
        await Promise.allSettled(relatedSymbolsTasks);
      enhancedContext.relatedSymbols = relatedSymbolsResults
        .filter(
          (r): r is PromiseFulfilledResult<SymbolReference[]> =>
            r.status === 'fulfilled',
        )
        .map((r) => r.value)
        .flat();
    }

    const duration = Date.now() - startTime;
    const memoryDelta =
      (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024;
    logger.debug(
      `collectEnhancedContext Metrics: ${duration}ms, Delta: ${memoryDelta.toFixed(2)}MB, Symbols: ${enhancedContext.relatedSymbols?.length || 0}`,
    );

    return enhancedContext;
  }
}
