/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

/**
 * Structural rule for the agent assembly: no closure that reaches the live
 * agent may be created inside an assembly class. The facade is published by
 * the module-level `publishAgentFacade` (through `publishLeafFacade`), fed by
 * module-level `facadeInputsFor<Leaf>` functions, so that nothing the agent
 * keeps shares a scope with an assembly instance.
 */

const ASSEMBLY_CLASSES: ReadonlySet<string> = new Set([
  'ForegroundAssembly',
  'ForegroundAgentAssembly',
  'PreferredAgentAssembly',
  'AdoptedSessionAssembly',
  'AdoptedAgentAssembly',
  'AgentActivationBootstrap',
]);
const PUBLISHING_CONSTRUCTORS: ReadonlySet<string> = new Set([
  'AgentImpl',
  'AgentOperations',
  'SessionProviderControl',
]);
const FACADE_INPUT_BUILDER = /^facadeInputsFor[A-Z]\w*$/;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: 'declared-in-class' | 'assembly-closure';
  readonly detail: string;
}

function isFacadeFunctionName(name: string): boolean {
  return (
    name === 'publishAgentFacade' ||
    name === 'publishLeafFacade' ||
    FACADE_INPUT_BUILDER.test(name)
  );
}

function enclosingAssemblyClass(node: ts.Node): string | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isClassLike(current)) {
      const name = current.name?.text;
      if (name !== undefined && ASSEMBLY_CLASSES.has(name)) return name;
    }
  }
  return undefined;
}

function enclosingClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isClassLike(current)) return current;
  }
  return undefined;
}

function isNamedDeclaration(
  node: ts.Node,
): node is
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.PropertyDeclaration
  | ts.VariableDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isVariableDeclaration(node)
  );
}

function declaredName(node: ts.Node): string | undefined {
  if (!isNamedDeclaration(node)) return undefined;
  return node.name !== undefined && ts.isIdentifier(node.name)
    ? node.name.text
    : undefined;
}

function calleeName(node: ts.CallExpression | ts.NewExpression): string {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return '';
}

function isPublishingCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && isFacadeFunctionName(calleeName(node));
}

function isPublishingConstruction(node: ts.Node): node is ts.NewExpression {
  return (
    ts.isNewExpression(node) && PUBLISHING_CONSTRUCTORS.has(calleeName(node))
  );
}

function isBindCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'bind'
  );
}

function isFieldReadReceiver(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent)) &&
    parent.expression === node
  );
}

function typeNamesOf(checker: ts.TypeChecker, node: ts.Node): string[] {
  const type = checker.getTypeAtLocation(node);
  const constraint = checker.getBaseConstraintOfType(type);
  return [
    type.getSymbol()?.getName(),
    constraint?.getSymbol()?.getName(),
  ].filter((name): name is string => name !== undefined);
}

function describeClosure(
  checker: ts.TypeChecker,
  node: ts.Node,
): string | undefined {
  if (ts.isArrowFunction(node)) return 'arrow function';
  if (ts.isFunctionExpression(node)) return 'function expression';
  if (isBindCall(node)) return '.bind(...) call';
  const isReceiverRead = isFieldReadReceiver(node);
  if (
    (node.kind === ts.SyntaxKind.ThisKeyword || ts.isIdentifier(node)) &&
    !isReceiverRead
  ) {
    const holder = typeNamesOf(checker, node).find((name) =>
      ASSEMBLY_CLASSES.has(name),
    );
    if (holder !== undefined) return `reference to ${holder}`;
  }
  return undefined;
}

function findClosureInArguments(
  checker: ts.TypeChecker,
  call: ts.CallExpression | ts.NewExpression,
): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    const closure = describeClosure(checker, node);
    if (closure !== undefined) {
      found = closure;
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const argument of call.arguments ?? []) visit(argument);
  return found;
}

export function findAssemblyClosureViolations(
  program: ts.Program,
  files: readonly ts.SourceFile[],
): readonly Violation[] {
  const checker = program.getTypeChecker();
  const violations: Violation[] = [];
  const report = (
    node: ts.Node,
    rule: Violation['rule'],
    detail: string,
  ): void => {
    const source = node.getSourceFile();
    violations.push({
      file: source.fileName,
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      rule,
      detail,
    });
  };
  const visit = (node: ts.Node): void => {
    const name = declaredName(node);
    if (
      name !== undefined &&
      isFacadeFunctionName(name) &&
      enclosingClass(node) !== undefined
    )
      report(node, 'declared-in-class', `${name} is declared inside a class`);
    if (
      (isPublishingCall(node) || isPublishingConstruction(node)) &&
      enclosingAssemblyClass(node) !== undefined
    ) {
      const closure = findClosureInArguments(checker, node);
      if (closure !== undefined)
        report(
          node,
          'assembly-closure',
          `${calleeName(node)} receives a ${closure} inside ${enclosingAssemblyClass(node)}`,
        );
    }
    ts.forEachChild(node, visit);
  };
  for (const file of files) visit(file);
  return violations;
}

const FIXTURE_FILE = '/fixture/assembly.ts';
const FIXTURE_PRELUDE = `
declare function publishAgentFacade(...inputs: unknown[]): unknown;
declare function publishLeafFacade(...inputs: unknown[]): unknown;
declare function facadeInputsForPreferred(...inputs: unknown[]): unknown[];
declare class AgentImpl { constructor(...inputs: unknown[]); }
declare class AgentOperations { constructor(...inputs: unknown[]); }
interface Owner { read(): number; }
`;

function fixtureViolations(source: string): readonly Violation[] {
  const text = FIXTURE_PRELUDE + source;
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const base = ts.createCompilerHost(options, true);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (file) => file === FIXTURE_FILE || base.fileExists(file),
    readFile: (file) => (file === FIXTURE_FILE ? text : base.readFile(file)),
    getSourceFile: (file, languageVersion, onError, shouldCreate) =>
      file === FIXTURE_FILE
        ? ts.createSourceFile(file, text, languageVersion, true)
        : base.getSourceFile(file, languageVersion, onError, shouldCreate),
  };
  const program = ts.createProgram([FIXTURE_FILE], options, host);
  const fixture = program.getSourceFile(FIXTURE_FILE);
  if (fixture === undefined) throw new Error('Fixture was not loaded');
  return findAssemblyClosureViolations(program, [fixture]);
}

describe('assembly closure guard fixtures', () => {
  it('rejects a bound method passed to AgentImpl from an assembly method', () => {
    const violations = fixtureViolations(`
      class PreferredAgentAssembly {
        stream(): void {}
        publish(): unknown {
          return new AgentImpl({ stream: this.stream.bind(this) });
        }
      }
    `);
    expect(violations.map((v) => v.rule)).toEqual(['assembly-closure']);
    expect(violations[0]?.detail).toContain('.bind(...) call');
  });

  it('rejects a closure over a captured assembly alias', () => {
    const violations = fixtureViolations(`
      class PreferredAgentAssembly {
        value = 1;
        read(): number { return this.value; }
        publish(): unknown {
          const self = this;
          return publishAgentFacade({ f: () => self.read() });
        }
      }
    `);
    expect(violations.map((v) => v.rule)).toEqual(['assembly-closure']);
    expect(violations[0]?.detail).toContain('arrow function');
  });

  it('rejects an arrow written in an assembly method and passed to a facade input builder', () => {
    const violations = fixtureViolations(`
      class PreferredAgentAssembly {
        publish(): unknown {
          return facadeInputsForPreferred(() => 1);
        }
      }
    `);
    expect(violations.map((v) => v.rule)).toEqual(['assembly-closure']);
  });

  it('rejects the assembly instance itself passed to a publishing constructor', () => {
    const violations = fixtureViolations(`
      class AdoptedAgentAssembly {
        publish(): unknown {
          return new AgentOperations(this);
        }
      }
    `);
    expect(violations.map((v) => v.rule)).toEqual(['assembly-closure']);
    expect(violations[0]?.detail).toContain(
      'reference to AdoptedAgentAssembly',
    );
  });

  it('rejects publishAgentFacade and facadeInputsFor builders declared inside a class', () => {
    const violations = fixtureViolations(`
      class PreferredAgentAssembly {
        publishAgentFacade(): void {}
        static facadeInputsForPreferred(): void {}
      }
    `);
    expect(violations.map((v) => v.rule)).toEqual([
      'declared-in-class',
      'declared-in-class',
    ]);
  });

  it('accepts field reads passed to a facade input builder', () => {
    const violations = fixtureViolations(`
      class PreferredAgentAssembly {
        preferredSessionClient: Owner = { read: () => 1 };
        mcpRuntime: Owner = { read: () => 2 };
        publish(): unknown {
          return publishAgentFacade(
            ...facadeInputsForPreferred(this.preferredSessionClient, this.mcpRuntime),
          );
        }
      }
    `);
    expect(violations).toEqual([]);
  });

  it('accepts a record built in a module-level function from owner parameters', () => {
    const violations = fixtureViolations(`
      function facadeInputsForAdopted(owner: Owner): unknown[] {
        return [{ read: () => owner.read() }];
      }
      function publish(owner: Owner): unknown {
        return publishAgentFacade({ read: () => owner.read() }, ...facadeInputsForAdopted(owner));
      }
      class AdoptedAgentAssembly {
        owner: Owner = { read: () => 3 };
        run(): unknown { return publish(this.owner); }
      }
    `);
    expect(violations).toEqual([]);
  });
});
