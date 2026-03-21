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
          module: extractImportModule(trimmed),
          items: extractImportItems(trimmed),
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
  const match = line.match(REGEX.IMPORT_MODULE);
  return match ? match[1] : 'unknown';
}

/**
 * Extracts the list of imported items from an import statement.
 * @param line - The import statement line
 * @returns Array of imported item names
 */
function extractImportItems(line: string): string[] {
  const match = line.match(REGEX.IMPORT_ITEMS);
  if (match) {
    return match[1].split(',').map((item) => item.trim());
  }
  return [];
}
