/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseSourceFile,
  scanGeminiExports,
  scanGenaiImports,
} from '../genai-enclave/scanner.ts';
import { validateManifestDependencies } from '../genai-enclave/manifest-enforcement.ts';
import {
  discoverPackageWorkspaces,
  verifyTransitiveSourceClosure,
  type WorkspaceManifest,
} from './workspace-source-helpers.ts';

describe('createRequire provenance shared by import and export scanning', () => {
  it.each([
    {
      name: 'forward',
      declarations:
        'const first = { get(url) { return second.get(url); } };\n' +
        'const second = { get(url) { return createRequire(url); } };\n',
    },
    {
      name: 'reverse',
      declarations:
        'const second = { get(url) { return createRequire(url); } };\n' +
        'const first = { get(url) { return second.get(url); } };\n',
    },
  ])(
    'converges across $name object-member helper chains',
    ({ declarations }) => {
      const sourceFile = parseSourceFile(
        'test.ts',
        "import { createRequire } from 'node:module';\n" +
          declarations +
          "first.get(import.meta.url)('@google/genai');\n",
      );

      expect(scanGenaiImports(sourceFile, 'test.ts')).toEqual([
        {
          kind: 'genai-import',
          file: 'test.ts',
          line: 4,
          importForm: 'createRequire()',
          specifier: '@google/genai',
        },
      ]);
    },
  );

  it('does not prove a helper with a reachable unproven value return', () => {
    const sourceFile = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'function getLoader(url, useBuiltin) {\n' +
        '  if (useBuiltin) return createRequire(url);\n' +
        '  return makeLoader(url);\n' +
        '}\n' +
        "module.exports = getLoader(import.meta.url, false)('node:fs');\n",
    );

    expect(scanGeminiExports(sourceFile, 'test.ts')).toEqual([
      {
        kind: 'gemini-export',
        file: 'test.ts',
        line: 6,
        exportName: 'module.exports = callExpression() (fail-closed)',
        exportForm: 'computed export mutation (fail-closed)',
      },
    ]);
  });

  it('does not prove a helper with a reachable value fallthrough', () => {
    const sourceFile = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'function getLoader(url, useBuiltin) {\n' +
        '  if (useBuiltin) return createRequire(url);\n' +
        '}\n' +
        "module.exports = getLoader(import.meta.url, false)('node:fs');\n",
    );

    expect(scanGeminiExports(sourceFile, 'test.ts')).toEqual([
      {
        kind: 'gemini-export',
        file: 'test.ts',
        line: 5,
        exportName: 'module.exports = callExpression() (fail-closed)',
        exportForm: 'computed export mutation (fail-closed)',
      },
    ]);
  });

  it('keeps block function declarations within their lexical sibling blocks', () => {
    const sourceFile = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        '{\n' +
        '  function getLoader(url) { return createRequire(url); }\n' +
        "  module.exports = getLoader(import.meta.url)('node:fs');\n" +
        '}\n' +
        '{\n' +
        '  function getLoader(url) { return makeLoader(url); }\n' +
        "  module.exports = getLoader(import.meta.url)('node:path');\n" +
        '}\n',
    );

    expect(scanGeminiExports(sourceFile, 'test.ts')).toEqual([
      {
        kind: 'gemini-export',
        file: 'test.ts',
        line: 8,
        exportName: 'module.exports = callExpression() (fail-closed)',
        exportForm: 'computed export mutation (fail-closed)',
      },
    ]);
  });

  it('converges through helper chains longer than one hundred declarations', () => {
    const helperCount = 110;
    const helpers = Array.from({ length: helperCount }, (_, index) => {
      const returned =
        index === helperCount - 1
          ? 'createRequire(url)'
          : `helper${index + 1}(url)`;
      return `function helper${index}(url) { return ${returned}; }`;
    }).join('\n');
    const sourceFile = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        helpers +
        "\nhelper0(import.meta.url)('@google/genai');\n",
    );

    expect(scanGenaiImports(sourceFile, 'test.ts')).toEqual([
      {
        kind: 'genai-import',
        file: 'test.ts',
        line: 112,
        importForm: 'createRequire()',
        specifier: '@google/genai',
      },
    ]);
  });

  it('accepts a nested export loader only when its helper resolves to createRequire', () => {
    const sourceFile = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'function getLoader(url) { return createRequire(url); }\n' +
        "module.exports = getLoader(import.meta.url)('node:fs');\n",
    );

    expect(scanGeminiExports(sourceFile, 'test.ts')).toEqual([]);
  });

  it('accepts parenthesized bracket-member factory acquisition from a proven namespace', () => {
    const sourceFile = parseSourceFile(
      'test.cjs',
      "const moduleApi = require('node:module');\n" +
        "const factory = (moduleApi['createRequire']);\n" +
        'const load = (factory)(import.meta.url);\n' +
        "module.exports = (load)('node:fs');\n",
    );

    expect(scanGeminiExports(sourceFile, 'test.cjs')).toEqual([]);
  });

  it('accepts exact object-member helpers without leaking across shadowed containers', () => {
    const sourceFile = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const loaders = { get(url) { return createRequire(url); } };\n' +
        "module.exports = loaders['get'](import.meta.url)('node:fs');\n" +
        '{ const loaders = { other() { return makeLoader(); } };\n' +
        "  module.exports = loaders['get'](import.meta.url)('node:path'); }\n",
    );

    expect(scanGeminiExports(sourceFile, 'test.ts')).toEqual([
      {
        kind: 'gemini-export',
        file: 'test.ts',
        line: 5,
        exportName: 'module.exports = callExpression() (fail-closed)',
        exportForm: 'computed export mutation (fail-closed)',
      },
    ]);
  });

  it('fails closed when an identically named nested helper has no createRequire provenance', () => {
    const sourceFile = parseSourceFile(
      'test.ts',
      'function createRequire(url) { return makeLoader(url); }\n' +
        "module.exports = createRequire(import.meta.url)('node:fs');\n",
    );

    expect(scanGeminiExports(sourceFile, 'test.ts')).toEqual([
      {
        kind: 'gemini-export',
        file: 'test.ts',
        line: 2,
        exportName: 'module.exports = callExpression() (fail-closed)',
        exportForm: 'computed export mutation (fail-closed)',
      },
    ]);
  });

  it('detects GenAI through a parenthesized named factory alias', () => {
    const sourceFile = parseSourceFile(
      'test.ts',
      "import { createRequire } from 'node:module';\n" +
        'const factory = (createRequire);\n' +
        "factory(import.meta.url)('@google/genai');\n",
    );

    expect(scanGenaiImports(sourceFile, 'test.ts')).toEqual([
      {
        kind: 'genai-import',
        file: 'test.ts',
        line: 3,
        importForm: 'createRequire()',
        specifier: '@google/genai',
      },
    ]);
  });

  it('detects GenAI through bracket factory acquisition from require(node:module)', () => {
    const sourceFile = parseSourceFile(
      'test.cjs',
      "const factory = (require('node:module')['createRequire']);\n" +
        "factory(import.meta.url)('@google/genai');\n",
    );

    expect(scanGenaiImports(sourceFile, 'test.cjs')).toEqual([
      {
        kind: 'genai-import',
        file: 'test.cjs',
        line: 2,
        importForm: 'createRequire()',
        specifier: '@google/genai',
      },
    ]);
  });
});

describe('exact export surface semantics', () => {
  it('inspects the complete CommonJS assignment RHS through transparent wrappers', () => {
    const sourceFile = parseSourceFile(
      'test.ts',
      'module.exports = ({ GeminiWrapped: 1 } satisfies object)!;\n',
    );

    expect(scanGeminiExports(sourceFile, 'test.ts')).toEqual([
      {
        kind: 'gemini-export',
        file: 'test.ts',
        line: 1,
        exportName: 'GeminiWrapped',
        exportForm: 'module.exports / exports assignment',
      },
    ]);
  });

  it('treats Object.assign with a target and no sources as a no-op', () => {
    const sourceFile = parseSourceFile('test.cjs', 'Object.assign(exports);\n');

    expect(scanGeminiExports(sourceFile, 'test.cjs')).toEqual([]);
  });

  it('does not treat properties of a default-exported object as named exports', () => {
    const sourceFile = parseSourceFile(
      'test.ts',
      'const value = { GeminiInternal: 1 };\n' +
        'export default (value satisfies object);\n',
    );

    expect(scanGeminiExports(sourceFile, 'test.ts')).toEqual([]);
  });
});

describe('manifest and packed-source diagnostics', () => {
  it('reports the npm alias exactly as declared', () => {
    const result = validateManifestDependencies({
      workspaceDir: 'packages/cli',
      manifest: {
        dependencies: {
          disguised: 'npm:@google/genai@1.30.0',
        },
      },
    });

    expect(result.violations).toEqual([
      {
        workspaceDir: 'packages/cli',
        section: 'dependencies',
        message:
          'npm alias "disguised: npm:@google/genai@1.30.0" in "dependencies" ' +
          'targets @google/genai — aliases disguising the SDK are prohibited.',
      },
    ]);
  });

  it('reports a packed closure root that is absent from the source tree', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'packed-source-'));
    const workspaceDir = 'packages/test-pkg';
    mkdirSync(join(repoRoot, workspaceDir), { recursive: true });
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: { '.': { bun: './index.ts' } },
    };

    try {
      expect(
        verifyTransitiveSourceClosure(
          workspaceDir,
          manifest,
          new Set(['packages/test-pkg/index.ts']),
          repoRoot,
        ),
      ).toEqual([
        {
          entry: 'packages/test-pkg/index.ts',
          missingFile: 'packages/test-pkg/index.ts',
          message:
            'packages/test-pkg/index.ts is listed in the published tarball but does not exist on disk',
        },
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('workspace directory discovery', () => {
  it('discovers package directories nested below a scope directory', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'scoped-workspace-'));
    mkdirSync(join(repoRoot, 'packages', '@scope', 'pkg'), { recursive: true });

    try {
      expect(discoverPackageWorkspaces(repoRoot)).toEqual([
        'packages/@scope/pkg',
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
