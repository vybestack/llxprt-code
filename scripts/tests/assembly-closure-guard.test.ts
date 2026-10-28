/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import ts from 'typescript';
import { findAssemblyClosureViolations } from '../assembly-closure-guard.js';

const FIXTURE_FILE = '/fixture/assembly.ts';
const FIXTURE_PRELUDE = `
declare function publishAgentFacade(...inputs: unknown[]): unknown;
declare function publishLeafFacade(...inputs: unknown[]): unknown;
declare function facadeInputsForPreferred(...inputs: unknown[]): unknown[];
declare class AgentImpl { constructor(...inputs: unknown[]); }
declare class AgentOperations { constructor(...inputs: unknown[]); }
interface Owner { read(): number; }
`;

function fixtureViolations(
  source: string,
): ReturnType<typeof findAssemblyClosureViolations> {
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
