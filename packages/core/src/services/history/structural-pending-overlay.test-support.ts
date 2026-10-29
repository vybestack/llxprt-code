/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import ts from 'typescript';

function compact(node: ts.Node | undefined): string {
  return node?.getText().replace(/\s+/g, '') ?? '';
}

function references(node: ts.Node, name: string): number {
  let count = 0;
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child) && child.text === name) count++;
    ts.forEachChild(child, visit);
  };
  visit(node);
  return count;
}

function boundedHeaderLabels(body: ts.Block, checker: ts.TypeChecker): boolean {
  for (const statement of body.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      compact(statement) !==
        'constlabels=newSet(this.projection?.headerLabels);'
    )
      continue;
    const initializer = statement.declarationList.declarations[0].initializer;
    if (initializer === undefined || !ts.isNewExpression(initializer))
      return false;
    const argument = initializer.arguments?.[0];
    if (argument === undefined) return false;
    const type = checker.getTypeAtLocation(argument);
    const parts = type.isUnion() ? type.types : [type];
    return parts.every((part) => {
      if ((part.flags & ts.TypeFlags.Undefined) !== 0) return true;
      if (!checker.isTupleType(part)) return false;
      const length = part.getProperty('length');
      if (length === undefined) return false;
      const size = checker.getTypeOfSymbolAtLocation(length, argument);
      const sizes = size.isUnion() ? size.types : [size];
      return sizes.every(
        (value) => value.isNumberLiteral() && value.value <= 1,
      );
    });
  }
  return false;
}

function inputLimitBound(
  factory: ts.MethodDeclaration,
  checker: ts.TypeChecker,
): boolean {
  if (factory.parameters.length < 2) return false;
  const source = factory.parameters[1];
  const type = checker.getTypeAtLocation(source);
  const declaration = type.getProperty(
    'affectedJournalLabels',
  )?.valueDeclaration;
  if (declaration === undefined || !ts.isMethodDeclaration(declaration))
    return false;
  if (!declaration.getSourceFile().fileName.endsWith('/journal-tail-source.ts'))
    return false;
  const body = declaration.body;
  if (body === undefined) return false;
  const initial = body.statements.find(
    (statement) =>
      compact(statement) ===
        'letmaxRows=this.tailRows.length+this.overlay.size+labels.size;' &&
      boundedHeaderLabels(body, checker),
  );
  const projectionLimits: ts.BinaryExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      compact(node) === 'maxRows+=rawIds.length+2'
    )
      projectionLimits.push(node);
    ts.forEachChild(node, visit);
  };
  visit(body);
  return (
    initial !== undefined &&
    projectionLimits.length === 1 &&
    references(body, 'maxRows') === 3
  );
}

export function boundedPendingOverlayRows(
  declaration: ts.Declaration,
  checker: ts.TypeChecker,
): boolean {
  if (!ts.isParameter(declaration) || compact(declaration.name) !== 'rows')
    return false;
  const constructor = declaration.parent;
  if (
    !ts.isConstructorDeclaration(constructor) ||
    constructor.body === undefined
  )
    return false;
  const owner = constructor.parent;
  if (
    !ts.isClassDeclaration(owner) ||
    owner.name?.text !== 'PendingRequestOverlay'
  )
    return false;
  if (!owner.getSourceFile().fileName.endsWith('/journal-indexed-overlay.ts'))
    return false;
  if (
    constructor.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
    ) !== true
  )
    return false;
  if (compact(declaration.type) !== 'readonlyIndexedOverlayRow[]') return false;
  const statements = constructor.body.statements;
  const guard = statements[0];
  if (statements.length !== 2 || !ts.isIfStatement(guard)) return false;
  if (
    compact(guard.expression) !== 'rows.length>maxRows' ||
    guard.elseStatement !== undefined
  )
    return false;
  if (!ts.isThrowStatement(guard.thenStatement)) return false;
  if (compact(statements[1]) !== 'Object.freeze(rows);') return false;
  const factory = owner.members.find(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) && compact(member.name) === 'create',
  );
  if (factory?.body === undefined) return false;
  const body = factory.body;
  const last = body.statements[body.statements.length - 1];
  return (
    compact(body.statements[0]) ===
      'const{labels,maxRows}=awaitsource.affectedJournalLabels();' &&
    compact(last) ===
      'returnnewPendingRequestOverlay(rows,maxRows,count,firstOutputIndex);' &&
    references(body, 'maxRows') === 2 &&
    inputLimitBound(factory, checker)
  );
}
