/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deriveStateRoots, resolveStateRoots } from '../runtime-state-roots.js';
import {
  auditRuntimeStateBoundary,
  type AuditPolicy,
} from '../check-runtime-state-boundary.js';

const evidence = resolve(
  import.meta.dir,
  '../tmp/verify2616-final/scanner-fixtures',
);
let workspace: string;

function put(file: string, text: string): void {
  const path = resolve(workspace, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const mutableTable = "export const table = new Set(['a']);";

const discoveryPolicy: AuditPolicy = {
  compilerConfig: 'tsconfig.json',
  sourceRoots: ['packages/demo/src'],
  stateRootDiscovery: {
    directoryNames: ['runtime', 'api', 'settings'],
  },
  services: [],
  configs: [],
  assembly: [],
  ambientSources: [],
  alsAllowances: [],
};

beforeEach(() => {
  mkdirSync(evidence, { recursive: true });
  workspace = mkdtempSync(resolve(evidence, 'state-roots-'));
  put(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        types: [],
        skipLibCheck: true,
      },
      include: ['packages'],
    }),
  );
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

describe('runtime state root discovery', () => {
  it('follows the state directories wherever a package keeps them', () => {
    put('packages/demo/src/api/state.ts', mutableTable);
    put('packages/demo/src/settings/state.ts', mutableTable);
    put('packages/demo/src/runtime/state.ts', mutableTable);
    put('packages/demo/src/notes.ts', mutableTable);
    put('packages/demo/src/__tests__/state.test.ts', mutableTable);
    const roots = deriveStateRoots(workspace, ['packages/demo/src'], {
      directoryNames: ['runtime', 'api', 'settings'],
    });
    expect(roots.mutableRoots).toEqual([
      'packages/demo/src/api',
      'packages/demo/src/runtime',
      'packages/demo/src/settings',
    ]);
    expect(roots.alsRoots).toEqual(['packages/demo/src']);
  });

  it('warns by failing when the convention matches nothing', () => {
    put('packages/demo/src/notes.ts', mutableTable);
    expect(() =>
      deriveStateRoots(workspace, ['packages/demo/src'], {
        directoryNames: ['runtime', 'api', 'settings'],
      }),
    ).toThrow('found no runtime/api/settings directory');
    expect(() =>
      deriveStateRoots(workspace, ['packages/demo/src'], {
        directoryNames: [],
      }),
    ).toThrow('names no directory');
  });

  it('fails for an explicitly declared state file that does not exist', () => {
    put('packages/demo/src/runtime/state.ts', mutableTable);
    expect(() =>
      deriveStateRoots(workspace, ['packages/demo/src'], {
        directoryNames: ['runtime'],
        files: ['packages/demo/src/ui/contexts/RuntimeContext.tsx'],
      }),
    ).toThrow('does not exist');
  });

  it('keeps explicit fixture roots mutually exclusive with discovery', () => {
    put('packages/demo/src/runtime/state.ts', mutableTable);
    expect(() =>
      resolveStateRoots(workspace, {
        sourceRoots: ['packages/demo/src'],
        mutableRoots: ['packages/demo/src/runtime'],
        stateRootDiscovery: { directoryNames: ['runtime'] },
      }),
    ).toThrow('both explicit roots and a discovery convention');
    expect(
      resolveStateRoots(workspace, {
        sourceRoots: ['packages/demo/src'],
        mutableRoots: ['packages/demo/src/runtime'],
        alsRoots: ['packages/demo/src'],
      }),
    ).toEqual({
      mutableRoots: ['packages/demo/src/runtime'],
      alsRoots: ['packages/demo/src'],
    });
  });
});

describe('discovered roots feed the audit', () => {
  it.each(['api', 'settings'])(
    'reports module state in a discovered %s directory',
    (directory) => {
      put(`packages/demo/src/${directory}/state.ts`, mutableTable);
      const result = auditRuntimeStateBoundary(workspace, discoveryPolicy);
      expect(result.compilerDiagnostics).toEqual([]);
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          file: `packages/demo/src/${directory}/state.ts`,
          rule: 'mutable-state',
          declaration: 'table',
        }),
      );
      expect(result.exitCode).toBe(1);
    },
  );

  it('leaves module state outside the state directories unreported', () => {
    put('packages/demo/src/runtime/state.ts', 'export const value = 1;');
    put('packages/demo/src/notes.ts', mutableTable);
    const result = auditRuntimeStateBoundary(workspace, discoveryPolicy);
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});
