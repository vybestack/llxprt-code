/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import ts from 'typescript';
import type {
  BoundaryResult,
  ConfigHolder,
  ImportFinding,
  ParseError,
} from './types.js';
import { buildProgram, toRel, isTestPath } from './program.js';
import { resolveConfigIdentity } from './config-identity.js';
import {
  collectConfigMemberReads,
  importsConfigType,
  constructsNewConfig,
  collectConfigTypeReferences,
} from './analysis.js';
import { findRoleViolations } from './role-guard.js';
import { rollupByPackage } from './report.js';

/** Extracts the package directory name from a repo-relative path. */
function packageNameOf(rel: string): string {
  const parts = rel.split('/');
  return parts.length > 1 && parts[0] === 'packages' ? parts[1] : parts[0];
}

interface FileSignals {
  readonly holder: ConfigHolder | undefined;
  readonly finding: ImportFinding | undefined;
}

/** Builds the holder (if any Config signals exist) for a file. */
function buildHolder(
  rel: string,
  packageName: string,
  signals: readonly string[],
  isFactory: boolean,
): ConfigHolder | undefined {
  if (signals.length === 0) return undefined;
  if (isFactory || isPermittedConfigUse(rel)) return undefined;
  return {
    file: rel,
    packageName,
    members: new Set(signals),
  };
}

/** Builds the import finding for a file that imports Config but is not a factory. */
function buildFinding(
  rel: string,
  packageName: string,
  importsType: boolean,
  isFactory: boolean,
): ImportFinding | undefined {
  return importsType && !isFactory ? { file: rel, packageName } : undefined;
}

/** Returns true when a repo-relative path is a permitted Config use. */
function isPermittedConfigUse(_rel: string): boolean {
  return false;
}

/** Analyses one consumer source file for member reads, imports, and factories. */
function analyseFile(
  program: ts.Program,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  rel: string,
  identity: {
    readonly classSymbol: ts.Symbol;
    readonly memberNames: ReadonlySet<string>;
    readonly hierarchySymbols: ReadonlySet<ts.Symbol>;
  },
): FileSignals {
  const packageName = packageNameOf(rel);
  const reads = collectConfigMemberReads(
    program,
    checker,
    sourceFile,
    identity,
  );
  const typeRefs = collectConfigTypeReferences(
    checker,
    sourceFile,
    identity.classSymbol,
  );
  const allSignals = [
    ...reads.map((r) => r.name),
    ...typeRefs.map((r) => `type:${r.form}`),
  ];
  const importsType = importsConfigType(
    checker,
    sourceFile,
    identity.classSymbol,
  );
  const isFactory = constructsNewConfig(
    checker,
    sourceFile,
    identity.classSymbol,
  );
  const holder = buildHolder(rel, packageName, allSignals, isFactory);
  const exempt = isFactory || isPermittedConfigUse(rel);
  const finding = buildFinding(rel, packageName, importsType, exempt);
  return { holder, finding };
}

/** Returns signals for a consumer file, or undefined when it must be skipped. */
function analyseConsumer(
  program: ts.Program,
  checker: ts.TypeChecker,
  root: string,
  abs: string,
  identity: {
    readonly classSymbol: ts.Symbol;
    readonly memberNames: ReadonlySet<string>;
    readonly hierarchySymbols: ReadonlySet<ts.Symbol>;
  },
): FileSignals | undefined {
  const rel = toRel(root, abs);
  if (isTestPath(rel)) return undefined;
  const sourceFile = program.getSourceFile(abs);
  if (!sourceFile) return undefined;
  return analyseFile(program, checker, sourceFile, rel, identity);
}

/** Describes a single syntactic diagnostic line for fail-closed reporting. */
function describeDiagnostic(
  file: ts.SourceFile,
  diagnostic: ts.Diagnostic,
): ParseError | undefined {
  if (diagnostic.category !== ts.DiagnosticCategory.Error) return undefined;
  if (file.isDeclarationFile) return undefined;
  const message =
    typeof diagnostic.messageText === 'string'
      ? diagnostic.messageText
      : diagnostic.messageText.messageText;
  const line =
    file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
  return { file: `${file.fileName}:${line}`, message };
}

/** Collects syntax errors across all program source files (non-declaration). */
function collectParseErrors(program: ts.Program): ParseError[] {
  const errors: ParseError[] = [];
  for (const diagnostic of program.getSyntacticDiagnostics()) {
    if (!diagnostic.file) continue;
    const error = describeDiagnostic(diagnostic.file, diagnostic);
    if (error) errors.push(error);
  }
  return errors;
}

/**
 * Runs the full boundary analysis for a root. When syntax errors are present
 * the result carries `parseErrors` and the caller must fail closed (the checker
 * cannot be trusted on a broken AST).
 */
export function runBoundary(root: string, enforce: boolean): BoundaryResult {
  const { program, consumerFiles } = buildProgram(root);
  const checker = program.getTypeChecker();
  const parseErrors = collectParseErrors(program);
  if (parseErrors.length > 0) {
    return emptyResult(root, enforce, parseErrors);
  }

  const identity = resolveConfigIdentity(program, checker);
  const holders: ConfigHolder[] = [];
  const findings: ImportFinding[] = [];
  if (identity) {
    for (const abs of consumerFiles) {
      const signals = analyseConsumer(program, checker, root, abs, identity);
      if (signals?.holder) holders.push(signals.holder);
      if (signals?.finding) findings.push(signals.finding);
    }
  }

  const roleViolations = findRoleViolations(root);
  const { perPackage, totalFiles, totalMembers } = rollupByPackage(holders);
  return {
    root,
    enforce,
    holders,
    findings,
    roleViolations,
    perPackage,
    totalFiles,
    totalMembers,
    parseErrors,
  };
}

function emptyResult(
  root: string,
  enforce: boolean,
  parseErrors: readonly ParseError[],
): BoundaryResult {
  return {
    root,
    enforce,
    holders: [],
    findings: [],
    roleViolations: [],
    perPackage: [],
    totalFiles: 0,
    totalMembers: 0,
    parseErrors,
  };
}
