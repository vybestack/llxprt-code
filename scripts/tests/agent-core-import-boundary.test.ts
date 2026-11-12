/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAgentCoreBoundary } from '../check-agent-core-import-boundary.js';

const roots: string[] = [];

function fixture(
  core: string,
  files: Readonly<Record<string, string>> = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-core-boundary-'));
  roots.push(root);
  mkdirSync(join(root, 'packages/agent-core/src'), { recursive: true });
  mkdirSync(join(root, 'packages/other/src'), { recursive: true });
  writeFileSync(join(root, 'packages/agent-core/src/index.ts'), core);
  for (const [path, text] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, text);
  }
  writeFileSync(
    join(root, 'packages/agent-core/tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { '@workspace/other/*': ['../other/src/*'] },
      },
    }),
  );
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('agent-core import boundary', () => {
  it('rejects workspace dependencies through every TypeScript import form and transitive barrels', () => {
    const sources = {
      'packages/other/src/leaf.ts': 'export const value = 1;\n',
      'packages/other/src/barrel.ts': "export * from './leaf.js';\n",
      'packages/agent-core/src/direct.ts':
        "import '@vybestack/llxprt-code-core';\n",
      'packages/agent-core/src/relative.ts':
        "import '../../other/src/leaf.js';\n",
      'packages/agent-core/src/alias.ts':
        "import '@workspace/other/leaf.js';\n",
      'packages/agent-core/src/barrel.ts':
        "export * from '../../other/src/barrel.js';\n",
      'packages/agent-core/src/bridge.ts':
        "export * from '@workspace/other/barrel.js';\n",
      'packages/agent-core/src/type-only.ts':
        "import type { CoreThing } from '@vybestack/llxprt-code-core';\nexport type Value = CoreThing;\n",
      'packages/agent-core/src/dynamic.ts':
        "export const load = () => import('@vybestack/llxprt-code-core');\n",
      'packages/agent-core/src/transitive.ts': "import './bridge.js';\n",
    };
    const root = fixture('export const pureValue = 1;\n', sources);

    const violations = scanAgentCoreBoundary(root);

    expect(violations.map((violation) => violation.kind)).toContain(
      'workspace-import',
    );
    expect(
      new Set(violations.map((violation) => violation.file)).size,
    ).toBeGreaterThanOrEqual(7);
  });

  it('rejects direct and type-only imports of runtime I/O modules', () => {
    const root = fixture(
      "import type { Stats } from 'node:fs';\nexport type FileStats = Stats;\n",
    );

    const violations = scanAgentCoreBoundary(root);

    expect(
      violations.some((violation) => violation.kind === 'runtime-import'),
    ).toBe(true);
  });

  it('rejects ambient I/O and runtime access while allowing pure language values', () => {
    const root = fixture(
      'export const response = fetch("https://example.test");\nexport const now = Date.now();\n',
    );

    const violations = scanAgentCoreBoundary(root);

    expect(
      violations.filter((violation) => violation.kind === 'ambient-io').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('rejects generated imports from runtime modules', () => {
    const root = fixture('export const safe = 1;\n');
    const entry = join(root, 'packages/agent-core/src/index.ts');

    fc.assert(
      fc.property(
        fc.constantFrom('node:fs', 'node:net', 'node:child_process', 'bun:ffi'),
        (specifier) => {
          writeFileSync(entry, `import '${specifier}';\n`);
          expect(
            scanAgentCoreBoundary(root).some(
              (entryViolation) => entryViolation.kind === 'runtime-import',
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 2 },
    );
  });

  it('rejects generated ambient runtime capabilities', () => {
    const root = fixture('export const safe = 1;\n');
    const entry = join(root, 'packages/agent-core/src/index.ts');

    fc.assert(
      fc.property(
        fc.constantFrom('process', 'fetch', 'setTimeout', 'globalThis'),
        (capability) => {
          writeFileSync(entry, `export const forbidden = ${capability};\n`);
          expect(
            scanAgentCoreBoundary(root).some(
              (entryViolation) => entryViolation.kind === 'ambient-io',
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 2 },
    );
  });

  it('accepts a pure local import graph and executes its exported value', async () => {
    const root = fixture(
      "import { increment } from './math.js';\nexport const answer = increment(40);\n",
      {
        'packages/agent-core/src/math.ts':
          'export function increment(value: number): number { return value + 2; }\n',
      },
    );

    const violations = scanAgentCoreBoundary(root);
    const module = await import(join(root, 'packages/agent-core/src/index.ts'));

    expect(violations).toEqual([]);
    expect(module.answer).toBe(42);
  });
});
