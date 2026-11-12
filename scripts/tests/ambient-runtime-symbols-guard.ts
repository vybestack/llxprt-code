#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Banned-symbol checker for issue #2616 (issue-workflow lane).
 *
 * Asserts the ambient mechanisms deleted by PR A stay deleted: the
 * module-level provider runtime context accessors, the settings runtime
 * adapter's ambient helpers, the provider runtime state factory, and the
 * settings package's process-wide singleton module. PR B adds the
 * AgentRuntimeState module-level globals: the write-only runtime state
 * registry, the subscription registry behind subscribeToAgentRuntimeState,
 * and the subscribe entry point itself. Production sources under
 * packages/<pkg>/src and plugins/<plugin>/src are scanned. Ordinary `.test.ts`
 * files are excluded; `.spec.ts` files remain in scope for the #2616 AC2 check.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export const BANNED_AMBIENT_SYMBOLS = [
  'getCliRuntimeServices',
  'getCliRuntimeContext',
  'getCliRuntimeConfig',
  'getCliProviderManager',
  'getCliOAuthManager',
  'maybeGetCliOAuthManager',
  'isCliRuntimeStatelessReady',
  'ensureStatelessProviderReady',
  'getActiveProviderStatus',
  'resolveActiveRuntimeIdentity',
  'defaultCliRuntimeId',
  'singletonManager',
  'singletonOAuthManager',
  'registerProviderManagerSingleton',

  'ownershipByConfig',
  'peekActiveProviderRuntimeContext',
  'setActiveProviderRuntimeContext',
  'clearActiveProviderRuntimeContext',
  'getActiveProviderRuntimeContext',
  'createSettingsProviderRuntimeContext',
  'setSettingsProviderRuntimeContext',
  'clearSettingsProviderRuntimeContext',
  'resolveRuntimeSettingsService',
  'getRuntimeSettingsService',
  'maybeGetRuntimeSettingsService',
  'activateSettingsRuntimeContext',
  'deactivateSettingsRuntimeContext',
  'registerSettingsService',
  'resetSettingsService',
  'setProviderRuntimeStateFactory',
  'settingsServiceInstance',
  'runtimeStateRegistry',
  'subscriptionRegistry',
  'subscribeToAgentRuntimeState',
  'resetRegisteredProviders',
  'oauthRuntimeBridge',
  'OAuthRuntimeBridge',
  'OAuthRuntimeAccessors',
  'buildOAuthRuntimeAccessors',
  'registerOAuthRuntimeAccessors',
  'getBrowserProfileAssociationStore',
  'runtimeRegistry',
  'setDefaultCliRuntimeId',
  'upsertRuntimeEntry',
  'registerCliProviderInfrastructure',
  'enterRuntimeScope',
  'runWithRuntimeScope',
  'getCurrentRuntimeScope',
] as const;

const BANNED_PATTERN = new RegExp(BANNED_AMBIENT_SYMBOLS.join('|'));

export interface AmbientSymbolViolation {
  file: string;
  line: number;
  text: string;
}

export interface AmbientSymbolScanResult {
  violations: AmbientSymbolViolation[];
  scannedFiles: number;
}

function isProductionSource(fileName: string): boolean {
  return (
    (fileName.endsWith('.ts') || fileName.endsWith('.tsx')) &&
    !/\.test\./.test(fileName)
  );
}

function collectSourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist') walk(fullPath);
      } else if (isProductionSource(entry)) {
        found.push(fullPath);
      }
    }
  };
  walk(root);
  return found;
}

function isRetiredRuntimeImport(statement: ts.Statement): boolean {
  if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
    return false;
  const moduleSpecifier = statement.moduleSpecifier;
  return (
    !!moduleSpecifier &&
    ts.isStringLiteral(moduleSpecifier) &&
    /(?:^|\/)runtime(?:Accessors|Settings|\/providerManagerInstance)(?:\.js|\.ts)?$/.test(
      moduleSpecifier.text,
    )
  );
}

function collectFileViolations(
  file: string,
  lines: string[],
  violations: AmbientSymbolViolation[],
): void {
  const migratedRetryConsumer =
    /(?:^|[/\\])(?:errors|RetryOrchestrator)\.ts$/.test(file);
  const source = ts.createSourceFile(
    file,
    lines.join('\n'),
    ts.ScriptTarget.Latest,
  );
  for (const statement of source.statements) {
    if (!isRetiredRuntimeImport(statement)) continue;
    const line = source.getLineAndCharacterOfPosition(
      statement.getStart(source),
    ).line;
    violations.push({
      file,
      line: line + 1,
      text: statement.getText(source),
    });
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (
      BANNED_PATTERN.test(lines[index]) ||
      (migratedRetryConsumer &&
        /active-runtime-identity|getActiveRuntimeKind|getActiveRuntimeIdentity/.test(
          lines[index],
        ))
    ) {
      violations.push({
        file,
        line: index + 1,
        text: lines[index].trim(),
      });
    }
  }
}

function collectOAuthRegistrationViolations(
  file: string,
  content: string,
  violations: AmbientSymbolViolation[],
): void {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest);
  const deletedProfileAccessors = new Set([
    'getActiveProfileName',
    'setDefaultProfileName',
    'getRuntimeDiagnosticsSnapshot',
  ]);
  for (const statement of source.statements) {
    let bindings: ts.NamedImportBindings | ts.NamedExportBindings | undefined;
    if (ts.isImportDeclaration(statement))
      bindings = statement.importClause?.namedBindings;
    if (ts.isExportDeclaration(statement)) bindings = statement.exportClause;
    const deletedFunction =
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      deletedProfileAccessors.has(statement.name.text);
    const namedBindings =
      bindings !== undefined &&
      (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
      bindings;
    const deletedBinding =
      namedBindings &&
      namedBindings.elements.some((element) =>
        deletedProfileAccessors.has(
          (element.propertyName ?? element.name).text,
        ),
      );
    const deleted = deletedFunction || deletedBinding;
    if (deleted)
      violations.push({
        file,
        line:
          source.getLineAndCharacterOfPosition(statement.getStart(source))
            .line + 1,
        text: statement.getText(source),
      });
  }
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const hasRegistrationState = statement.declarationList.declarations.some(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'registeredProviders',
    );
    if (hasRegistrationState) {
      violations.push({
        file,
        line:
          source.getLineAndCharacterOfPosition(statement.getStart(source))
            .line + 1,
        text: statement.getText(source),
      });
    }
  }
}

/**
 * Scan the given directories (each expected to be a packages/<pkg>/src
 * root, or any directory treated as a source root) for the deleted
 * ambient symbols.
 */
export function scanForBannedAmbientSymbols(
  sourceRoots: string[],
): AmbientSymbolScanResult {
  const violations: AmbientSymbolViolation[] = [];
  let scannedFiles = 0;

  for (const root of sourceRoots) {
    for (const file of collectSourceFiles(root)) {
      scannedFiles += 1;
      const content = readFileSync(file, 'utf-8');
      collectFileViolations(file, content.split('\n'), violations);
      collectOAuthRegistrationViolations(file, content, violations);
    }
  }

  return { violations, scannedFiles };
}

if (import.meta.main) {
  const roots = ['packages', 'plugins'].flatMap((directory) =>
    readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name, 'src'))
      .filter((root) => existsSync(root) && statSync(root).isDirectory()),
  );
  const result = scanForBannedAmbientSymbols(roots);
  if (result.violations.length) {
    process.stderr.write(
      `${result.violations
        .map(({ file, line, text }) => `${file}:${line}: ${text}`)
        .join('\n')}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Scanned ${result.scannedFiles} production sources.\n`,
    );
  }
}
