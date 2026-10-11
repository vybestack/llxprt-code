/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  discoverProductionSources,
  isTestSource,
  selectBoundarySources,
} from '../runtime-source-discovery.js';

let workspace: string;
const evidence = join(tmpdir(), 'llxprt-production-audit-unblocked-cases');
function put(file: string, text: string): void {
  mkdirSync(dirname(join(workspace, file)), { recursive: true });
  writeFileSync(join(workspace, file), text);
}
beforeEach(() => {
  mkdirSync(evidence, { recursive: true });
  workspace = mkdtempSync(join(evidence, 'sibling-'));
  put(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        types: [],
      },
    }),
  );
  put('packages/demo/src/main.ts', 'export const main = 1;');
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

it('recognizes camel-cased TestSetup helpers without omitting production-reached helpers', () => {
  expect(isTestSource('packages/mcp/src/auth/oauthProviderTestSetup.ts')).toBe(
    true,
  );
  put('packages/demo/src/featureTestSetup.ts', 'export const setup = 1;');
  expect(
    discoverProductionSources(workspace, ['packages/demo/src']),
  ).not.toContain(join(workspace, 'packages/demo/src/featureTestSetup.ts'));
  put(
    'packages/demo/src/main.ts',
    "export { setup } from './featureTestSetup.js';",
  );
  expect(
    selectBoundarySources(workspace, ['packages/demo/src'], ['tsconfig.json'])
      .files,
  ).toContain(join(workspace, 'packages/demo/src/featureTestSetup.ts'));
});
it('ignores emitted siblings but audits independent JavaScript', () => {
  put('packages/demo/src/generated.ts', 'export const generated = 1;');
  put('packages/demo/src/generated.js', "import 'missing-generated-package';");
  put(
    'packages/demo/src/generated.js.map',
    JSON.stringify({ version: 3, sources: ['generated.ts'], mappings: '' }),
  );
  put('packages/demo/src/declared.ts', 'export const declared = 2;');
  put('packages/demo/src/declared.js', "import 'missing-declared-package';");
  put(
    'packages/demo/src/declared.d.ts',
    'export declare const declared: number;',
  );
  put('packages/demo/src/manual.ts', 'export const manual = 3;');
  put('packages/demo/src/manual.js', 'export let active = 1;');
  put('packages/demo/src/only.js', 'export let active = 2;');
  const files = selectBoundarySources(
    workspace,
    ['packages/demo/src'],
    ['tsconfig.json'],
  ).files;
  const selected = files.map((file) => file.slice(workspace.length + 1));
  expect(selected).toContain('packages/demo/src/only.js');
  expect(selected).toContain('packages/demo/src/manual.js');
  expect(selected).not.toContain('packages/demo/src/generated.js');
  expect(selected).not.toContain('packages/demo/src/declared.js');
  expect(selected).toContain('packages/demo/src/generated.ts');
  expect(
    discoverProductionSources(workspace, ['packages/demo/src']),
  ).not.toContain(join(workspace, 'packages/demo/src/generated.js'));
});

it('keeps explicitly shipped JavaScript beside a generated declaration', () => {
  put('packages/demo/src/generated.ts', 'export const generated = 1;');
  put('packages/demo/src/generated.js', 'export let active = 1;');
  put(
    'packages/demo/src/generated.d.ts',
    'export declare const active: number;',
  );
  const selection = selectBoundarySources(
    workspace,
    ['packages/demo/src'],
    ['tsconfig.json'],
    {
      files: ['packages/demo/src/generated.js'],
    },
  );
  expect(selection.files).toContain(
    join(workspace, 'packages/demo/src/generated.js'),
  );
});

it('includes actual MCP TypeScript production sources without emitted siblings', () => {
  const root = resolve('.');
  const files = discoverProductionSources(root, [
    'packages/mcp/src',
    'packages/telemetry/src',
    'plugins/google-mcp-auth/src',
  ]);
  expect(files).toContain(
    join(root, 'plugins/google-mcp-auth/src/google-auth-provider.ts'),
  );
  expect(files).not.toContain(
    join(root, 'plugins/google-mcp-auth/src/google-auth-provider.js'),
  );
  expect(files).toContain(
    join(root, 'packages/mcp/src/auth/oauth-provider.ts'),
  );
  expect(files).toContain(
    join(root, 'packages/telemetry/src/utils/debugLogger.ts'),
  );
});
