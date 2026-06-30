/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as ts from 'typescript';

interface ExportSurfaceOptions {
  includeTypeOnly?: boolean;
}

function includesTypeOnly(options: ExportSurfaceOptions): boolean {
  return options.includeTypeOnly === true;
}

function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  return (
    modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false
  );
}

function bindingNameExportsIdentifier(
  name: ts.BindingName,
  identifier: string,
): boolean {
  if (ts.isIdentifier(name)) {
    return name.text === identifier;
  }

  if (!ts.isObjectBindingPattern(name) && !ts.isArrayBindingPattern(name)) {
    return false;
  }

  return name.elements.some((element) => {
    if (ts.isBindingElement(element)) {
      return bindingNameExportsIdentifier(element.name, identifier);
    }
    return false;
  });
}

function namedDeclarationExportsIdentifier(
  statement: ts.Statement,
  identifier: string,
  options: ExportSurfaceOptions,
): boolean {
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return (
      statement.name !== undefined &&
      ts.isIdentifier(statement.name) &&
      statement.name.text === identifier
    );
  }

  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement)
  ) {
    return (
      includesTypeOnly(options) &&
      ts.isIdentifier(statement.name) &&
      statement.name.text === identifier
    );
  }

  if (ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) {
    return (
      ts.isIdentifier(statement.name) && statement.name.text === identifier
    );
  }

  return false;
}

function declarationExportsIdentifier(
  statement: ts.Statement,
  identifier: string,
  options: ExportSurfaceOptions,
): boolean {
  if (!hasExportModifier(statement)) {
    return false;
  }

  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some((declaration) =>
      bindingNameExportsIdentifier(declaration.name, identifier),
    );
  }

  return namedDeclarationExportsIdentifier(statement, identifier, options);
}

function exportSpecifierExportsIdentifier(
  element: ts.ExportSpecifier,
  identifier: string,
  options: ExportSurfaceOptions,
): boolean {
  if (element.isTypeOnly && !includesTypeOnly(options)) {
    return false;
  }

  return element.name.text === identifier;
}

function exportClauseExportsIdentifier(
  exportClause: ts.NamedExportBindings,
  identifier: string,
  options: ExportSurfaceOptions,
): boolean {
  if (ts.isNamespaceExport(exportClause)) {
    return exportClause.name.text === identifier;
  }

  return exportClause.elements.some((element) =>
    exportSpecifierExportsIdentifier(element, identifier, options),
  );
}

function exportDeclarationExportsIdentifier(
  statement: ts.ExportDeclaration,
  identifier: string,
  options: ExportSurfaceOptions,
): boolean {
  if (!statement.exportClause) {
    return false;
  }

  if (statement.isTypeOnly && !includesTypeOnly(options)) {
    return false;
  }

  return exportClauseExportsIdentifier(
    statement.exportClause,
    identifier,
    options,
  );
}

function exportAssignmentExportsIdentifier(
  statement: ts.ExportAssignment,
  identifier: string,
): boolean {
  return (
    ts.isIdentifier(statement.expression) &&
    statement.expression.text === identifier
  );
}

function statementExportsIdentifier(
  statement: ts.Statement,
  identifier: string,
  options: ExportSurfaceOptions,
): boolean {
  if (ts.isExportDeclaration(statement)) {
    return exportDeclarationExportsIdentifier(statement, identifier, options);
  }

  if (ts.isExportAssignment(statement)) {
    return exportAssignmentExportsIdentifier(statement, identifier);
  }

  return declarationExportsIdentifier(statement, identifier, options);
}

function parseSource(source: string): ts.SourceFile {
  return ts.createSourceFile(
    'index.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

export function exportsIdentifierFromSource(
  source: string,
  identifier: string,
  options: ExportSurfaceOptions = {},
): boolean {
  return parseSource(source).statements.some((statement) =>
    statementExportsIdentifier(statement, identifier, options),
  );
}

export function exportsModuleFromSource(
  source: string,
  moduleSpecifierText: string,
  options: ExportSurfaceOptions = {},
): boolean {
  return parseSource(source).statements.some((statement) => {
    if (!ts.isExportDeclaration(statement)) {
      return false;
    }

    const moduleSpecifier = statement.moduleSpecifier;
    const matchesModule =
      moduleSpecifier !== undefined &&
      ts.isStringLiteral(moduleSpecifier) &&
      moduleSpecifier.text === moduleSpecifierText;
    const exportsWholeModule =
      (statement.exportClause === undefined ||
        ts.isNamespaceExport(statement.exportClause)) &&
      (!statement.isTypeOnly || includesTypeOnly(options));

    return matchesModule && exportsWholeModule;
  });
}
