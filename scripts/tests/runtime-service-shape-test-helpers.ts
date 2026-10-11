/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolve } from 'node:path';
import ts from 'typescript';
import {
  scanRuntimeServiceProgram,
  scanRuntimeServiceShapes,
  type RuntimeServiceShapeOptions,
  type RuntimeServiceShapeFinding,
} from './runtime-service-shape-guard.js';

export const roots = {
  'services.ts': `
    export class Scheduler { schedule(): void {} }
    export class Context { contextId = 'session'; }
    export class Provider { getModel(): string { return 'model'; } }
    export class Config {
      scheduler(): Scheduler { return new Scheduler(); }
      renamedContext(): Context { return new Context(); }
      get current(): Context { return new Context(); }
      data(): Readonly<{ model: string }> { return { model: 'model' }; }
    }
  `,
  'barrel.ts': `export { Scheduler as Clock, Context as Session } from './services.js';`,
};
export const options: RuntimeServiceShapeOptions = {
  services: ['Scheduler', 'Context', 'Provider'].map((exportName) => ({
    file: 'services.ts',
    exportName,
  })),
  configs: [{ file: 'services.ts', exportName: 'Config' }],
  assembly: [{ file: 'agents/assembly.ts', functionName: 'assemble' }],
};
export const imports = `import { Scheduler, Context, Provider, Config } from './services.js';\n`;
export function scan(
  source: string,
  file = 'consumer.ts',
): readonly RuntimeServiceShapeFinding[] {
  return scanRuntimeServiceShapes({ ...roots, [file]: source }, options);
}

export function scanInstalled(
  source: string,
): readonly RuntimeServiceShapeFinding[] {
  const file = resolve('closed-type-installed-fixture.ts');
  const compilerOptions: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const base = ts.createCompilerHost(compilerOptions, true);
  const program = ts.createProgram([file], compilerOptions, {
    ...base,
    getSourceFile: (name, version) =>
      name === file
        ? ts.createSourceFile(
            file,
            `export class Clock { tick(): void {} } export class Session { id = 'session'; }\n${source}`,
            version,
            true,
          )
        : base.getSourceFile(name, version),
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    throw new Error(
      diagnostics
        .map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        )
        .join('\n'),
    );
  }
  return scanRuntimeServiceProgram(
    program,
    {
      services: ['Clock', 'Session'].map((exportName) => ({
        file,
        exportName,
      })),
      configs: [],
    },
    [file],
  );
}
