/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { liveWrapperProcesses } from './__tests__/runtime-test-helpers.js';
import {
  resolveQuickJsWrapperPath,
  type QuickJsProcessRuntime as RuntimeClass,
} from './quickjs-process-runtime.js';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(sourceDir, '..', '..');
const repoNodeModules = join(packageDir, '..', '..', 'node_modules');

/**
 * Emits the code-mode sources the way the package build does (TypeScript to
 * ES modules under dist/src/code-mode) into a scratch package, so the emitted
 * runtime has to find and launch the emitted wrapper on its own.
 */
function emitCodeModeDist(root: string): string {
  const outDir = join(root, 'dist', 'src', 'code-mode');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'code-mode-dist-probe', type: 'module' }),
  );
  symlinkSync(repoNodeModules, join(root, 'node_modules'), 'dir');
  const sources = readdirSync(sourceDir).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );
  for (const name of sources) {
    const output = ts.transpileModule(
      readFileSync(join(sourceDir, name), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: name,
      },
    );
    writeFileSync(
      join(outDir, name.replace(/\.ts$/, '.js')),
      output.outputText,
    );
  }
  return outDir;
}

describe('QuickJS wrapper resolution from built output', () => {
  let scratch: string;
  let outDir: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'code-mode-dist-'));
    outDir = emitCodeModeDist(scratch);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('resolves the emitted wrapper next to an emitted runtime', () => {
    const runtimeUrl = pathToFileURL(
      join(outDir, 'quickjs-process-runtime.js'),
    ).href;

    expect(resolveQuickJsWrapperPath(runtimeUrl)).toBe(
      join(outDir, 'quickjs-wrapper.js'),
    );
  });

  it('resolves the TypeScript wrapper when running from source', () => {
    expect(resolveQuickJsWrapperPath(import.meta.url)).toBe(
      join(sourceDir, 'quickjs-wrapper.ts'),
    );
  });

  it('runs a script end to end through the emitted runtime and wrapper', async () => {
    const emitted = (await import(
      pathToFileURL(join(outDir, 'quickjs-process-runtime.js')).href
    )) as { QuickJsProcessRuntime: typeof RuntimeClass };
    const result = await new emitted.QuickJsProcessRuntime().run(
      {
        language: 'javascript',
        source: 'const r = await tools.echo({ n: 2 }); return r.value * 21;',
        tools: ['echo'],
        apiRevision: 'dist-probe',
        purpose: 'built output resolution',
      },
      async () => ({ ok: true, value: 2, completeness: 'complete' }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ ok: true, value: 42, callCount: 1 });
    expect(liveWrapperProcesses()).toStrictEqual([]);
  });
});
