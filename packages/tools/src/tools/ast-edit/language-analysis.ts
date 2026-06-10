/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import { ASTConfig } from './ast-config.js';
import { KEYWORDS, REGEX } from './constants.js';
import type { Import } from './types.js';

/**
 * Detects the programming language from a file path based on its extension.
 * @param filePath - The file path to analyze
 * @returns The detected language (e.g., 'typescript', 'python') or 'unknown'
 */
export function detectLanguage(filePath: string): string {
  const extension = path.extname(filePath).substring(1);
  return (
    ASTConfig.SUPPORTED_LANGUAGES[
      extension as keyof typeof ASTConfig.SUPPORTED_LANGUAGES
    ] || 'unknown'
  );
}

/**
 * Extracts import statements from source code.
 * @param content - The source code content
 * @param language - The programming language (typescript, javascript, python, etc.)
 * @returns Array of import declarations with module paths and imported items
 */
export function extractImports(content: string, language: string): Import[] {
  const imports: Import[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (
      (language === 'typescript' || language === 'javascript') &&
      trimmed.startsWith(KEYWORDS.IMPORT)
    ) {
      imports.push({
        module: extractImportModule(trimmed),
        items: extractImportItems(trimmed),
        line: index + 1,
      });
    } else if (
      language === 'python' &&
      (trimmed.startsWith(KEYWORDS.IMPORT) || trimmed.startsWith(KEYWORDS.FROM))
    ) {
      imports.push({
        module: extractPythonImportModule(trimmed),
        items: extractPythonImportItems(trimmed),
        line: index + 1,
      });
    }
  });

  return imports;
}

/**
 * Extracts the module path from an import statement.
 * @param line - The import statement line
 * @returns The module path or 'unknown' if not found
 */
function extractImportModule(line: string): string {
  const match = line.match(REGEX.IMPORT_MODULE);
  return match ? match[1] : 'unknown';
}

/**
 * Extracts the list of imported items from an import statement.
 * @param line - The import statement line
 * @returns Array of imported item names
 */
function extractImportItems(line: string): string[] {
  // Extract the contents of the first { ... } block using index scanning to
  // avoid polynomial backtracking on braces-heavy input.
  const open = line.indexOf('{');
  if (open !== -1) {
    const close = line.indexOf('}', open + 1);
    if (close > open + 1) {
      return line
        .slice(open + 1, close)
        .split(',')
        .map((item) => item.trim());
    }
  }
  return [];
}

/**
 * Extracts the module path from a Python import statement.
 * Handles: `import os`, `from pathlib import Path`, `from os.path import join`
 */
function extractPythonImportModule(line: string): string {
  // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
  const fromMatch = line.match(/^from\s+([\w.]+)\s+import/);
  if (fromMatch) {
    return fromMatch[1];
  }
  // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
  const importMatch = line.match(/^import\s+([\w.]+)/);
  if (importMatch) {
    return importMatch[1];
  }
  return 'unknown';
}

/**
 * Strips a trailing ` as <alias>` from a single import item using linear token
 * scanning (avoids regex backtracking on whitespace-heavy input).
 * Example: `join as j` -> `join`.
 */
function stripImportAlias(item: string): string {
  const tokens = item.split(/\s+/);
  if (
    tokens.length >= 3 &&
    tokens[tokens.length - 2] === 'as' &&
    /^\w+$/.test(tokens[tokens.length - 1])
  ) {
    return tokens.slice(0, tokens.length - 2).join(' ');
  }
  return item;
}

/**
 * Extracts imported items from a Python import statement.
 * Handles: `from typing import List, Dict`, `from os.path import join, exists`
 */
function extractPythonImportItems(line: string): string[] {
  // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
  const fromImportMatch = line.match(/^from\s+[\w.]+\s+import\s+(.+)/);
  if (fromImportMatch) {
    return fromImportMatch[1]
      .split(',')
      .map((item) => stripImportAlias(item.trim()))
      .filter((item) => item);
  }
  return [];
}
