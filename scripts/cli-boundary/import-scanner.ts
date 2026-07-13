/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deep-import boundary scanner: analyzes production CLI source files for
 * disallowed deep runtime imports (static imports, dynamic import(), and
 * vi.mock module specifiers).
 */

import { readFileSync } from 'node:fs';
import { relative as pathRelative } from 'node:path';
import ts from 'typescript';
import type { ImportViolation } from './config.ts';
import { ALLOWLIST } from './config.ts';
import {
  getLine,
  isDisallowedDeepImport,
  isAllowed,
  specifierOf,
  isViMockCall,
  isNonLiteralViMock,
  isNonLiteralDynamicImport,
  createSourceFile,
} from './ast-helpers.ts';

/**
 * Analyze a single file for boundary violations.
 */
export function analyzeFile(
  filePath: string,
  repoRoot: string,
): ImportViolation[] {
  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const sourceFile = createSourceFile(filePath, sourceText);
  const violations: ImportViolation[] = [];

  function visit(node: ts.Node): void {
    const specifier = specifierOf(node);
    if (specifier !== null && isDisallowedDeepImport(specifier)) {
      const relFile = relative(repoRoot, filePath);
      if (!isAllowed(relFile, specifier, ALLOWLIST)) {
        const importKind = classifyImportKind(node);
        violations.push({
          line: getLine(sourceFile, node.getStart()),
          importKind,
          specifier,
        });
      }
    }
    const nonLiteralMock = isNonLiteralViMock(node);
    if (nonLiteralMock !== null) {
      violations.push({
        line: getLine(sourceFile, nonLiteralMock.getStart()),
        importKind: 'vi.mock-non-literal',
        specifier: '<dynamic>',
      });
    }
    const nonLiteralDynamicImport = isNonLiteralDynamicImport(node);
    if (nonLiteralDynamicImport !== null) {
      violations.push({
        line: getLine(sourceFile, nonLiteralDynamicImport.getStart()),
        importKind: 'dynamic-import-non-literal',
        specifier: '<dynamic>',
      });
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);

  return deduplicateViolations(violations);
}

function classifyImportKind(node: ts.Node): string {
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    return 'dynamic-import';
  }
  if (isViMockCall(node)) {
    return 'vi.mock';
  }
  if (ts.isImportEqualsDeclaration(node)) {
    return 'import-equals';
  }
  return 'static-import';
}

function deduplicateViolations(
  violations: ImportViolation[],
): ImportViolation[] {
  const seen = new Set<string>();
  return violations.filter((v) => {
    const key = `${v.line}|${v.importKind}|${v.specifier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Collect ALL import specifiers from a file as a Set of strings. Used by the
 * self-pruning allowlist guard.
 */
export function collectAllSpecifiers(filePath: string): Set<string> {
  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, 'utf-8');
  } catch {
    return new Set();
  }
  const sourceFile = createSourceFile(filePath, sourceText);
  const specifiers = new Set<string>();
  function visit(node: ts.Node): void {
    const spec = specifierOf(node);
    if (spec !== null) {
      specifiers.add(spec);
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return specifiers;
}

function relative(from: string, to: string): string {
  return pathRelative(from, to).replace(/\\/g, '/');
}
