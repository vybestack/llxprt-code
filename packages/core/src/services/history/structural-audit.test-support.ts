/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readFileSync } from 'node:fs';
import ts from 'typescript';

export interface RetainingProperty {
  readonly className: string;
  readonly property: string;
  readonly declared: string;
}

const collections = new Set([
  'Array',
  'ReadonlyArray',
  'Map',
  'ReadonlyMap',
  'Set',
  'ReadonlySet',
  'WeakMap',
  'WeakSet',
]);

function collectionType(
  type: ts.Type,
  checker: ts.TypeChecker,
  seen = new Set<ts.Type>(),
  nested = false,
  propertyName = '',
): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (type.isUnionOrIntersection())
    return type.types.some((part) =>
      collectionType(part, checker, seen, nested, propertyName),
    );
  const awaited = checker.getAwaitedType(type);
  if (
    awaited !== undefined &&
    awaited !== type &&
    collectionType(awaited, checker, seen, nested, propertyName)
  )
    return true;
  if (checker.isTupleType(type)) return false;
  if (checker.isArrayType(type)) {
    if (!nested) return true;
    const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    return (
      /^(history|turns?|rows?|contents?)$/i.test(propertyName) ||
      element?.getSymbol()?.name === 'IContent'
    );
  }
  if (collections.has(type.getSymbol()?.name ?? '')) return !nested;
  if (
    checker.getIndexInfosOfType(type).length > 0 &&
    (type.flags & ts.TypeFlags.Object) !== 0
  )
    return !nested;
  if (
    type
      .getCallSignatures()
      .some((signature) =>
        collectionType(signature.getReturnType(), checker, seen, nested),
      )
  )
    return true;
  return nestedPropertiesContainCollection(type, checker, seen);
}

function nestedPropertiesContainCollection(
  type: ts.Type,
  checker: ts.TypeChecker,
  seen: Set<ts.Type>,
): boolean {
  const symbol = type.getSymbol();
  const named = symbol?.name !== '__type' && symbol?.name !== '__object';
  if (named) {
    // Only project-owned state is relevant; library internals are not.
    const declarations = symbol?.declarations ?? [];
    if (
      !declarations.some((declaration) => {
        const source = declaration.getSourceFile();
        return (
          !source.isDeclarationFile &&
          !source.fileName.includes('/node_modules/')
        );
      })
    )
      return false;
  }
  return type.getProperties().some((property) => {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (declaration === undefined) return false;
    if (named && ts.isMethodDeclaration(declaration)) return false;
    if (named && ts.isMethodSignature(declaration)) return false;
    return collectionType(
      checker.getTypeOfSymbolAtLocation(property, declaration),
      checker,
      new Set(seen),
      named,
      property.name,
    );
  });
}

function closureCollection(
  initializer: ts.Expression | undefined,
  checker: ts.TypeChecker,
): boolean {
  if (initializer === undefined) return false;
  let retaining = false;
  const visit = (node: ts.Node): void => {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const inspect = (reference: ts.Node): void => {
        if (
          ts.isIdentifier(reference) &&
          collectionType(checker.getTypeAtLocation(reference), checker)
        )
          retaining = true;
        ts.forEachChild(reference, inspect);
      };
      inspect(node.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(initializer);
  return retaining;
}

function standingProperties(
  node: ts.ClassDeclaration,
): Array<ts.PropertyDeclaration | ts.ParameterDeclaration> {
  return node.members.flatMap<ts.PropertyDeclaration | ts.ParameterDeclaration>(
    (member) => {
      if (ts.isPropertyDeclaration(member)) return [member];
      if (ts.isConstructorDeclaration(member))
        return member.parameters.filter((parameter) =>
          ts.isParameterPropertyDeclaration(parameter, member),
        );
      return [];
    },
  );
}

function method(
  source: ts.SourceFile,
  className: string,
  name: string,
): ts.MethodDeclaration | undefined {
  const owner = source.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className,
  );
  return owner?.members.find(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) && member.name.getText(source) === name,
  );
}

function identifiers(node: ts.Node, name: string): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child) && child.text === name) found.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function statementsOf<T extends ts.Node>(
  node: ts.Node,
  guard: (child: ts.Node) => child is T,
): T[] {
  const found: T[] = [];
  const visit = (child: ts.Node): void => {
    if (guard(child)) found.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function isEmptyArray(initializer: ts.Expression | undefined): boolean {
  return (
    initializer !== undefined &&
    ts.isArrayLiteralExpression(initializer) &&
    initializer.elements.length === 0
  );
}

function resumeWarningsBound(helperText: string): boolean {
  const source = ts.createSourceFile(
    'historyResumeAdoption.ts',
    helperText,
    ts.ScriptTarget.ESNext,
    true,
  );
  const fn = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'adoptResumeJournal',
  );
  if (fn?.body === undefined) return false;
  const declarations = statementsOf(fn.body, ts.isVariableDeclaration).filter(
    (declaration) => declaration.name.getText(source) === 'warnings',
  );
  if (declarations.length !== 1 || !isEmptyArray(declarations[0]?.initializer))
    return false;
  const loops = statementsOf(fn.body, ts.isForOfStatement);
  const cleanupLoop = loops.find(
    (loop) =>
      identifiers(loop.expression, 'cleanup').length === 0 &&
      ts.isVariableDeclarationList(loop.initializer) &&
      loop.initializer.declarations[0].name.getText(source) === 'cleanup',
  );
  if (
    cleanupLoop === undefined ||
    !ts.isArrayLiteralExpression(cleanupLoop.expression) ||
    cleanupLoop.expression.elements.length !== 3 ||
    !cleanupLoop.expression.elements.every((element) =>
      ts.isArrowFunction(element),
    )
  )
    return false;
  const pushes = statementsOf(fn.body, ts.isCallExpression).filter(
    (call) =>
      ts.isPropertyAccessExpression(call.expression) &&
      call.expression.expression.getText(source) === 'warnings' &&
      call.expression.name.text === 'push',
  );
  if (
    pushes.length !== 1 ||
    pushes[0].arguments.length !== 1 ||
    !cleanupLoop.statement.getText(source).includes(pushes[0].getText(source))
  )
    return false;
  const catches = statementsOf(cleanupLoop.statement, ts.isCatchClause);
  if (
    catches.length !== 1 ||
    catches[0].block.statements.length !== 1 ||
    !ts.isExpressionStatement(catches[0].block.statements[0]) ||
    catches[0].block.statements[0].expression !== pushes[0]
  )
    return false;
  const refs = identifiers(fn.body, 'warnings');
  const returns = statementsOf(fn.body, ts.isReturnStatement);
  return (
    refs.length === 3 &&
    returns.length === 1 &&
    returns[0].expression?.getText(source) === 'warnings'
  );
}

function calledFunction(
  body: ts.Node,
  name: string,
  checker: ts.TypeChecker,
): ts.FunctionDeclaration | undefined {
  const calls = statementsOf(body, ts.isCallExpression).filter(
    (call) => ts.isIdentifier(call.expression) && call.expression.text === name,
  );
  if (calls.length !== 1) return undefined;
  const symbol = checker.getSymbolAtLocation(calls[0].expression);
  if (symbol === undefined) return undefined;
  const target =
    (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  return target.declarations?.find(ts.isFunctionDeclaration);
}

function mutationEffectsBound(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
): boolean {
  const commit = method(source, 'HistoryServiceCore', 'commitHistoryMutation');
  if (commit?.body === undefined) return false;
  const prepare = calledFunction(
    commit.body,
    'prepareMutationEffects',
    checker,
  );
  const rollback = calledFunction(
    commit.body,
    'rollbackMutationEffects',
    checker,
  );
  const finalize = calledFunction(
    commit.body,
    'finalizeHistoryMutation',
    checker,
  );
  if (
    prepare?.body === undefined ||
    rollback === undefined ||
    finalize?.body === undefined
  )
    return false;
  const declarations = statementsOf(
    commit.body,
    ts.isVariableDeclaration,
  ).filter((declaration) => declaration.name.getText(source) === 'effects');
  if (declarations.length !== 1 || !isEmptyArray(declarations[0].initializer))
    return false;
  const commitRefs = identifiers(commit.body, 'effects');
  if (commitRefs.length !== 5) return false;
  const calls = statementsOf(commit.body, ts.isCallExpression);
  for (const [name, argument] of [
    ['prepareMutationEffects', 1],
    ['rollbackMutationEffects', 0],
    ['finalizeHistoryMutation', 2],
  ] satisfies ReadonlyArray<readonly [string, number]>) {
    if (
      calls.filter(
        (call) =>
          call.expression.getText(source) === name &&
          call.arguments.length > argument &&
          call.arguments[argument].getText(source) === 'effects',
      ).length !== 1
    )
      return false;
  }
  const preparation = calls.find(
    (call) => call.expression.getText(source) === 'prepareMutationEffects',
  );
  if (preparation?.arguments[0]?.getText(source) !== 'this.mediaOwner')
    return false;
  if (
    statementsOf(commit.body, ts.isForOfStatement).filter(
      (loop) => loop.expression.getText(source) === 'effects',
    ).length !== 1 ||
    identifiers(prepare.body, 'effects').length !== 1
  )
    return false;
  return (
    preparedEffectBound(prepare.getSourceFile(), prepare) &&
    rollbackFailuresBound(rollback.getSourceFile(), rollback) &&
    finalizedEffectBound(finalize, checker)
  );
}

function finalizedEffectBound(
  finalize: ts.FunctionDeclaration,
  checker: ts.TypeChecker,
): boolean {
  if (finalize.body === undefined) return false;
  const source = finalize.getSourceFile();
  const helper = calledFunction(
    finalize.body,
    'finalizeMutationEffects',
    checker,
  );
  const calls = statementsOf(finalize.body, ts.isCallExpression).filter(
    (call) => call.expression.getText(source) === 'finalizeMutationEffects',
  );
  if (helper === undefined || finalize.parameters.length < 3) return false;
  if (helper.parameters.length !== 1 || calls.length !== 1) return false;
  if (calls[0].arguments.length !== 1) return false;
  return (
    finalize.parameters[2].name.getText(source) === 'effects' &&
    identifiers(finalize.body, 'effects').length === 1 &&
    calls[0].arguments[0].getText(source) === 'effects' &&
    helper.parameters[0].name.getText(helper.getSourceFile()) === 'effects'
  );
}

function preparedEffectBound(
  source: ts.SourceFile,
  prepare: ts.FunctionDeclaration,
): boolean {
  if (prepare.body === undefined) return false;
  const preparePushes = statementsOf(prepare.body, ts.isCallExpression).filter(
    (call) => call.expression.getText(source) === 'effects.push',
  );
  if (
    preparePushes.length !== 1 ||
    preparePushes[0].arguments.length !== 1 ||
    statementsOf(prepare.body, ts.isIfStatement).filter(
      (statement) =>
        statement.expression.getText(source) === 'owner !== undefined' &&
        statement.thenStatement
          .getText(source)
          .includes(preparePushes[0].getText(source)),
    ).length !== 1
  )
    return false;
  const only = prepare.body.statements[0];
  if (prepare.body.statements.length !== 1 || !ts.isIfStatement(only))
    return false;
  if (only.elseStatement !== undefined) return false;
  const branch = only.thenStatement;
  if (ts.isBlock(branch) && branch.statements.length !== 1) return false;
  const push = ts.isBlock(branch) ? branch.statements[0] : branch;
  return ts.isExpressionStatement(push) && push.expression === preparePushes[0];
}

function rollbackFailuresBound(
  source: ts.SourceFile,
  rollback: ts.FunctionDeclaration,
): boolean {
  if (rollback.body === undefined) return false;
  const failureDeclarations = statementsOf(
    rollback.body,
    ts.isVariableDeclaration,
  ).filter((declaration) => declaration.name.getText(source) === 'failures');
  if (
    failureDeclarations.length !== 1 ||
    !isEmptyArray(failureDeclarations[0].initializer)
  )
    return false;
  const loops = statementsOf(rollback.body, ts.isForOfStatement);
  if (
    loops.length !== 1 ||
    loops[0].expression.getText(source) !== '[...effects].reverse()'
  )
    return false;
  const failurePushes = statementsOf(rollback.body, ts.isCallExpression).filter(
    (call) => call.expression.getText(source) === 'failures.push',
  );
  const catches = statementsOf(loops[0].statement, ts.isCatchClause);
  const returns = statementsOf(rollback.body, ts.isReturnStatement);
  if (
    identifiers(rollback.body, 'effects').length !== 1 ||
    identifiers(rollback.body, 'failures').length !== 3 ||
    failurePushes.length !== 1
  )
    return false;
  if (
    failurePushes[0].arguments.length !== 1 ||
    catches.length !== 1 ||
    returns.length !== 1
  )
    return false;
  const statements = catches[0].block.statements;
  if (statements.length !== 1 || !ts.isExpressionStatement(statements[0]))
    return false;
  return (
    statements[0].expression === failurePushes[0] &&
    ts.isIdentifier(failurePushes[0].arguments[0]) &&
    failurePushes[0].arguments[0].getText(source) ===
      catches[0].variableDeclaration?.name.getText(source) &&
    returns[0].expression?.getText(source) === 'failures'
  );
}

function boundedMethodReturn(
  source: ts.SourceFile,
  className: string,
  name: string,
  helperText?: string,
): boolean {
  if (
    !source.fileName.endsWith('/HistoryService.ts') ||
    className !== 'HistoryService' ||
    (name !== 'adoptResumeBoot' && name !== 'adoptResumeBootInternal')
  )
    return false;
  return resumeFacadeBound(source, helperText);
}

function resumeFacadeBound(
  source: ts.SourceFile,
  helperText?: string,
): boolean {
  const adoption =
    helperText ??
    readFileSync(
      source.fileName.replace(
        /HistoryService\.ts$/,
        'historyResumeAdoption.ts',
      ),
      'utf8',
    );
  if (!resumeWarningsBound(adoption)) return false;
  const internal = method(source, 'HistoryService', 'adoptResumeBootInternal');
  const wrapper = method(source, 'HistoryService', 'adoptResumeBoot');
  if (internal?.body === undefined || wrapper?.body === undefined) return false;
  const internalReturns = statementsOf(internal.body, ts.isReturnStatement);
  const internalResult = internalReturns[0]?.expression;
  if (
    internalReturns.length !== 1 ||
    internalResult === undefined ||
    !ts.isCallExpression(internalResult) ||
    internalResult.expression.getText(source) !== 'adoptResumeJournal'
  )
    return false;
  return deferredResumeBound(source, wrapper);
}

function deferredResumeBound(
  source: ts.SourceFile,
  wrapper: ts.MethodDeclaration,
): boolean {
  if (wrapper.body === undefined) return false;
  const wrapperReturns = statementsOf(wrapper.body, ts.isReturnStatement);
  if (
    wrapperReturns.length !== 2 ||
    identifiers(wrapper.body, 'warnings').length !== 3
  )
    return false;
  const promiseResult = wrapperReturns[0].expression;
  if (
    promiseResult === undefined ||
    !ts.isNewExpression(promiseResult) ||
    promiseResult.expression.getText(source) !== 'Promise' ||
    wrapperReturns[1].expression?.getText(source) !== 'warnings'
  )
    return false;
  const executor = promiseResult.arguments?.[0];
  if (executor === undefined || !ts.isArrowFunction(executor)) return false;
  if (
    identifiers(executor, 'resolve').length !== 2 ||
    identifiers(executor, 'reject').length !== 2
  )
    return false;
  const thenCalls = statementsOf(executor, ts.isCallExpression).filter((call) =>
    call.expression.getText(source).endsWith('.then'),
  );
  if (
    thenCalls.length !== 1 ||
    thenCalls[0].arguments.map((arg) => arg.getText(source)).join(',') !==
      'resolve,reject'
  )
    return false;
  const deferred = thenCalls[0].expression;
  if (
    !ts.isPropertyAccessExpression(deferred) ||
    !ts.isCallExpression(deferred.expression) ||
    deferred.expression.expression.getText(source) !== 'this.adoptResumeBoot'
  )
    return false;
  const initializers = statementsOf(
    wrapper.body,
    ts.isVariableDeclaration,
  ).filter((declaration) => declaration.name.getText(source) === 'warnings');
  if (initializers.length !== 1 || !isEmptyArray(initializers[0].initializer))
    return false;
  const assignments = statementsOf(wrapper.body, ts.isBinaryExpression).filter(
    (binary) => binary.left.getText(source) === 'warnings',
  );
  return (
    assignments.length === 1 &&
    assignments[0].operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    assignments[0].right
      .getText(source)
      .startsWith('await this.adoptResumeBootInternal(')
  );
}

function returnedCollections(
  members: ts.NodeArray<ts.ClassElement | ts.TypeElement>,
  className: string,
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  helperText?: string,
): RetainingProperty[] {
  const flags: RetainingProperty[] = [];
  for (const member of members) {
    if (
      !ts.isMethodDeclaration(member) &&
      !ts.isGetAccessorDeclaration(member) &&
      !ts.isMethodSignature(member)
    )
      continue;
    const signature = checker.getSignatureFromDeclaration(member);
    if (
      signature !== undefined &&
      collectionType(signature.getReturnType(), checker) &&
      (!ts.isMethodDeclaration(member) ||
        !boundedMethodReturn(
          source,
          className,
          member.name.getText(source),
          helperText,
        ))
    ) {
      flags.push({
        className,
        property: member.name.getText(source),
        declared: checker.typeToString(signature.getReturnType()),
      });
    }
  }
  return flags;
}

export function auditSourceText(
  sourceText: string,
  whitelist: ReadonlySet<string>,
  fileName = '/virtual-child-audit.ts',
  helperText?: string,
  sourceOverrides: ReadonlyMap<string, string> = new Map(),
): RetainingProperty[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (
    name,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) => {
    const text = name === fileName ? sourceText : sourceOverrides.get(name);
    return text === undefined
      ? original(name, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(name, text, languageVersion, true);
  };
  const program = ts.createProgram([fileName], options, host);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(fileName);
  if (source === undefined) throw new Error(`Missing audit source ${fileName}`);
  return auditSourceNodes(source, whitelist, checker, helperText);
}

function auditSourceNodes(
  source: ts.SourceFile,
  whitelist: ReadonlySet<string>,
  checker: ts.TypeChecker,
  helperText?: string,
): RetainingProperty[] {
  const flags: RetainingProperty[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const className = node.name?.text ?? '<anonymous>';
      if (className === 'HistoryServiceCore') {
        const commit = method(source, className, 'commitHistoryMutation');
        if (
          commit?.body !== undefined &&
          !mutationEffectsBound(source, checker)
        ) {
          flags.push({
            className,
            property: 'rollbackMutationEffects',
            declared:
              'rollback effects or failures lack a context-independent bound',
          });
        }
      }
      for (const member of standingProperties(node)) {
        const property = member.name.getText(source);
        if (whitelist.has(`${className}.${property}`)) continue;
        const type = checker.getTypeAtLocation(member);
        if (
          collectionType(type, checker) ||
          closureCollection(member.initializer, checker)
        )
          flags.push({
            className,
            property,
            declared: checker.typeToString(type),
          });
      }
      flags.push(
        ...returnedCollections(
          node.members,
          className,
          checker,
          source,
          helperText,
        ),
      );
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'rollbackMutationEffects'
    ) {
      const signature = checker.getSignatureFromDeclaration(node);
      const bounded = rollbackFailuresBound(source, node);
      if (
        signature !== undefined &&
        collectionType(signature.getReturnType(), checker) &&
        !bounded
      ) {
        flags.push({
          className: source.fileName,
          property: node.name.text,
          declared: checker.typeToString(signature.getReturnType()),
        });
      }
    }
    if (ts.isInterfaceDeclaration(node)) {
      flags.push(
        ...returnedCollections(node.members, node.name.text, checker, source),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return flags;
}
