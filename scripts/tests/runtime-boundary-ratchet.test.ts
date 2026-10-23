/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  auditRuntimeStateBoundary,
  formatBlockedAudit,
  type AuditPolicy,
} from '../check-runtime-state-boundary.js';

const evidence = join(tmpdir(), 'llxprt-ratchet-fixtures');
let workspace: string;
function put(file: string, text: string): void {
  const path = join(workspace, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
const policy: AuditPolicy = {
  compilerConfig: 'tsconfig.json',
  sourceRoots: ['packages/demo/src'],
  mutableRoots: ['packages/demo/src/runtime'],
  alsRoots: ['packages/demo/src'],
  services: [
    { file: 'packages/demo/src/services.ts', exportName: 'Settings' },
    { file: 'packages/demo/src/services.ts', exportName: 'Manager' },
  ],
  configs: [{ file: 'packages/demo/src/services.ts', exportName: 'Config' }],
  assembly: [],
  ambientSources: [],
  alsAllowances: [],
};
const bundleSource = `
  import { Settings, Manager } from './services.js';
  export interface Bag { settings: Settings; manager: Manager; }
`;
const twoBundlesSource = `${bundleSource}
  export interface OtherBag { settings: Settings; manager: Manager; }
`;

function audit() {
  return auditRuntimeStateBoundary(workspace, policy);
}

beforeEach(() => {
  mkdirSync(evidence, { recursive: true });
  workspace = mkdtempSync(join(evidence, 'fixture-'));
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
  put(
    'packages/demo/src/services.ts',
    `
    export class Settings { value = 1; }
    export class Manager { name = 'manager'; }
    export class Config {}
  `,
  );
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

describe('strict runtime boundary enforcement after ratchet retirement', () => {
  it('fails for an existing service bundle without an allowance', () => {
    put('packages/demo/src/bag.ts', bundleSource);
    const result = audit();
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(1);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        owner: 'demo',
        file: 'packages/demo/src/bag.ts',
        line: 3,
        column: 3,
      }),
    );
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.scanners).toEqual({
      state: 'complete',
      serviceShape: 'complete',
      ambientDelegation: 'complete',
    });
  });

  it('passes only after the service bundle is removed', () => {
    put('packages/demo/src/bag.ts', bundleSource);
    const before = audit();
    expect(before.exitCode).toBe(1);
    expect(before.findings.map((finding) => finding.rule)).toContain(
      'runtime-service-bundle',
    );
    put(
      'packages/demo/src/bag.ts',
      bundleSource.replace(
        'export interface Bag { settings: Settings; manager: Manager; }',
        '',
      ),
    );
    const result = audit();
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.scanners).toEqual({
      state: 'complete',
      serviceShape: 'complete',
      ambientDelegation: 'complete',
    });
  });

  it('reports both service bundles and fails strictly', () => {
    put('packages/demo/src/bag.ts', bundleSource);
    expect(audit().exitCode).toBe(1);
    put('packages/demo/src/bag.ts', twoBundlesSource);
    const result = audit();
    expect(result.exitCode).toBe(1);
    expect(
      result.findings
        .filter((finding) => finding.rule === 'runtime-service-bundle')
        .map((finding) => ({
          owner: finding.owner,
          file: finding.file,
          column: finding.column,
          line: finding.line,
        })),
    ).toEqual([
      { owner: 'demo', file: 'packages/demo/src/bag.ts', column: 3, line: 3 },
      { owner: 'demo', file: 'packages/demo/src/bag.ts', column: 3, line: 5 },
    ]);
    expect(result.countsByOwner.demo?.['runtime-service-bundle']).toBe(2);
    expect(result.compilerDiagnostics).toEqual([]);
  });

  it('fails for a bundle without any owner allowance', () => {
    put('packages/demo/src/bag.ts', bundleSource);
    const result = audit();
    expect(result.exitCode).toBe(1);
    expect(
      result.findings.map((finding) => ({
        owner: finding.owner,
        rule: finding.rule,
      })),
    ).toEqual([{ owner: 'demo', rule: 'runtime-service-bundle' }]);
  });

  it('fails on a new mutable-state finding alongside a bundle', () => {
    put('packages/demo/src/bag.ts', bundleSource);
    expect(audit().exitCode).toBe(1);
    put('packages/demo/src/runtime/state.ts', 'export let counter = 0;');
    const result = audit();
    expect(result.exitCode).toBe(1);
    expect(result.findings.map((f) => f.rule)).toContain('mutable-state');
    expect(result.findings.map((f) => f.rule)).toContain(
      'runtime-service-bundle',
    );
  });

  it('fails on an AsyncLocalStorage finding', () => {
    put(
      'packages/demo/src/scope.ts',
      "import { AsyncLocalStorage } from 'node:async_hooks'; export const scope = new AsyncLocalStorage<string>();",
    );
    const result = audit();
    expect(result.exitCode).toBe(1);
    expect(result.findings.map((f) => f.rule)).toEqual(['async-local-storage']);
  });

  it('does not treat writes to ambient platform globals as module state', () => {
    put(
      'packages/demo/src/runtime/ambient.d.ts',
      'declare var process: { env: Record<string, string | undefined> };',
    );
    put(
      'packages/demo/src/runtime/env.ts',
      '/// <reference path="./ambient.d.ts" />\nexport function configure(project: string): void { process.env.PROJECT = project; }',
    );
    const result = audit();
    expect(
      result.findings.filter((finding) => finding.rule === 'module-mutation'),
    ).toEqual([]);
  });

  it('fails when compiler diagnostics exist', () => {
    put('packages/demo/src/broken.ts', 'export const value: number = "bad";');
    const result = audit();
    expect(result.exitCode).toBe(1);
    expect(result.compilerDiagnostics.length).toBeGreaterThan(0);
  });

  it('names every compiler diagnostic and the blocked scanner', () => {
    put('packages/demo/src/broken.ts', 'export const value: number = "bad";');
    const report = formatBlockedAudit(audit());
    expect(report).toContain('[tsconfig.json]');
    expect(report).toContain('packages/demo/src/broken.ts:1:14');
    expect(report).toContain('TS2322');
    expect(report).toContain(
      "Type 'string' is not assignable to type 'number'",
    );
    expect(report).toContain('scanner serviceShape: blocked-by-compiler');
    expect(report).toContain(
      'scanner ambientDelegation: provisional-compiler-errors',
    );
  });

  it('prints nothing when the audit has no compiler diagnostics', () => {
    put('packages/demo/src/bag.ts', bundleSource);
    expect(formatBlockedAudit(audit())).toBe('');
  });

  it('fails strictly for a compiler-valid service bag parameter', () => {
    put(
      'packages/demo/src/bag.ts',
      `${bundleSource}export function use(bag: Bag): number { return bag.settings.value; }`,
    );
    const result = audit();
    expect(result.exitCode).toBe(1);
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.scanners).toEqual({
      state: 'complete',
      serviceShape: 'complete',
      ambientDelegation: 'complete',
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule: 'runtime-service-bag-parameter',
        file: 'packages/demo/src/bag.ts',
        column: 21,
        line: 4,
        owner: 'demo',
      }),
    );
  });

  it('does not retain a committed allowance baseline', () => {
    expect(
      existsSync(resolve('scripts/runtime-service-shape-baseline.json')),
    ).toBe(false);
  });
});

describe('strict runtime boundary CLI contracts', () => {
  it('runs the strict scanner without a baseline through the package command', () => {
    const manifest: { scripts: Record<string, string> } = JSON.parse(
      readFileSync(resolve('package.json'), 'utf8'),
    );
    expect(manifest.scripts['check:runtime-boundary']).toBe(
      'bun scripts/check-runtime-state-boundary.ts',
    );
  });

  for (const [title, args, option] of [
    [
      'rejects a separated baseline value',
      ['--baseline', 'retired.json'],
      '--baseline',
    ],
    [
      'rejects an equals baseline value',
      ['--baseline=retired.json'],
      '--baseline',
    ],
    ['rejects a bare baseline flag', ['--baseline'], '--baseline'],
    [
      'rejects an unrelated unknown flag',
      ['--not-a-boundary-option'],
      '--not-a-boundary-option',
    ],
  ] satisfies ReadonlyArray<readonly [string, readonly string[], string]>) {
    it(title, () => {
      const output = join(workspace, 'must-not-exist.json');
      const child = spawnSync(
        process.execPath,
        [
          resolve('scripts/check-runtime-state-boundary.ts'),
          '--workspace',
          workspace,
          '--output',
          output,
          ...args,
        ],
        { cwd: workspace, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      expect(child.error).toBeUndefined();
      expect(child.signal).toBeNull();
      expect(child.status).not.toBe(0);
      expect(child.stderr).toContain('ERR_PARSE_ARGS_UNKNOWN_OPTION');
      expect(child.stderr).toContain(option);
      expect(child.stderr).not.toContain('"fatal"');
      expect(child.stderr).not.toContain('"event"');
      expect(child.stderr).not.toContain('"phase"');
      expect(child.stderr).not.toContain('"compilerConfig"');
      expect(child.stdout).toBe('');
      expect(existsSync(output)).toBe(false);
    });
  }
});
