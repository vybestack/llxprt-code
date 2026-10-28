/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useMutationBoundaryFixture } from './runtime-state-mutation-fixture.js';

describe('runtime mutation boundary controls', () => {
  const fixture = useMutationBoundaryFixture();
  it.each(['named', 'namespace', 'reexport'])(
    'rejects module storage passed through an imported %s helper',
    (style) => {
      fixture.put(
        'packages/demo/src/writer.ts',
        'export function store(target: Record<string, number>): void { target.current = 1; }',
      );
      fixture.put(
        'packages/demo/src/relay.ts',
        "export { store as save } from './writer.js';",
      );
      const imports = {
        named: "import { store as write } from '../writer.js';",
        namespace: "import * as writer from '../writer.js';",
        reexport: "import { save as write } from '../relay.js';",
      };
      const imported = imports[style];
      const call = style === 'namespace' ? 'writer.store' : 'write';
      fixture.put(
        'packages/demo/src/runtime/state.ts',
        `${imported} const sessions: Record<string, number> = Object.freeze({ current: 0 }); export function run(): void { ${call}(sessions); }`,
      );
      const result = fixture.audit();
      expect(result.compilerDiagnostics).toEqual([]);
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          declaration: 'sessions',
          rule: 'module-mutation',
        }),
      );
      expect(result.exitCode).toBe(1);
    },
  );

  it('rejects module storage passed through a mutating class method', () => {
    fixture.put(
      'packages/demo/src/runtime/state.ts',
      'const sessions: Record<string, number> = Object.freeze({ current: 0 }); class Writer { store(target: Record<string, number>): void { target.current = 1; } } export function run(): void { new Writer().store(sessions); }',
    );
    const result = fixture.audit();
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        declaration: 'sessions',
        rule: 'module-mutation',
      }),
    );
    expect(result.exitCode).toBe(1);
  });

  it.each([
    'const { sessions: held } = { sessions }; held.current = 1;',
    'const { nested: { sessions: held } } = { nested: { sessions } }; held.current = 1;',
    'const [held] = [sessions]; held.current = 1;',
    'let held: Record<string, number> = {}; held = sessions; held.current = 1;',
  ])('rejects destructured and reassigned module storage in %s', (body) => {
    fixture.put(
      'packages/demo/src/runtime/state.ts',
      `const sessions: Record<string, number> = Object.freeze({ current: 0 }); export function run(): void { ${body} }`,
    );
    const result = fixture.audit();
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        declaration: 'sessions',
        rule: 'module-mutation',
      }),
    );
    expect(result.exitCode).toBe(1);
  });

  it('permits imported mutation of instance-owned storage', () => {
    fixture.put(
      'packages/demo/src/writer.ts',
      'export function store(target: Record<string, number>): void { target.current = 1; }',
    );
    fixture.put(
      'packages/demo/src/runtime/state.ts',
      "import { store } from '../writer.js'; export class Owner { private state: Record<string, number> = {}; run(): void { store(this.state); } }",
    );
    const result = fixture.audit();
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});
