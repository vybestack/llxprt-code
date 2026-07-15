/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Public API facade for the genai-enclave scanner (#2352).
 *
 * This module re-exports the scanner functions and types from the
 * detection submodules. The actual AST-precise detection logic lives in:
 *
 * - **import-detection.ts** — @google/genai import detection (all import
 *   forms, createRequire provenance, computed specifiers)
 * - **export-detection.ts** — Gemini-named export detection (all export
 *   forms including CommonJS)
 * - **ast-helpers.ts** — shared low-level AST utility functions
 * - **violation-types.ts** — shared violation type definitions
 *
 * Consumers should import from this module as before; the split is purely
 * internal to keep each file under the lint max-lines limit.
 */

import ts from 'typescript';

const parseDiagnostics = new WeakMap<ts.SourceFile, readonly ts.Diagnostic[]>();

export {
  scanGenaiImports,
  isGenaiSpecifier,
  type ImportScanContext,
} from './import-detection.ts';

export { scanGeminiExports } from './export-detection.ts';

export type {
  GenaiImportViolation,
  ComputedImportViolation,
  GeminiExportViolation,
  Violation,
} from './violation-types.ts';

/**
 * Parse a source file into a TypeScript SourceFile AST.
 */
export function parseSourceFile(
  filePath: string,
  sourceText: string,
): ts.SourceFile {
  const scriptKind = inferScriptKind(filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const transpilation = ts.transpileModule(sourceText, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.Latest,
    },
    fileName:
      scriptKind === ts.ScriptKind.TSX || scriptKind === ts.ScriptKind.JSX
        ? 'diagnostics.tsx'
        : 'diagnostics.ts',
    reportDiagnostics: true,
  });
  parseDiagnostics.set(sourceFile, transpilation.diagnostics ?? []);
  return sourceFile;
}

/**
 * Stable scanner-owned API for retrieving parse diagnostics from a parsed
 * SourceFile. Consumers should use this instead of directly accessing the
 * internal `sourceFile.parseDiagnostics` property, which is an
 * implementation detail of the TypeScript compiler API that could change
 * across versions.
 *
 * Returns an array of diagnostic objects with `start` (position) and
 * `messageText` properties, or an empty array if the source parsed cleanly.
 */
export function getParseDiagnostics(
  sourceFile: ts.SourceFile,
): readonly ts.Diagnostic[] {
  return parseDiagnostics.get(sourceFile) ?? [];
}

/**
 * Determine the appropriate ScriptKind from the file extension, including
 * `.mts`, `.cts`, `.d.ts`, `.d.mts`, `.d.cts`, `.tsx`, and `.jsx`.
 */
function inferScriptKind(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:c|m)?js$/.test(lower)) return ts.ScriptKind.JS;
  if (lower.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}
