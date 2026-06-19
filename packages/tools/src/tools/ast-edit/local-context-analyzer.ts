/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Local context analysis functions for AST parsing and code snippet collection.
 */

import type {
  ASTNode,
  CodeSnippet,
  Declaration,
  FunctionInfo,
  ClassInfo,
  VariableInfo,
  ASTContext,
} from './types.js';
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
 * Build language-specific context by extracting functions, classes, and variables.
 * @param content - Source code content
 * @param language - Programming language
 * @returns Language context with extracted elements
 */
export function buildLanguageContext(
  content: string,
  language: string,
): ASTContext['languageContext'] {
  return {
    functions: extractFunctions(content, language),
    classes: extractClasses(content, language),
    variables: extractVariables(content, language),
  };
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
 * Extract function declarations from content using regex.
 * @param content - Source code content
 * @param _language - Programming language
 * @returns Array of function information
 */
export function extractFunctions(
  content: string,
  _language: string,
): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (_language === 'typescript' || _language === 'javascript') {
      const info = extractJsFunction(trimmed);
      if (info) {
        functions.push({ ...info, line: index + 1 });
      }
    } else if (_language === 'python') {
      const info = extractPythonFunction(trimmed);
      if (info) {
        functions.push({ ...info, line: index + 1 });
      }
    }
  });

  return functions;
}

/**
 * Extract class declarations from content using regex.
 * @param content - Source code content
 * @param _language - Programming language
 * @returns Array of class information
 */
export function extractClasses(
  content: string,
  _language: string,
): ClassInfo[] {
  const classes: ClassInfo[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.includes(KEYWORDS.CLASS)) {
      const name = extractWordAfterPrefix(trimmed, KEYWORDS.CLASS);
      if (name) {
        classes.push({
          name,
          methods: [], // Simplified implementation
          properties: [], // Simplified implementation
          line: index + 1,
        });
      }
    }
  });

  return classes;
}

/**
 * Extract variable declarations from content using regex.
 * @param content - Source code content
 * @param _language - Programming language
 * @returns Array of variable information
 */
export function extractVariables(
  content: string,
  _language: string,
): VariableInfo[] {
  const variables: VariableInfo[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (_language === 'typescript' || _language === 'javascript') {
      const info = extractTypedVariable(trimmed);
      if (info) {
        variables.push({ ...info, line: index + 1 });
      }
    }
  });

  return variables;
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

const WORD_PATTERN = /^[A-Za-z_$][\w$]*/;

/**
 * Extracts a word identifier immediately following a prefix string using
 * linear scanning (avoids regex backtracking).
 */
function extractWordAfterPrefix(line: string, prefix: string): string | null {
  const idx = line.indexOf(prefix);
  if (idx === -1) {
    return null;
  }
  const after = line.slice(idx + prefix.length).trimStart();
  const match = after.match(WORD_PATTERN);
  return match ? match[0] : null;
}

/**
 * Parses parameters from a parenthesis-delimited string.
 */
function parseParameters(paramStr: string): string[] {
  return paramStr
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p);
}

/**
 * Extract a JS/TS function declaration: `function name(params): ReturnType`
 */
function extractJsFunction(trimmed: string): Omit<FunctionInfo, 'line'> | null {
  if (!trimmed.startsWith('function ')) {
    return null;
  }
  const name = extractWordAfterPrefix(trimmed, 'function ');
  if (!name) {
    return null;
  }
  const openParen = trimmed.indexOf('(', 'function '.length + name.length);
  if (openParen === -1) {
    return null;
  }
  const closeParen = trimmed.indexOf(')', openParen + 1);
  if (closeParen === -1) {
    return null;
  }
  const params = parseParameters(trimmed.slice(openParen + 1, closeParen));

  let returnType = 'unknown';
  const afterParens = trimmed.slice(closeParen + 1);
  if (afterParens.startsWith(':')) {
    const typeMatch = afterParens.slice(1).trimStart().match(WORD_PATTERN);
    if (typeMatch) {
      returnType = typeMatch[0];
    }
  }
  return { name, parameters: params, returnType };
}

/**
 * Extract a Python function declaration: `def name(params) -> ReturnType`
 */
function extractPythonFunction(
  trimmed: string,
): Omit<FunctionInfo, 'line'> | null {
  if (!trimmed.startsWith('def ')) {
    return null;
  }
  const name = extractWordAfterPrefix(trimmed, 'def ');
  if (!name) {
    return null;
  }
  const openParen = trimmed.indexOf('(', 'def '.length + name.length);
  if (openParen === -1) {
    return null;
  }
  const closeParen = trimmed.indexOf(')', openParen + 1);
  if (closeParen === -1) {
    return null;
  }
  const params = parseParameters(trimmed.slice(openParen + 1, closeParen));

  let returnType = 'unknown';
  const afterParens = trimmed.slice(closeParen + 1).trimStart();
  if (afterParens.startsWith('->')) {
    const typeMatch = afterParens.slice(2).trimStart().match(WORD_PATTERN);
    if (typeMatch) {
      returnType = typeMatch[0];
    }
  }
  return { name, parameters: params, returnType };
}

/**
 * Extract a typed variable declaration: `const name: Type`
 */
function extractTypedVariable(
  trimmed: string,
): Omit<VariableInfo, 'line'> | null {
  for (const keyword of ['const ', 'let ', 'var ']) {
    const result = tryTypedVariable(trimmed, keyword);
    if (result) {
      return result;
    }
  }
  return null;
}

function tryTypedVariable(
  trimmed: string,
  keyword: string,
): Omit<VariableInfo, 'line'> | null {
  if (!trimmed.startsWith(keyword)) {
    return null;
  }
  const name = extractWordAfterPrefix(trimmed, keyword);
  if (!name) {
    return null;
  }
  const nameEnd = keyword.length + name.length;
  const colonIdx = trimmed.indexOf(':', nameEnd);
  if (colonIdx === -1) {
    return null;
  }
  const typeMatch = trimmed
    .slice(colonIdx + 1)
    .trimStart()
    .match(WORD_PATTERN);
  if (!typeMatch) {
    return null;
  }
  return { name, type: typeMatch[0] };
}
