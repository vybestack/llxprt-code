/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
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
  type AuditPolicy,
} from '../check-runtime-state-boundary.js';
import {
  evaluateRatchet,
  formatBlockedAudit,
  parseRatchetBaseline,
  ratchetCountsFromResult,
} from '../runtime-boundary-ratchet.js';

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
function baselineOf(text: string) {
  return parseRatchetBaseline(text);
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

describe('runtime boundary ratchet baseline', () => {
  it('passes when bundle counts equal the baseline', () => {
    put('packages/demo/src/bag.ts', bundleSource);
    const result = audit();
    const verdict = evaluateRatchet(
      result,
      baselineOf(JSON.stringify({ counts: ratchetCountsFromResult(result) })),
    );
    expect(result.findings.length).toBeGreaterThan(0);
    expect(verdict).toMatchObject({
      exitCode: 0,
      increases: [],
      decreases: [],
      unratchetedFindings: [],
    });
  });

  it('passes and reports a decrease when bundle counts fall below the baseline', () => {
    put('packages/demo/src/bag.ts', bundleSource);
    const result = audit();
    const actual =
      ratchetCountsFromResult(result).demo?.['runtime-service-bundle'];
    const verdict = evaluateRatchet(
      result,
      baselineOf(
        JSON.stringify({
          counts: { demo: { 'runtime-service-bundle': (actual ?? 0) + 3 } },
        }),
      ),
    );
    expect(verdict.exitCode).toBe(0);
    expect(verdict.decreases).toEqual([
      {
        owner: 'demo',
        rule: 'runtime-service-bundle',
        baseline: (actual ?? 0) + 3,
        actual,
      },
    ]);
  });

  it('fails when a bundle count rises above the baseline', () => {
    put('packages/demo/src/bag.ts', bundleSource);
    const baseline = baselineOf(
      JSON.stringify({ counts: ratchetCountsFromResult(audit()) }),
    );
    put('packages/demo/src/bag.ts', twoBundlesSource);
    const verdict = evaluateRatchet(audit(), baseline);
    expect(verdict.exitCode).toBe(1);
    expect(verdict.increases.map((entry) => entry.rule)).toContain(
      'runtime-service-bundle',
    );
    expect(verdict.unratchetedFindings).toEqual([]);
  });

  it('fails for a bundle in an owner the baseline does not list', () => {
    put('packages/demo/src/bag.ts', bundleSource);
    const verdict = evaluateRatchet(audit(), baselineOf('{"counts":{}}'));
    expect(verdict.exitCode).toBe(1);
    expect(verdict.increases.every((entry) => entry.baseline === 0)).toBe(true);
  });

  it('fails on a new mutable-state finding even when the baseline covers every bundle', () => {
    put('packages/demo/src/bag.ts', bundleSource);
    const baseline = baselineOf(
      JSON.stringify({ counts: ratchetCountsFromResult(audit()) }),
    );
    put('packages/demo/src/runtime/state.ts', 'export let counter = 0;');
    const verdict = evaluateRatchet(audit(), baseline);
    expect(verdict.exitCode).toBe(1);
    expect(verdict.unratchetedFindings.map((f) => f.rule)).toContain(
      'mutable-state',
    );
  });

  it('fails on an AsyncLocalStorage finding', () => {
    put(
      'packages/demo/src/scope.ts',
      "import { AsyncLocalStorage } from 'node:async_hooks'; export const scope = new AsyncLocalStorage<string>();",
    );
    const verdict = evaluateRatchet(audit(), baselineOf('{"counts":{}}'));
    expect(verdict.exitCode).toBe(1);
    expect(verdict.unratchetedFindings.map((f) => f.rule)).toEqual([
      'async-local-storage',
    ]);
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
    const verdict = evaluateRatchet(audit(), baselineOf('{"counts":{}}'));
    expect(verdict.exitCode).toBe(1);
    expect(verdict.compilerDiagnosticCount).toBeGreaterThan(0);
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

  it('rejects baselines that record a non-ratcheted rule or an invalid count', () => {
    expect(() => baselineOf('{"counts":{"core":{"mutable-state":1}}}')).toThrow(
      'may only record',
    );
    expect(() =>
      baselineOf('{"counts":{"core":{"runtime-service-bundle":-1}}}'),
    ).toThrow('non-negative integer');
    expect(() => baselineOf('{}')).toThrow('"counts"');
  });

  it('keeps the committed baseline parseable and limited to ratcheted rules', () => {
    const text = readFileSync(
      resolve('scripts/runtime-service-shape-baseline.json'),
      'utf8',
    );
    expect(Object.keys(baselineOf(text).counts).length).toBeGreaterThan(0);
  });
});
