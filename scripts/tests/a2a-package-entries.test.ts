/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { z } from 'zod';
import manifest from '../../packages/a2a-server/package.json' with { type: 'json' };
import coreManifest from '../../packages/core/package.json' with { type: 'json' };
import {
  compilerConfiguration,
  selectBoundarySources,
} from '../runtime-source-discovery.js';
import { productionEntryManifest } from '../runtime-entry-manifest.js';
import { productionPolicy } from '../check-runtime-state-boundary.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const packageRoot = resolve(workspace, 'packages/a2a-server');
const build = compilerConfiguration(
  workspace,
  'packages/a2a-server/tsconfig.build.json',
);

function outputFor(source: string, extension: string): string {
  expect(build.errors).toEqual([]);
  const output = ts
    .getOutputFileNames(
      build,
      resolve(packageRoot, source),
      !ts.sys.useCaseSensitiveFileNames,
    )
    .find((file) => file.endsWith(extension));
  if (!output) throw new Error(`No ${extension} output for ${source}`);
  return output;
}

it('imports the history binding through its typed package export in Node', () => {
  const subpath = './services/history/provider-file-binding.js';
  const specifier = `${coreManifest.name}/${subpath.slice(2)}`;
  const imported = execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `const binding = await import(${JSON.stringify(specifier)}); process.stdout.write(typeof binding.createHistoryProviderFileBindingStore);`,
    ],
    {
      cwd: workspace,
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  expect(imported).toBe('function');
  const entry = z
    .object({ types: z.string(), bun: z.string(), import: z.string() })
    .parse(
      Object.entries(coreManifest.exports).find(
        ([key]) => key === subpath,
      )?.[1],
    );
  const coreRoot = resolve(workspace, 'packages/core');
  const source = resolve(
    coreRoot,
    'src/services/history/provider-file-binding.ts',
  );
  const coreBuild = compilerConfiguration(
    workspace,
    'packages/core/tsconfig.build.json',
  );
  expect(coreBuild.errors).toEqual([]);
  const outputs = ts.getOutputFileNames(
    coreBuild,
    source,
    !ts.sys.useCaseSensitiveFileNames,
  );
  expect(resolve(coreRoot, entry.bun)).toBe(source);
  for (const target of [entry.types, entry.import]) {
    expect(outputs).toContain(resolve(coreRoot, target));
    expect(existsSync(resolve(coreRoot, target))).toBe(true);
  }
  const map = z
    .object({ sources: z.array(z.string()) })
    .parse(
      JSON.parse(
        readFileSync(resolve(coreRoot, `${entry.import}.map`), 'utf8'),
      ),
    );
  expect(
    map.sources.map((file) =>
      resolve(dirname(resolve(coreRoot, entry.import)), file),
    ),
  ).toEqual([source]);
});

it('imports the bare package from the root barrel emitted by its build in Node', () => {
  const emitted = outputFor('index.ts', '.js');
  expect(resolve(packageRoot, manifest.main)).toBe(emitted);
  const resolved = execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `import assert from 'node:assert/strict';
       const pkg = await import(${JSON.stringify(manifest.name)});
       assert.equal(typeof pkg.createApp, 'function');
       assert.equal(typeof pkg.createCoderAgentCard, 'function');
       process.stdout.write(import.meta.resolve(${JSON.stringify(manifest.name)}));`,
    ],
    {
      cwd: workspace,
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  expect(resolved).toBe(pathToFileURL(emitted).href);
  expect(existsSync(fileURLToPath(resolved))).toBe(true);
});

it('starts the emitted HTTP entry rather than the library barrel or standalone bundle', () => {
  expect(manifest.scripts.start.split(' ')).toEqual([
    'node',
    'dist/a2a-server/src/http/server.js',
  ]);
  expect(resolve(packageRoot, manifest.scripts.start.split(' ')[1])).toBe(
    outputFor('src/http/server.ts', '.js'),
  );
  expect(manifest.bin['llxprt-code-a2a-server']).toBe('dist/a2a-server.mjs');
});

for (const source of ['index.ts', 'src/index.ts', 'src/http/server.ts']) {
  it(`retains the actual emitted source identity for ${source}`, () => {
    const emitted = outputFor(source, '.js');
    const sourceMap = z
      .object({ file: z.string(), sources: z.array(z.string()) })
      .parse(JSON.parse(readFileSync(`${emitted}.map`, 'utf8')));
    expect(resolve(dirname(emitted), sourceMap.file)).toBe(emitted);
    expect(
      sourceMap.sources.map((file) => resolve(dirname(emitted), file)),
    ).toEqual([resolve(packageRoot, source)]);
    expect(existsSync(emitted)).toBe(true);
    expect(existsSync(outputFor(source, '.d.ts'))).toBe(true);
  });
}

it('discovers the declared A2A main and bin as their distinct true source entries', () => {
  const selection = selectBoundarySources(
    workspace,
    [],
    productionPolicy.compilerProjects ?? [productionPolicy.compilerConfig],
    {
      packages: ['packages/a2a-server'],
      generated: productionEntryManifest.generated,
    },
  );
  expect(selection.gaps).toEqual([]);
  expect(selection.entries.toSorted()).toEqual(
    ['index.ts', 'src/http/server.ts']
      .map((file) => resolve(packageRoot, file))
      .toSorted(),
  );
  const program = ts.createProgram({
    rootNames: [...selection.entries],
    options: { ...build.options, noEmit: true },
    projectReferences: build.projectReferences,
  });
  for (const entry of selection.entries) {
    expect(program.getSourceFile(entry)?.fileName).toBe(entry);
  }
});
