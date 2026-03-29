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
    if (language === 'typescript' || language === 'javascript') {
      if (trimmed.startsWith(KEYWORDS.IMPORT)) {
        imports.push({
          module: extractImportModule(trimmed),
          items: extractImportItems(trimmed),
          line: index + 1,
        });
      }
    } else if (language === 'python') {
      if (
        trimmed.startsWith(KEYWORDS.IMPORT) ||
        trimmed.startsWith(KEYWORDS.FROM)
      ) {
        imports.push({
          module: extractPythonImportModule(trimmed),
          items: extractPythonImportItems(trimmed),
          line: index + 1,
        });
      }
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
  const match = RegExp(REGEX.IMPORT_MODULE).exec(line);
  return match != null ? match[1] : 'unknown';
}

/**
 * Extracts the list of imported items from an import statement.
 * @param line - The import statement line
 * @returns Array of imported item names
 */
function extractImportItems(line: string): string[] {
  const match = RegExp(REGEX.IMPORT_ITEMS).exec(line);
  if (match != null) {
    return match[1].split(',').map((item) => item.trim());
  }
  return [];
}

/**
 * Extracts the module path from a Python import statement.
 * Handles: `import os`, `from pathlib import Path`, `from os.path import join`
 */
function extractPythonImportModule(line: string): string {
  const fromMatch = RegExp(/^from\s+([\w.]+)\s+import/).exec(line);
  if (fromMatch != null) {
    return fromMatch[1];
  }
  const importMatch = RegExp(/^import\s+([\w.]+)/).exec(line);
  if (importMatch != null) {
    return importMatch[1];
  }
  return 'unknown';
}

/**
 * Extracts imported items from a Python import statement.
 * Handles: `from typing import List, Dict`, `from os.path import join, exists`
 */
function extractPythonImportItems(line: string): string[] {
  const fromImportMatch = RegExp(/^from\s+[\w.]+\s+import\s+(.+)/).exec(line);
  if (fromImportMatch != null) {
    return fromImportMatch[1]
      .split(',')
      .map((item) => item.trim().replace(/\s+as\s+\w+$/, ''))
      .filter((item) => item);
  }
  return [];
}
