/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Local context analysis functions for AST parsing and code snippet collection.
 */

import type { ASTNode, CodeSnippet, Declaration, ASTContext } from './types.js';
import { ASTConfig } from './ast-config.js';
import { KEYWORDS, COMMENT_PREFIXES } from './constants.js';
import { ContextOptimizer } from './context-optimizer.js';

/**
 * Parse AST from content using basic line-by-line analysis.
 * @param content - Source code content
 * @param language - Programming language
 * @returns Array of AST nodes
 */
export async function parseAST(
  content: string,
  language: string,
): Promise<ASTNode[]> {
  if (language === 'unknown') {
    return [];
  }

  // Use existing validateASTSyntax logic for basic parsing
  return extractASTNodes(content, language);
}

/**
 * Extract AST nodes from content by analyzing significant lines.
 * @param content - Source code content
 * @param language - Programming language
 * @returns Array of AST nodes
 */
export function extractASTNodes(content: string, language: string): ASTNode[] {
  // Simplified AST node extraction
  const nodes: ASTNode[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    if (isSignificantLine(line, language)) {
      nodes.push({
        type: inferNodeType(line, language),
        text: line.trim(),
        startPosition: { line: index + 1, column: 0 },
        endPosition: { line: index + 1, column: line.length },
        children: [],
      });
    }
  });

  return nodes;
}

/**
 * Collect code snippets from content, filtering out comments and short lines.
 * @param content - Source code content
 * @returns Array of code snippets sorted by relevance
 */
export function collectSnippets(content: string): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const isComment = COMMENT_PREFIXES.some((prefix) =>
      trimmed.startsWith(prefix),
    );
    if (trimmed.length > 10 && !isComment) {
      snippets.push({
        text: trimmed,
        relevance: calculateRelevance(trimmed),
        line: index + 1,
        source: 'local',
        priority: 3,
        charLength: trimmed.length,
      });
    }
  });

  return snippets
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, ASTConfig.MAX_SNIPPETS);
}

/**
 * Declaration types that represent struct-like / aggregate types for the
 * "classes" summary category, across all supported languages.
 */
const CLASS_LIKE_TYPES: ReadonlySet<Declaration['type']> = new Set([
  'class',
  'struct',
  'union',
  'enum',
  'trait',
  'impl',
]);

/**
 * Build language-specific context by deriving function, class, and variable
 * counts from AST declarations.
 *
 * The summary counts are derived from the declaration list produced by
 * {@link ASTQueryExtractor.extractDeclarations} (the tree-sitter-backed AST
 * path) rather than from per-language regex extractors. This keeps the
 * counts consistent with the `ENHANCED CONTEXT ANALYSIS` section shown to
 * the LLM and accurate for every supported language.
 *
 * @param declarations - AST declarations already parsed for the file
 * @returns Language context with one entry per matching declaration
 */
export function buildLanguageContext(
  declarations: Declaration[],
): ASTContext['languageContext'] {
  const functions: ASTContext['languageContext']['functions'] = [];
  const classes: ASTContext['languageContext']['classes'] = [];
  const variables: ASTContext['languageContext']['variables'] = [];

  for (const decl of declarations) {
    if (decl.type === 'function') {
      functions.push({
        name: decl.name,
        parameters: [],
        returnType: 'unknown',
        line: decl.line,
      });
    } else if (CLASS_LIKE_TYPES.has(decl.type)) {
      classes.push({
        name: decl.name,
        methods: [],
        properties: [],
        line: decl.line,
      });
    } else if (decl.type === 'variable') {
      variables.push({ name: decl.name, type: 'unknown', line: decl.line });
    }
  }

  return { functions, classes, variables };
}

/**
 * Check if a line is significant (non-comment, non-empty).
 * @param line - Source code line
 * @param _language - Programming language (unused but kept for signature compatibility)
 * @returns True if the line is significant
 */
const COMMENT_STARTS = ['//', '#', '*', '/*', '*/'];

export function isSignificantLine(line: string, _language: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const isComment = COMMENT_STARTS.some((prefix) => trimmed.startsWith(prefix));
  return !isComment;
}

/**
 * Infer the AST node type from a line of code.
 * @param line - Source code line
 * @param _language - Programming language (unused but kept for signature compatibility)
 * @returns Node type (function, class, control, return, statement)
 */
export function inferNodeType(line: string, _language: string): string {
  const trimmed = line.trim();
  if (trimmed.includes(KEYWORDS.FUNCTION) || trimmed.includes(KEYWORDS.DEF))
    return 'function';
  if (trimmed.includes(KEYWORDS.CLASS)) return 'class';
  if (
    trimmed.includes(KEYWORDS.IF) ||
    trimmed.includes(KEYWORDS.FOR) ||
    trimmed.includes(KEYWORDS.WHILE)
  )
    return 'control';
  if (trimmed.includes(KEYWORDS.RETURN)) return 'return';
  return 'statement';
}

/**
 * Calculate the relevance score of a code line.
 * @param line - Source code line
 * @returns Relevance score
 */
export function calculateRelevance(line: string): number {
  let relevance = 1;
  if (line.includes(KEYWORDS.FUNCTION) || line.includes(KEYWORDS.DEF))
    relevance += 3;
  if (line.includes(KEYWORDS.CLASS)) relevance += 2;
  if (line.includes(KEYWORDS.RETURN)) relevance += 1;
  if (line.length > 50) relevance += 1;
  return relevance;
}

/**
 * Optimize context collection by gathering declaration and local snippets.
 * @param declarations - Array of declarations
 * @param content - Source code content
 * @param _workspaceRoot - Workspace root path (unused but kept for signature compatibility)
 * @returns Optimized array of code snippets
 */
export function optimizeContextCollection(
  declarations: Declaration[],
  content: string,
  _workspaceRoot: string,
): CodeSnippet[] {
  const allSnippets: CodeSnippet[] = [];

  // Collect declaration snippets (highest priority)
  for (const decl of declarations) {
    allSnippets.push({
      text: `${decl.type}: ${decl.name}`,
      relevance: 5,
      line: decl.line,
      source: 'declaration',
      priority: 1,
      charLength: decl.name.length + decl.type.length + 2,
    });
  }

  // Collect local snippets
  const localSnippets = collectSnippets(content);
  allSnippets.push(
    ...localSnippets.map((snippet) => ({
      ...snippet,
      source: 'local' as const,
      priority: 2,
      charLength: snippet.text.length,
    })),
  );

  return ContextOptimizer.optimizeSnippets(allSnippets);
}
