/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import { ASTConfig } from './ast-config.js';
import { KEYWORDS } from './constants.js';
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
  // Go block imports span multiple lines; this tracks whether we are inside
  // an `import ( ... )` block so continuation lines are collected correctly.
  let inGoImportBlock = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const lineNum = index + 1;
    if (
      (language === 'typescript' || language === 'javascript') &&
      trimmed.startsWith(KEYWORDS.IMPORT)
    ) {
      imports.push({
        module: extractImportModule(trimmed),
        items: extractImportItems(trimmed),
        line: lineNum,
      });
    } else if (
      language === 'python' &&
      (trimmed.startsWith(KEYWORDS.IMPORT) || trimmed.startsWith(KEYWORDS.FROM))
    ) {
      imports.push(...parsePythonImportLine(trimmed, lineNum));
    } else if (language === 'rust' && isRustUseDeclaration(trimmed)) {
      const parsed = parseRustUseDeclaration(trimmed);
      if (parsed) {
        imports.push({ ...parsed, line: lineNum });
      }
    } else if (language === 'c' && isCIncludeDirective(trimmed)) {
      const module = extractCIncludeModule(trimmed);
      imports.push({ module, items: [], line: lineNum });
    } else if (language === 'go') {
      const result = handleGoLine(trimmed, lineNum, inGoImportBlock);
      inGoImportBlock = result.inBlock;
      imports.push(...result.imports);
    } else if (language === 'ruby' && isRubyRequire(trimmed)) {
      const module = extractRubyRequirePath(trimmed);
      if (module) {
        imports.push({ module, items: [], line: lineNum });
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
  // Use string scanning instead of regex to avoid polynomial backtracking.
  const prefix =
    line.startsWith('import ') || line.startsWith('from ')
      ? line.slice(line.indexOf(' ') + 1).trimStart()
      : null;
  if (prefix === null) {
    return 'unknown';
  }
  if (prefix.length < 2) {
    return 'unknown';
  }
  const quoteChar = prefix[0];
  if (quoteChar === "'" || quoteChar === '"') {
    const closeIdx = prefix.indexOf(quoteChar, 1);
    if (closeIdx !== -1) {
      return prefix.slice(1, closeIdx);
    }
  }
  return 'unknown';
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
 * Parses a one-line Python import statement into one or more Import records.
 * Direct comma-separated imports produce one record per source module.
 */
function parsePythonImportLine(line: string, lineNum: number): Import[] {
  const code = stripPythonComment(line);
  if (code.startsWith('from ')) {
    const rest = code.slice(5).trimStart();
    const importIdx = rest.indexOf(' import');
    if (importIdx === -1) {
      return [];
    }
    const module = rest.slice(0, importIdx).trim();
    const items = extractPythonImportItems(code);
    return [{ module, items, line: lineNum }];
  }
  if (code.startsWith('import ')) {
    return code
      .slice(7)
      .split(',')
      .map((target) => stripImportAlias(target.trim()))
      .filter((module) => module.length > 0)
      .map((module) => ({ module, items: [], line: lineNum }));
  }
  return [];
}

/**
 * Strips a trailing `#` comment from a Python import line. Import statements
 * cannot contain string literals, so the first `#` always starts a comment.
 */
function stripPythonComment(line: string): string {
  const commentIdx = line.indexOf('#');
  return (commentIdx === -1 ? line : line.slice(0, commentIdx)).trimEnd();
}

/**
 * Strips a trailing ` as <alias>` from a single import item using linear token
 * scanning (avoids regex backtracking on whitespace-heavy input).
 * Accepts Rust raw identifiers (`r#type`) as valid alias names.
 * Example: `join as j` -> `join`, `Write as r#type` -> `Write`.
 */
function stripImportAlias(item: string): string {
  const tokens = item.split(/\s+/);
  if (
    tokens.length >= 3 &&
    tokens[tokens.length - 2] === 'as' &&
    /^(?:r#)?\w+$/.test(tokens[tokens.length - 1])
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
  // Use string scanning instead of regex to avoid polynomial backtracking.
  if (!line.startsWith('from ')) {
    return [];
  }
  const importIdx = line.indexOf(' import');
  if (importIdx === -1) {
    return [];
  }
  const items = line.slice(importIdx + 7).trim();
  if (items.length === 0) {
    return [];
  }
  return items
    .split(',')
    .map((item) => stripImportAlias(item.trim()))
    .filter((item) => item);
}

/**
 * Parses a Rust `use` declaration into a module path and imported items.
 * Handles:
 * - `use std::collections::HashMap;`  -> { module: 'std::collections', items: ['HashMap'] }
 * - `use std::io::{Read, Write};`     -> { module: 'std::io', items: ['Read', 'Write'] }
 * - `use std::fs::{self};`            -> { module: 'std::fs', items: ['self'] }
 * - `use std::io::*;`                 -> { module: 'std::io', items: ['*'] }
 *
 * Simple and grouped forms normalize to the same representation:
 * `use a::b::c` and `use a::b::{c}` both produce { module: 'a::b', items: ['c'] }.
 *
 * Uses linear string scanning to avoid polynomial backtracking.
 * Returns null if the line is not a valid use declaration.
 */
function isRustUseDeclaration(line: string): boolean {
  return /^use\s+/.test(line) || /^pub(?:\s*\([^)]*\))?\s+use\s+/.test(line);
}

function parseRustUseDeclaration(
  line: string,
): { module: string; items: string[] } | null {
  // Strip leading visibility + "use" keyword: "use ", "pub use ",
  // "pub(crate) use", "pub(super) use", "pub(in path) use".
  let body = line
    .replace(/^pub(?:\s*\([^)]*\))?\s+use\s+/, '')
    .replace(/^use\s+/, '')
    .trim();

  // Strip block comments first (/* ... */) so that a `//` inside a block
  // comment does not prematurely trigger the line-comment strip below.
  const blockCommentStart = body.indexOf('/*');
  if (blockCommentStart !== -1) {
    const blockCommentEnd = body.indexOf('*/', blockCommentStart);
    if (blockCommentEnd !== -1) {
      body = (
        body.slice(0, blockCommentStart) + body.slice(blockCommentEnd + 2)
      ).trim();
    } else {
      body = body.slice(0, blockCommentStart).trim();
    }
  }
  // Strip line comments (//)
  const lineCommentIndex = body.indexOf('//');
  if (lineCommentIndex !== -1) {
    body = body.slice(0, lineCommentIndex).trim();
  }
  if (body.endsWith(';')) {
    body = body.slice(0, -1).trim();
  }
  if (body.length === 0) {
    return null;
  }

  const braceOpen = body.indexOf('{');
  if (braceOpen === -1) {
    // Simple path: normalize to match the grouped form so that
    // `use a::b::c` and `use a::b::{c}` produce identical results.
    return normalizeRustSimplePath(stripImportAlias(body));
  }

  // Forward-scan to find the matching closing brace for the first opening
  // brace, so nested groups (e.g., `std::{io::{Read, Write}}`) parse correctly.
  let depth = 0;
  let braceClose = -1;
  for (let i = braceOpen; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') {
      depth--;
      if (depth === 0) {
        braceClose = i;
        break;
      }
    }
  }
  if (braceClose <= braceOpen) {
    return null;
  }

  // Module path is everything before the first `{` group (minus trailing `::`)
  const modulePath = body.slice(0, braceOpen).replace(/::$/, '').trim();
  const itemsStr = body.slice(braceOpen + 1, braceClose).trim();
  const items = splitRustImportItems(itemsStr)
    .map((item) => stripImportAlias(item.trim()))
    .filter((item) => item);

  return { module: modulePath, items };
}

/**
 * Normalizes a simple (brace-less) Rust use path into the same module/items
 * representation as a grouped use, so `use a::b::c` matches `use a::b::{c}`.
 *
 * - A trailing glob (`::*`) is split into items: `['*']`.
 * - Otherwise the last `::`-separated segment becomes the imported item.
 * - Single-segment paths (no `::`) stay as module-only: `use std` -> { module: 'std', items: [] }.
 */
function normalizeRustSimplePath(path: string): {
  module: string;
  items: string[];
} {
  if (path.endsWith('::*')) {
    const module = path.slice(0, -3);
    return { module, items: ['*'] };
  }
  const lastSep = path.lastIndexOf('::');
  if (lastSep === -1) {
    return { module: path, items: [] };
  }
  const module = path.slice(0, lastSep);
  const item = path.slice(lastSep + 2);
  return { module, items: [item] };
}

/**
 * Splits a Rust use-group item list by top-level commas, ignoring commas
 * inside nested brace groups (e.g., `{Read, Write}` inside `io::{Read, Write}`).
 */
function splitRustImportItems(itemsStr: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < itemsStr.length; i++) {
    const ch = itemsStr[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      items.push(itemsStr.slice(start, i));
      start = i + 1;
    }
  }
  items.push(itemsStr.slice(start));
  return items;
}

/**
 * Detects a C #include preprocessor directive.
 * Matches `#include <stdio.h>` and `#include "myheader.h"`.
 * Uses linear scanning to avoid regex backtracking.
 */
function isCIncludeDirective(line: string): boolean {
  const hashIdx = line.indexOf('#');
  if (hashIdx === -1) return false;
  // Reject lines where the #include is inside a comment (e.g., `// #include <x.h>`)
  const beforeHash = line.slice(0, hashIdx).trim();
  if (beforeHash.length > 0) return false;
  const includeIdx = line.indexOf('include');
  if (includeIdx === -1 || includeIdx < hashIdx) return false;
  const afterInclude = line.slice(includeIdx + 'include'.length);
  const trimmed = afterInclude.trimStart();
  return trimmed.startsWith('<') || trimmed.startsWith('"');
}

/**
 * Extracts the module path from a C #include directive.
 * Strips the angle brackets or double quotes, leaving the bare header name
 * (e.g., `stdio.h` or `myheader.h`).
 */
function extractCIncludeModule(line: string): string {
  const angleOpen = line.indexOf('<');
  if (angleOpen !== -1) {
    const angleClose = line.indexOf('>', angleOpen + 1);
    if (angleClose !== -1) {
      return line.slice(angleOpen + 1, angleClose);
    }
  }
  const quoteOpen = line.indexOf('"');
  if (quoteOpen !== -1) {
    const quoteClose = line.indexOf('"', quoteOpen + 1);
    if (quoteClose !== -1) {
      return line.slice(quoteOpen + 1, quoteClose);
    }
  }
  return 'unknown';
}

// ===== Go import helpers =====

/**
 * Parses a single Go line for import declarations, accounting for block state.
 *
 * Go imports come in two forms:
 * - Single: `import "pkg"`, `import f "pkg"`, `import . "pkg"`, `import _ "pkg"`
 * - Block:  `import ( ... )` spanning multiple lines
 *
 * Block imports require cross-line state: once `import (` is seen, subsequent
 * lines are package paths until the closing `)`. This function is pure — it
 * receives the current block state and returns the next state alongside any
 * imports found on this line.
 *
 * @returns The imports found and whether the parser is inside a block after
 *          processing this line.
 */
function handleGoLine(
  line: string,
  lineNum: number,
  inBlock: boolean,
): { imports: Import[]; inBlock: boolean } {
  if (inBlock) {
    // Strip line comments before scanning for the closing paren so a `)`
    // inside a trailing comment (e.g. `// see issue ) for details`) does not
    // terminate the block prematurely and silently drop later imports.
    const codePart = stripGoLineComment(line);
    const closeParen = codePart.indexOf(')');
    if (closeParen !== -1) {
      const module = extractGoImportPath(line.slice(0, closeParen));
      return {
        imports: module ? [{ module, items: [], line: lineNum }] : [],
        inBlock: false,
      };
    }
    const module = extractGoImportPath(line);
    return {
      imports: module ? [{ module, items: [], line: lineNum }] : [],
      inBlock: true,
    };
  }
  if (isGoImportBlockStart(line)) {
    const openParen = line.indexOf('(');
    const closeParen = stripGoLineComment(line).indexOf(')', openParen + 1);
    // Single-line block: import ( "pkg" )
    if (closeParen !== -1) {
      const module = extractGoImportPath(line.slice(openParen + 1, closeParen));
      return {
        imports: module ? [{ module, items: [], line: lineNum }] : [],
        inBlock: false,
      };
    }
    return { imports: [], inBlock: true };
  }
  if (isGoSingleImport(line)) {
    const module = extractGoImportPath(line.replace(/^import\s+/, ''));
    return {
      imports: module ? [{ module, items: [], line: lineNum }] : [],
      inBlock: false,
    };
  }
  return { imports: [], inBlock: false };
}

/**
 * Detects a Go single-line import: `import "pkg"`, `import f "pkg"`,
 * `import . "pkg"`, `import _ "pkg"`.
 * Excludes block starts (`import (`), which are handled separately.
 */
function isGoSingleImport(line: string): boolean {
  return /^import\s+/.test(line) && !isGoImportBlockStart(line);
}

/**
 * Detects the start of a Go import block: `import (`.
 */
function isGoImportBlockStart(line: string): boolean {
  return /^import\s*\(/.test(line);
}

/**
 * Strips a trailing `//` line comment from a Go line, returning only the code
 * portion. Ensures comment text (e.g., a stray `)`) does not affect parsing.
 */
function stripGoLineComment(line: string): string {
  const commentIdx = line.indexOf('//');
  return commentIdx !== -1 ? line.slice(0, commentIdx) : line;
}

/**
 * Extracts the double-quoted package path from a Go import line.
 * Strips line comments and ignores any alias/dot/underscore prefix.
 * Returns null when no quoted path is present (e.g., blank lines).
 *
 * Handles: `"fmt"`, `f "fmt"`, `. "pkg"`, `_ "pkg"`, `"pkg" // comment`.
 */
function extractGoImportPath(line: string): string | null {
  const body = stripGoLineComment(line).trim();
  const quoteOpen = body.indexOf('"');
  if (quoteOpen === -1) {
    return null;
  }
  const alias = body.slice(0, quoteOpen).trim();
  if (alias !== '' && alias !== '.' && !/^\w+$/.test(alias)) {
    return null;
  }
  const quoteClose = body.indexOf('"', quoteOpen + 1);
  if (quoteClose === -1 || body.slice(quoteClose + 1).trim() !== '') {
    return null;
  }
  const module = body.slice(quoteOpen + 1, quoteClose);
  return module.length > 0 ? module : null;
}

// ===== Ruby require helpers =====

/**
 * Detects a Ruby require / require_relative directive.
 * Handles both bare (`require 'json'`, `require'json'`) and parenthesized
 * (`require('json')`) forms with single or double quotes. Whitespace is
 * optional for the bare form because Ruby method-call syntax permits
 * `require'json'` without a space before the string literal.
 */
function isRubyRequire(line: string): boolean {
  return (
    /^require\s*['"]/.test(line) ||
    /^require_relative\s*['"]/.test(line) ||
    /^require\s*\(\s*['"]/.test(line) ||
    /^require_relative\s*\(\s*['"]/.test(line)
  );
}

/**
 * Extracts one static string literal from a Ruby require directive.
 * Preserves valid bare and parenthesized calls while rejecting interpolation,
 * concatenation, multiple arguments, and other dynamic trailing expressions.
 */
function extractRubyRequirePath(line: string): string | null {
  const quoteOpen = line.search(/['"]/);
  if (quoteOpen === -1) {
    return null;
  }
  const quoteChar = line[quoteOpen];
  const quoteClose = findRubyClosingQuote(line, quoteOpen, quoteChar);
  if (quoteClose === -1) {
    return null;
  }
  const module = line.slice(quoteOpen + 1, quoteClose);
  if (quoteChar === '"' && hasRubyInterpolation(module)) {
    return null;
  }
  const prefix = line.slice(0, quoteOpen);
  let suffix = line.slice(quoteClose + 1).trim();
  if (prefix.includes('(')) {
    if (!suffix.startsWith(')')) {
      return null;
    }
    suffix = suffix.slice(1).trim();
  }
  if (suffix !== '' && !suffix.startsWith('#')) {
    return null;
  }
  return module.length > 0 ? module : null;
}

function hasRubyInterpolation(module: string): boolean {
  let escaped = false;
  for (let i = 0; i < module.length - 1; i++) {
    if (module[i] === '#' && module[i + 1] === '{' && !escaped) {
      return true;
    }
    escaped = module[i] === '\\' && !escaped;
  }
  return false;
}

function findRubyClosingQuote(
  line: string,
  quoteOpen: number,
  quoteChar: string,
): number {
  let escaped = false;
  for (let i = quoteOpen + 1; i < line.length; i++) {
    if (line[i] === quoteChar && !escaped) {
      return i;
    }
    escaped = line[i] === '\\' && !escaped;
  }
  return -1;
}
