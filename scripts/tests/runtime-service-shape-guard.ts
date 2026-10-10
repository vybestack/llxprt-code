/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { javascriptExpressionTypes } from './runtime-javascript-inference.js';
import {
  directIdentities,
  serviceAnalyzer,
  unalias,
} from './runtime-service-shape-analysis.js';

export interface RuntimeDeclarationRoot {
  readonly file: string;
  readonly exportName: string;
}

export interface RuntimeServiceShapeOptions {
  readonly services: readonly RuntimeDeclarationRoot[];
  readonly configs: readonly RuntimeDeclarationRoot[];
  readonly runtimeObjects?: readonly RuntimeDeclarationRoot[];
  readonly assembly?: ReadonlyArray<{
    readonly file: string;
    readonly functionName: string;
  }>;
}

export interface RuntimeServiceShapeFinding {
  readonly rule:
    | 'runtime-service-bundle'
    | 'runtime-service-bag-parameter'
    | 'config-service-locator'
    | 'runtime-service-analysis-resource-limit';
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

function resolveRoots(
  program: ts.Program,
  roots: readonly RuntimeDeclarationRoot[],
): ReadonlySet<ts.Symbol> {
  const checker = program.getTypeChecker();
  return new Set(
    roots.map((root) => {
      const file = program.getSourceFile(resolve(root.file));
      const module = file && checker.getSymbolAtLocation(file);
      const exported =
        module &&
        checker
          .getExportsOfModule(module)
          .find((symbol) => symbol.name === root.exportName);
      if (!exported) {
        throw new Error(
          `Unresolved declaration root: ${root.file}#${root.exportName}`,
        );
      }
      const symbol = unalias(exported, checker);
      if (
        !symbol.declarations?.some(
          (node) =>
            ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node),
        )
      ) {
        throw new Error(
          `Root must resolve to a class or interface: ${root.file}#${root.exportName}`,
        );
      }
      return symbol;
    }),
  );
}

function assemblyFunction(node: ts.Node): ts.FunctionDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) {
      return ts.isFunctionDeclaration(current) &&
        ts.isSourceFile(current.parent)
        ? current
        : undefined;
    }
    current = current.parent;
  }
  return undefined;
}

function isAssemblyNode(
  node: ts.Node,
  options: RuntimeServiceShapeOptions,
): boolean {
  const owner = assemblyFunction(node);
  return (
    !!owner?.name &&
    !!options.assembly?.some(
      (entry) =>
        resolve(entry.file) === resolve(owner.getSourceFile().fileName) &&
        entry.functionName === owner.name?.text,
    )
  );
}

function accessedMember(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  if (ts.isPropertyAccessExpression(node))
    return checker.getSymbolAtLocation(node.name);
  const key = checker.getTypeAtLocation(node.argumentExpression);
  return key.isStringLiteral() || key.isNumberLiteral()
    ? checker.getPropertyOfType(
        checker.getTypeAtLocation(node.expression),
        String(key.value),
      )
    : undefined;
}

function extractedMember(
  node: ts.Node,
  checker: ts.TypeChecker,
): { receiver: ts.Type; member: ts.Symbol | undefined } | undefined {
  let receiver: ts.Type;
  let name: ts.PropertyName | ts.BindingName;
  if (
    ts.isBindingElement(node) &&
    ts.isObjectBindingPattern(node.parent) &&
    !node.dotDotDotToken
  ) {
    receiver = checker.getTypeAtLocation(node.parent);
    name = node.propertyName ?? node.name;
  } else if (
    (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
    ts.isObjectLiteralExpression(node.parent)
  ) {
    const assignment = node.parent.parent;
    if (
      !ts.isBinaryExpression(assignment) ||
      assignment.left !== node.parent ||
      assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    )
      return undefined;
    receiver = checker.getTypeAtLocation(assignment.right);
    name = node.name;
  } else return undefined;
  let text: string | undefined;
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    text = name.text;
  } else if (ts.isComputedPropertyName(name)) {
    const key = checker.getTypeAtLocation(name.expression);
    if (key.isStringLiteral() || key.isNumberLiteral())
      text = String(key.value);
  }
  return {
    receiver,
    member:
      text === undefined
        ? undefined
        : checker.getPropertyOfType(receiver, text),
  };
}

function isConfigLocator(
  node: ts.Node,
  checker: ts.TypeChecker,
  configs: ReadonlySet<ts.Symbol>,
  analyze: ReturnType<typeof serviceAnalyzer>,
): { locator: boolean; incomplete: boolean } {
  const access =
    ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
      ? {
          receiver: checker.getTypeAtLocation(node.expression),
          member: accessedMember(node, checker),
        }
      : extractedMember(node, checker);
  if (!access || !directIdentities(access.receiver, configs, checker).length)
    return { locator: false, incomplete: false };
  const member = access.member;
  if (!member) return { locator: false, incomplete: false };
  const owned = member.declarations?.some((declaration) => {
    const owner = declaration.parent;
    if (
      !(ts.isClassDeclaration(owner) || ts.isInterfaceDeclaration(owner)) ||
      !owner.name
    )
      return false;
    return (
      directIdentities(checker.getTypeAtLocation(owner), configs, checker)
        .length > 0
    );
  });
  if (!owned) return { locator: false, incomplete: false };
  const type = checker.getTypeOfSymbolAtLocation(member, node);
  const returned = type
    .getCallSignatures()
    .map((signature) => checker.getReturnTypeOfSignature(signature));
  const accessor = member.declarations?.some(ts.isGetAccessorDeclaration);
  const summaries = [...returned, ...(accessor ? [type] : [])].map((result) =>
    analyze(result, node),
  );
  return {
    locator: summaries.some((summary) => summary.identities.size > 0),
    incomplete: summaries.some((summary) => summary.incomplete),
  };
}

/**
 * Scans checked sources using exported class/interface declaration identities.
 * Bags contain at least two distinct configured services through properties,
 * exposed members, standard container contents, or callable returns. Data union branches remain
 * alternatives; callable returns accumulate capabilities across possible calls.
 * Base declarations and resolved generic constraints preserve root identities.
 * Shared type graphs use monotone fixed-point summaries, including cycles.
 * References share nodes only under declaration-preserving alpha-renaming of
 * parameters with closed bounds, including indices into closed declaration maps.
 * Concrete/composite substitutions retain checker identity. Callable nodes with
 * identical checked return types share the same capability transfer function.
 * A finite declaration-position proof separates fixed root identities, receiver
 * argument dependencies, deferred method substitutions, erasure and unsupported
 * selectors. Exact merged declarations, public fields, constructor parameter
 * properties, heritage, bounds/defaults and every conditional/indexed/mapped
 * operand contribute closure obligations. Recursive wrappers and public this
 * bind to declaration equations instead of endlessly instantiated checker types.
 * Cycles are certified only after the entire dependency closure reaches its
 * conservative scalar fixed point. Every actual receiver argument must also
 * prove root-free before pruning. Standard content-container summaries may keep
 * argument edges only after proving their merged declarations introduce no fixed
 * root; otherwise their public members, including augmentations, remain checked.
 * A free method variable is a deferred typed-use obligation even without an input
 * producer. Its constraints, defaults and fixed/receiver-derived return siblings
 * are not erased. Actual call, assignment and contextual callable use sites
 * discharge substitutions through checker types; predicates expose their asserted
 * type. Defaults contribute only when the parameter is exposed. This proves no
 * fixed named typed introduction, not purity or absence of runtime captures.
 * Any/unknown records typed erasure only; it never exempts an enclosing bag or
 * bypasses other closure obligations. Import type queries, unresolved computed
 * keys, class value selectors and unannotated members decline the finite proof.
 * Failure of this sufficient proof retains exact checker analysis and its limit;
 * conditional and literal-index correlations with fixed roots are not collapsed.
 * Discovery visits up to 10,000 nodes per query in bounded worklist chunks.
 * A witnessed bundle finishes a positive query early; unresolved negative
 * queries retain explicit resource-limit findings.
 * Private and protected storage does not expose capabilities. Generic domain
 * objects expose their instantiated public members, not phantom type arguments.
 * Config locators additionally recognize separately configured runtime objects.
 * Reporting includes actual call/new arguments, resolved signature returns and
 * expression types, specialized callable/constructor value expressions, variable
 * types, assignment right sides, concise arrow bodies
 * and return expressions. Contextual types supplement retained expression types,
 * including specialized generic callbacks. Actual producer expressions remain
 * visible even under a void or unknown callback/argument context.
 * Assembly exemptions apply only to shapes directly owned by the named top-level
 * function declaration, never locators or nested functions. Top-level bundle
 * aliases remain prohibited even in an assembly file. Paths resolve from process.cwd().
 * This does not recover services already erased to any/unknown, prove arbitrary
 * unconstrained generic declarations, or track ambient delegation, index signatures,
 * uncalled constructor signatures, nonliteral computed keys, rest-based extraction,
 * nested assignment destructuring, or structurally rebuilt services.
 * Destructuring requires a resolved member owned by a Config declaration or its
 * derived declaration.
 * Identity roots must export classes or
 * interfaces (directly or by re-export). Sources must pass TypeScript checking;
 * callers supply repository discovery, compiler configuration and policy roots.
 */
export function scanRuntimeServiceProgram(
  program: ts.Program,
  options: RuntimeServiceShapeOptions,
  files: readonly string[],
): readonly RuntimeServiceShapeFinding[] {
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    throw new Error(
      `TypeScript input errors:\n${ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => program.getCurrentDirectory(),
        getNewLine: () => '\n',
      })}`,
    );
  }
  const checker = program.getTypeChecker();
  const services = resolveRoots(program, options.services);
  const configs = resolveRoots(program, options.configs);
  const analyze = serviceAnalyzer(services, checker, program);
  const analyzeRuntimeObject = serviceAnalyzer(
    new Set([
      ...services,
      ...resolveRoots(program, options.runtimeObjects ?? []),
    ]),
    checker,
    program,
  );
  const findings: RuntimeServiceShapeFinding[] = [];
  for (const file of files) {
    const source = program.getSourceFile(resolve(file));
    if (!source) throw new Error(`Missing scan source: ${file}`);
    const reported = new Set<string>();
    function report(
      node: ts.Node,
      rule: RuntimeServiceShapeFinding['rule'],
    ): void {
      const start = node.getStart();
      const key = `${start}:${rule}`;
      if (reported.has(key)) return;
      reported.add(key);
      const position = node
        .getSourceFile()
        .getLineAndCharacterOfPosition(start);
      findings.push({
        rule,
        file,
        line: position.line + 1,
        column: position.character + 1,
      });
    }
    function reportTypes(node: ts.Node, types: readonly ts.Type[]): void {
      if (isAssemblyNode(node, options)) return;
      const summaries = types.map((type) => analyze(type, node));
      if (summaries.some((summary) => summary.bundle)) {
        report(node, 'runtime-service-bundle');
      } else if (summaries.some((summary) => summary.incomplete)) {
        report(node, 'runtime-service-analysis-resource-limit');
      }
    }
    function reportExpression(node: ts.Expression): void {
      const contextual = checker.getContextualType(node);
      reportTypes(node, [
        checker.getTypeAtLocation(node),
        ...javascriptExpressionTypes(node, checker),
        ...(contextual ? [contextual] : []),
      ]);
    }
    function reportInferredParameter(
      argument: ts.Expression,
      parameter: ts.Node | undefined,
    ): void {
      if (!parameter || !ts.isParameter(parameter) || parameter.type) return;
      if (
        !/\.[cm]?js$/.test(parameter.getSourceFile().fileName) ||
        isAssemblyNode(argument, options)
      )
        return;
      const summary = analyze(checker.getTypeAtLocation(argument), argument);
      if (summary.bundle) report(argument, 'runtime-service-bag-parameter');
    }
    function reportCall(node: ts.CallExpression | ts.NewExpression): void {
      const signature = checker.getResolvedSignature(node);
      reportTypes(node, [
        checker.getTypeAtLocation(node),
        ...(ts.isCallExpression(node)
          ? javascriptExpressionTypes(node, checker)
          : []),
        ...(signature ? [checker.getReturnTypeOfSignature(signature)] : []),
      ]);
      for (const [index, argument] of (node.arguments ?? []).entries()) {
        reportExpression(argument);
        reportInferredParameter(
          argument,
          signature?.declaration?.parameters[index],
        );
      }
    }
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        reportCall(node);
      } else if (
        ts.isExpressionWithTypeArguments(node) &&
        !ts.isHeritageClause(node.parent)
      ) {
        reportExpression(node);
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        reportExpression(node.right);
      } else if (ts.isVariableDeclaration(node)) {
        reportTypes(node, [checker.getTypeAtLocation(node)]);
      } else if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        reportExpression(node.body);
      } else if (ts.isReturnStatement(node) && node.expression) {
        reportExpression(node.expression);
      }
      const bundle =
        ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node);
      const parameter = ts.isParameter(node);
      if ((bundle || parameter) && !isAssemblyNode(node, options)) {
        const summary = analyze(checker.getTypeAtLocation(node), node);
        if (summary.bundle) {
          report(
            node,
            bundle ? 'runtime-service-bundle' : 'runtime-service-bag-parameter',
          );
        } else if (summary.incomplete) {
          report(node, 'runtime-service-analysis-resource-limit');
        }
      }
      const locator = isConfigLocator(
        node,
        checker,
        configs,
        analyzeRuntimeObject,
      );
      if (locator.locator) {
        report(node, 'config-service-locator');
      } else if (locator.incomplete) {
        report(node, 'runtime-service-analysis-resource-limit');
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return findings;
}

/** Builds a multi-file fixture program without writing sources to disk. */
export function scanRuntimeServiceShapes(
  sources: Readonly<Record<string, string>>,
  options: RuntimeServiceShapeOptions,
): readonly RuntimeServiceShapeFinding[] {
  const compilerOptions: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
    skipLibCheck: true,
  };
  const sourceMap = new Map(
    Object.entries(sources).map(([file, text]) => [resolve(file), text]),
  );
  const base = ts.createCompilerHost(compilerOptions, true);
  const libDirectory = dirname(ts.getDefaultLibFilePath(compilerOptions));
  const isLib = (file: string): boolean =>
    dirname(resolve(file)) === libDirectory && /lib\..*\.d\.ts$/.test(file);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (file) =>
      sourceMap.has(resolve(file)) || (isLib(file) && base.fileExists(file)),
    readFile: (file) =>
      sourceMap.get(resolve(file)) ??
      (isLib(file) ? base.readFile(file) : undefined),
    directoryExists: (directory) =>
      [...sourceMap.keys()].some((file) =>
        file.startsWith(`${resolve(directory)}/`),
      ) || resolve(directory) === libDirectory,
    getSourceFile: (file, languageVersion) => {
      const text = sourceMap.get(resolve(file));
      if (text !== undefined)
        return ts.createSourceFile(file, text, languageVersion, true);
      return isLib(file)
        ? base.getSourceFile(file, languageVersion)
        : undefined;
    },
  };
  const program = ts.createProgram(
    [...sourceMap.keys()],
    compilerOptions,
    host,
  );
  return scanRuntimeServiceProgram(program, options, Object.keys(sources));
}
