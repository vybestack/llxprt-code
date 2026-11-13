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
  paths: Readonly<Record<string, readonly string[]>> = {},
  compilerOptions: Readonly<Record<string, string>> = {},
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
        paths: { '@workspace/other/*': ['../other/src/*'], ...paths },
        ...compilerOptions,
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
  it('rejects each workspace dependency import form and transitive barrel independently', () => {
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

    for (const { source, kind } of [
      { source: 'direct.ts', kind: 'workspace-import' },
      { source: 'relative.ts', kind: 'runtime-import' },
      { source: 'alias.ts', kind: 'runtime-import' },
      { source: 'barrel.ts', kind: 'runtime-import' },
      { source: 'bridge.ts', kind: 'runtime-import' },
      { source: 'type-only.ts', kind: 'workspace-import' },
      { source: 'dynamic.ts', kind: 'workspace-import' },
    ]) {
      expect(
        violations.some(
          (entry) => entry.file.endsWith(source) && entry.kind === kind,
        ),
        `${source} should be rejected`,
      ).toBe(true);
    }
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

  it('rejects unresolved relative import edges', () => {
    const root = fixture("export * from './missing.js';");
    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'unresolved-import',
      ),
    ).toBe(true);
  });

  it('rejects unresolved import-equals edges', () => {
    const root = fixture("import absent = require('missing-package');");
    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'unresolved-import',
      ),
    ).toBe(true);
  });

  it('rejects import-equals syntax for Node builtins', () => {
    const root = fixture("import fs = require('node:fs'); export { fs };");
    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'runtime-import',
      ),
    ).toBe(true);
  });

  it('rejects computed process access through the Node global alias', () => {
    const root = fixture("export const env = global['process'].env;");
    expect(
      scanAgentCoreBoundary(root).some((entry) => entry.kind === 'ambient-io'),
    ).toBe(true);
  });

  it('rejects direct process access through the Node global alias', () => {
    const root = fixture('export const env = global.process.env;');
    expect(
      scanAgentCoreBoundary(root).some((entry) => entry.kind === 'ambient-io'),
    ).toBe(true);
  });

  it('rejects a CommonJS require call to a Node builtin', () => {
    const root = fixture("export const fs = require('node:fs');");
    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'runtime-import',
      ),
    ).toBe(true);
  });

  it('rejects a static template-string dynamic import of a Node builtin', () => {
    const root = fixture('export const load = () => import(`node:fs`);');
    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'runtime-import',
      ),
    ).toBe(true);
  });

  it('rejects an interpolated dynamic import specifier', () => {
    const root = fixture(
      'export const load = (suffix: string) => import(`node:${suffix}`);',
    );
    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'runtime-import',
      ),
    ).toBe(true);
  });

  it('rejects process access through globalThis', () => {
    const root = fixture('export const env = globalThis.process.env;');
    expect(
      scanAgentCoreBoundary(root).some((entry) => entry.kind === 'ambient-io'),
    ).toBe(true);
  });

  it('rejects a Node builtin reached through a path alias', () => {
    const root = fixture(
      "export * from '@io';",
      {
        'helpers/io.ts': "export * from 'node:fs';",
      },
      { '@io': ['../../helpers/io.ts'] },
    );
    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'runtime-import',
      ),
    ).toBe(true);
  });

  it('rejects an unapproved installed package even when it re-exports Node I/O', () => {
    const root = fixture("export * from 'io-alias';", {
      'node_modules/io-alias/package.json': JSON.stringify({
        name: 'io-alias',
        type: 'module',
        main: './index.ts',
        types: './index.ts',
      }),
      'node_modules/io-alias/index.ts': "export * from 'node:fs';",
    });
    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'runtime-import',
      ),
    ).toBe(true);
  });

  it('does not flag inert process and console property names', () => {
    const root = fixture('export const value = { process: 1, console: 2 };');
    expect(scanAgentCoreBoundary(root)).toEqual([]);
  });

  it('does not flag locally declared process and console identifiers', () => {
    const root = fixture(
      'const process = { env: 1 }; const console = { log: 2 }; export const value = process.env + console.log;',
    );
    expect(scanAgentCoreBoundary(root)).toEqual([]);
  });

  it('treats a for-of loop binding named document as a local binding', () => {
    const root = fixture(
      `export const titles = (documents: readonly string[]): string[] => {
  const result: string[] = [];
  for (const document of documents) result.push(document);
  return result;
};
`,
    );
    expect(scanAgentCoreBoundary(root)).toEqual([]);
  });

  it('treats a for-in loop binding named process as a local binding', () => {
    const root = fixture(
      `export const keys = (values: Record<string, number>): string[] => {
  const result: string[] = [];
  for (const process in values) result.push(process);
  return result;
};
`,
    );
    expect(scanAgentCoreBoundary(root)).toEqual([]);
  });

  it('treats a catch clause binding named console as a local binding', () => {
    const root = fixture(
      `export const message = (): string => {
  try {
    throw new Error('failed');
  } catch (console) {
    return String(console);
  }
};
`,
    );
    expect(scanAgentCoreBoundary(root)).toEqual([]);
  });

  it('treats a destructured for-of binding named document as a local binding', () => {
    const root = fixture(
      `export const names = (people: ReadonlyArray<{ readonly document: string }>): string[] => {
  const result: string[] = [];
  for (const { document } of people) result.push(document);
  return result;
};
`,
    );
    expect(scanAgentCoreBoundary(root)).toEqual([]);
  });

  it('treats destructured declarations and parameters as local bindings', () => {
    const root = fixture(
      `export const pick = ({ document }: { readonly document: string }): string => {
  const { process } = { process: 1 };
  return document + String(process);
};
`,
    );
    expect(scanAgentCoreBoundary(root)).toEqual([]);
  });

  it('rejects an undeclared loop target named document', () => {
    const root = fixture(
      `export const sweep = (documents: readonly string[]): void => {
  for (document of documents) void document;
};
`,
    );
    expect(
      scanAgentCoreBoundary(root).some((entry) => entry.kind === 'ambient-io'),
    ).toBe(true);
  });

  it('rejects a catch binding named console used outside its catch clause', () => {
    const root = fixture(
      `export const log = (): void => {
  try {
    throw new Error('failed');
  } catch (console) {
    void console;
  }
  void console;
};
`,
    );
    expect(
      scanAgentCoreBoundary(root).some((entry) => entry.kind === 'ambient-io'),
    ).toBe(true);
  });

  it('rejects helper barrels and unapproved external runtime exports', () => {
    const root = fixture("export * from '../../../helpers/bridge.js';", {
      'helpers/bridge.ts': "export * from 'node:fs';",
    });

    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'runtime-import',
      ),
    ).toBe(true);
  });

  it('accepts runtime local bindings and imports from an allowed module', () => {
    const root = fixture(
      "import { value as process } from 'zod'; function fetch(fetch: () => number): number { return fetch(); } class console {} const Date = 1; export const result = process + fetch() + new console() + Date;",
      {
        'node_modules/zod/package.json': JSON.stringify({
          name: 'zod',
          types: './pure.d.ts',
          main: './pure.js',
          exports: { '.': { types: './pure.d.ts', import: './pure.js' } },
        }),
        'node_modules/zod/pure.d.ts': 'export declare const value: number;',
        'node_modules/zod/pure.js': 'export const value = 1;',
      },
    );

    expect(scanAgentCoreBoundary(root)).toEqual([]);
  });

  it('checks the runtime export condition of the audited Zod entry point', () => {
    const root = fixture("import { value } from 'zod'; export { value };", {
      'node_modules/zod/package.json': JSON.stringify({
        name: 'zod',
        types: './pure.d.ts',
        main: './pure.d.ts',
        exports: { '.': { types: './pure.d.ts', import: './runtime.js' } },
      }),
      'node_modules/zod/pure.d.ts': 'export declare const value: number;',
      'node_modules/zod/runtime.js': "export * from 'node:fs';",
    });
    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'runtime-import',
      ),
    ).toBe(true);
  });

  it('rejects runtime exports selected by import-equals from every Zod condition', () => {
    const root = fixture(
      "import z = require('zod'); export { z };",
      {
        'node_modules/zod/package.json': JSON.stringify({
          name: 'zod',
          type: 'module',
          types: './pure.d.ts',
          main: './pure.js',
          exports: {
            '.': {
              types: './pure.d.ts',
              import: './pure.js',
              require: './io.cjs',
            },
          },
        }),
        'node_modules/zod/pure.d.ts': 'export declare const value: number;',
        'node_modules/zod/pure.js': 'export const value = 1;',
        'node_modules/zod/io.cjs': "module.exports = require('node:fs');",
      },
      {},
      { module: 'NodeNext', moduleResolution: 'NodeNext' },
    );

    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'runtime-import',
      ),
    ).toBe(true);
  });

  it('rejects ambient declarations that shadow runtime capabilities', () => {
    const root = fixture(
      'declare const process: { env: Record<string, string> }; export const env = process.env;',
    );

    expect(
      scanAgentCoreBoundary(root).some((entry) => entry.kind === 'ambient-io'),
    ).toBe(true);
  });

  it('rejects import.meta.require calls to runtime modules', () => {
    const root = fixture("export const fs = import.meta.require('node:fs');");
    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'runtime-import',
      ),
    ).toBe(true);
  });

  it('rejects import.meta.env while allowing import.meta.url', () => {
    const environmentRoot = fixture('export const env = import.meta.env;');
    const urlRoot = fixture('export const url = import.meta.url;');

    expect(
      scanAgentCoreBoundary(environmentRoot).some(
        (entry) => entry.kind === 'ambient-io',
      ),
    ).toBe(true);
    expect(scanAgentCoreBoundary(urlRoot)).toEqual([]);
  });

  it('scans the literal CommonJS runtime target instead of its declaration', () => {
    const root = fixture(
      "import value = require('zod'); export { value };",
      {
        'node_modules/zod/package.json': JSON.stringify({
          name: 'zod',
          types: './index.d.cts',
          exports: { '.': { types: './index.d.cts', require: './index.cjs' } },
        }),
        'node_modules/zod/index.d.cts': 'export declare const value: number;',
        'node_modules/zod/index.cjs':
          "module.exports = require('./nested.cjs');",
        'node_modules/zod/nested.d.cts': 'export declare const value: number;',
        'node_modules/zod/nested.cjs': "module.exports = require('node:fs');",
      },
      {},
      { module: 'NodeNext', moduleResolution: 'NodeNext' },
    );

    expect(
      scanAgentCoreBoundary(root).some(
        (entry) =>
          entry.file.endsWith('nested.cjs') && entry.kind === 'runtime-import',
      ),
    ).toBe(true);
  });

  it('scans the literal ES module runtime target from an .mjs source', () => {
    const root = fixture("import value from 'zod'; export { value };", {
      'node_modules/zod/package.json': JSON.stringify({
        name: 'zod',
        types: './index.d.mts',
        exports: { '.': { types: './index.d.mts', import: './index.mjs' } },
      }),
      'node_modules/zod/index.d.mts': 'export declare const value: number;',
      'node_modules/zod/index.mjs': "export * from './nested.mjs';",
      'node_modules/zod/nested.d.mts': 'export declare const value: number;',
      'node_modules/zod/nested.mjs': "export * from 'node:fs';",
    });

    expect(
      scanAgentCoreBoundary(root).some(
        (entry) => entry.kind === 'runtime-import',
      ),
    ).toBe(true);
  });

  it('rejects a literal JavaScript runtime target outside the audited packages', () => {
    const root = fixture("import 'zod';", {
      'node_modules/zod/package.json': JSON.stringify({
        name: 'zod',
        types: './index.d.ts',
        exports: {
          '.': { types: './index.d.ts', import: './index.js' },
        },
      }),
      'node_modules/zod/index.d.ts': 'export declare const value: number;',
      'node_modules/zod/index.js': "import '../outside.js';",
      'node_modules/outside.js': 'export const env = process.env;',
    });

    expect(
      scanAgentCoreBoundary(root).some(
        (entry) =>
          entry.file.endsWith('node_modules/zod/index.js') &&
          entry.kind === 'runtime-import' &&
          entry.detail.includes('outside.js'),
      ),
    ).toBe(true);
  });
});
