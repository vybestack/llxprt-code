/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  AmbientPolicySource,
  AuditFinding,
} from './check-runtime-state-boundary.js';
import { existsSync } from 'node:fs';
import ts from 'typescript';
import { compilerConfiguration } from './runtime-source-discovery.js';
import { workspacePath } from './runtime-state-scan.js';
import type { RuntimeDeclarationRoot } from './tests/runtime-service-shape-guard.js';

export function exportedSymbol(
  program: ts.Program,
  root: RuntimeDeclarationRoot,
): ts.Symbol | undefined {
  const source = program.getSourceFile(root.file);
  const checker = program.getTypeChecker();
  const module = source && checker.getSymbolAtLocation(source);
  const symbol =
    module &&
    checker
      .getExportsOfModule(module)
      .find((entry) => entry.name === root.exportName);
  return (
    symbol &&
    (symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol)
  );
}

export function declarationCandidates(
  workspace: string,
  root: RuntimeDeclarationRoot,
): readonly string[] {
  const source = workspacePath(workspace, root.file);
  const packagePath = root.file.split('/').slice(0, 2).join('/');
  const buildConfig = `${packagePath}/tsconfig.build.json`;
  const defaultConfig = `${packagePath}/tsconfig.json`;
  const config = existsSync(workspacePath(workspace, buildConfig))
    ? buildConfig
    : defaultConfig;
  if (!existsSync(workspacePath(workspace, config))) return [source];
  const parsed = compilerConfiguration(workspace, config);
  const compilerSource = parsed.fileNames.find(
    (file) => workspacePath(workspace, file) === source,
  );
  if (compilerSource === undefined) return [source];
  return [
    source,
    ...ts
      .getOutputFileNames(
        parsed,
        compilerSource,
        !ts.sys.useCaseSensitiveFileNames,
      )
      .filter((file) => /\.d\.(?:ts|mts|cts)$/.test(file)),
  ];
}

export function selectedSources(
  program: ts.Program,
  files: readonly string[],
): ts.SourceFile[] {
  return files.map((file) => {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`Missing production source: ${file}`);
    return source;
  });
}

export function retiredAmbientFindings(
  program: ts.Program,
  roots: readonly AmbientPolicySource[],
): Array<Omit<AuditFinding, 'owner'>> {
  const checker = program.getTypeChecker();
  return roots
    .filter((root) => root.absentReason !== undefined)
    .map((root) => {
      const source = program.getSourceFile(root.file);
      const module = source && checker.getSymbolAtLocation(source);
      const declaration =
        module &&
        checker
          .getExportsOfModule(module)
          .find((symbol) => symbol.name === root.exportName)?.declarations?.[0];
      if (!source || !declaration)
        throw new Error(
          `Missing retired ambient export: ${root.file}#${root.exportName}`,
        );
      const position = source.getLineAndCharacterOfPosition(
        declaration.getStart(),
      );
      return {
        file: root.file,
        rule: 'retired-ambient-source',
        declaration: root.exportName,
        line: position.line + 1,
        column: position.character + 1,
      };
    });
}
