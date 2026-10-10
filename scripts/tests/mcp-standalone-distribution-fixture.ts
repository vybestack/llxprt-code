/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Run after full package builds of auth, storage, settings, telemetry, tools,
// and mcp. The declaration-only CI build cannot supply this fixture's inputs.
// npm run test:mcp:distribution -- <new-evidence-directory>
// Requires Node >=24, npm, and tar on POSIX. CI covers Linux; Windows is not covered.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { z } from 'zod';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  dependencies: z.record(z.string()).optional(),
  optionalDependencies: z.record(z.string()).optional(),
  peerDependencies: z.record(z.string()).optional(),
  peerDependenciesMeta: z
    .record(z.object({ optional: z.boolean().optional() }))
    .optional(),
});
const workspaceNames = [
  'auth',
  'storage',
  'settings',
  'telemetry',
  'tools',
  'mcp',
];
const packageName = '@vybestack/llxprt-code-mcp';
const forbidden = /@vybestack\/llxprt-code-(core|agents|providers)$/;

function readManifest(directory: string): z.infer<typeof manifestSchema> {
  return manifestSchema.parse(
    JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')),
  );
}

function findPackage(name: string, parent: string): string | undefined {
  for (let directory = parent; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json')))
      return realpathSync(candidate);
    if (dirname(directory) === directory) return undefined;
  }
}

function assertNoLinks(directory: string): void {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    assert.equal(stat.isSymbolicLink(), false, path);
    if (stat.isDirectory()) assertNoLinks(path);
  }
}

function terminateSurvivingServer(consumer: string): void {
  const path = join(consumer, 'server.pid');
  if (!existsSync(path)) return;
  const pid = Number(readFileSync(path, 'utf8'));
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ESRCH'
    )
      throw error;
  }
}

function preserveServerEvidence(consumer: string, evidence: string): void {
  for (const name of ['server.pid', 'server.exit', 'requests']) {
    const source = join(consumer, name);
    if (existsSync(source)) cpSync(source, join(evidence, name));
  }
}

export function verifyDistribution(evidence: string): void {
  assert.equal(
    process.versions.bun,
    undefined,
    'Run this fixture with Node, not Bun',
  );
  assert.ok(
    Number(process.versions.node.split('.')[0]) >= 24,
    'Node >=24 is required',
  );
  assert.notEqual(
    process.platform,
    'win32',
    'This distribution fixture requires POSIX',
  );
  assert.equal(existsSync(evidence), false, 'Provide a new evidence directory');
  mkdirSync(evidence, { recursive: true });
  const consumer = realpathSync(
    mkdtempSync(join(tmpdir(), 'llxprt-mcp-dist-')),
  );
  writeFileSync(join(evidence, 'consumer-path'), consumer);
  const {
    NODE_PATH: _nodePath,
    NODE_OPTIONS: _nodeOptions,
    ...environment
  } = process.env;
  const packed = new Map<string, string>();
  const installed = new Map<string, string>();
  const closure: object[] = [];

  function run(
    command: string,
    args: string[],
    cwd: string,
    label: string,
    expected = 0,
  ): string {
    const result = spawnSync(command, args, {
      cwd,
      env: environment,
      encoding: 'utf8',
      timeout: 20000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = result.stdout + result.stderr;
    writeFileSync(join(evidence, `${label}.log`), output);
    writeFileSync(join(evidence, `${label}.exit`), String(result.status));
    if (result.error) throw result.error;
    assert.equal(result.status, expected, `${label}: ${output}`);
    return output;
  }

  function install(
    source: string,
    target: string,
    resolutionSource: string,
  ): void {
    if (installed.has(target)) return;
    const manifest = readManifest(source);
    assert.equal(forbidden.test(manifest.name), false, manifest.name);
    installed.set(target, realpathSync(resolutionSource));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, {
      recursive: true,
      dereference: true,
      filter: (path) => basename(path) !== 'node_modules',
    });
    closure.push({
      name: manifest.name,
      version: manifest.version,
      source,
      target,
    });
    for (const name of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    })) {
      assert.equal(forbidden.test(name), false, name);
      const original = findPackage(name, resolutionSource);
      if (!original) {
        const optional =
          name in (manifest.optionalDependencies ?? {}) ||
          manifest.peerDependenciesMeta?.[name]?.optional === true;
        closure.push({ parent: manifest.name, missing: name, optional });
        assert.ok(
          optional,
          `Missing installed dependency ${name} of ${manifest.name}`,
        );
        continue;
      }
      const existing = findPackage(name, target);
      if (!existing || installed.get(existing) !== original) {
        const top = join(consumer, 'node_modules', name);
        const destination = existsSync(top)
          ? join(target, 'node_modules', name)
          : top;
        if (name.startsWith('@vybestack/')) assert.ok(packed.has(name), name);
        install(packed.get(name) ?? original, destination, original);
      }
    }
  }

  try {
    for (let parent = dirname(consumer); ; parent = dirname(parent)) {
      assert.equal(existsSync(join(parent, 'node_modules')), false, parent);
      if (dirname(parent) === parent) break;
    }
    for (const name of workspaceNames) {
      const directory = join(evidence, 'packed', name);
      mkdirSync(directory, { recursive: true });
      const output = run(
        'npm',
        [
          'pack',
          '--offline',
          '--ignore-scripts',
          '--pack-destination',
          directory,
        ],
        join(root, 'packages', name),
        `pack-${name}`,
      );
      const tarball = output
        .trim()
        .split('\n')
        .find((line) => /^vybestack-.*\.tgz$/.test(line));
      assert.ok(tarball, output);
      run(
        'tar',
        ['-xzf', join(directory, tarball), '-C', directory],
        root,
        `extract-${name}`,
      );
      packed.set(`@vybestack/llxprt-code-${name}`, join(directory, 'package'));
    }
    const mcp = packed.get(packageName);
    assert.ok(mcp);
    install(
      mcp,
      join(consumer, 'node_modules', packageName),
      join(root, 'packages/mcp'),
    );
    writeFileSync(
      join(evidence, 'closure.json'),
      JSON.stringify(closure, null, 2),
    );
    assertNoLinks(consumer);
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );
    for (const [source, target] of [
      ['mcp-standalone-behavior-fixture.ts', 'consumer.js'],
      ['mcp-standalone-stdio-fixture.ts', 'server.js'],
    ]) {
      const code = readFileSync(join(root, 'scripts/tests', source), 'utf8');
      writeFileSync(
        join(consumer, target),
        ts.transpileModule(code, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
          },
        }).outputText,
      );
    }
    const boundary = `import { registerHooks } from 'node:module';
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
registerHooks({resolve(specifier, context, nextResolve) {
 const result = nextResolve(specifier, context);
 if (result.url.startsWith('file:')) {
  const path = realpathSync(fileURLToPath(result.url));
  if (!path.startsWith(${JSON.stringify(consumer + '/')})) throw new Error('Resolution escaped consumer: '+path);
  if (/\\.(?:ts|tsx)$/.test(path)) throw new Error('Source export used: '+path);
  if (/llxprt-code-(?:core|agents|providers)(?:\\/|$)/.test(path)) throw new Error('Forbidden package: '+path);
 }
 if (context.conditions.includes('bun')) throw new Error('Bun condition used');
 appendFileSync(${JSON.stringify(join(evidence, 'resolve.jsonl'))}, JSON.stringify({specifier,parent:context.parentURL,url:result.url,conditions:context.conditions})+'\\n');
 return result;
}});`;
    writeFileSync(join(consumer, 'boundary.js'), boundary);
    const nodeArgs = ['--import', './boundary.js'];
    run(process.execPath, ['--version'], consumer, 'node-version');
    const imported = run(
      process.execPath,
      [
        ...nodeArgs,
        '--input-type=module',
        '-e',
        `const root = await import('${packageName}'); const host = await import('${packageName}/host/hostServices.js'); if ('registerMcpHostServices' in root || 'registerMcpHostServices' in host || 'resetMcpHostServices' in host) throw new Error('Dead host registry exported'); if (typeof host.captureHostFeedback !== 'function') throw new Error('Explicit host feedback unavailable'); console.log('EXPORT_COUNT:'+Object.keys(root).length);`,
      ],
      consumer,
      'node-import',
    );
    assert.match(imported, /EXPORT_COUNT:\d+/);
    for (const [mode, marker] of [
      ['stdio', 'STDIO_OK'],
      [
        'standalone-default',
        'AUTH_OK browser=standalone-default callbackClosed=true',
      ],
      [
        'unavailable-host',
        'AUTH_OK browser=unavailable-host callbackClosed=true',
      ],
    ]) {
      try {
        const output = run(
          process.execPath,
          [...nodeArgs, 'consumer.js', mode, 'server.js'],
          consumer,
          mode,
        );
        assert.ok(output.includes(marker), output);
      } finally {
        terminateSurvivingServer(consumer);
      }
    }
    const telemetry = join(
      consumer,
      'node_modules/@vybestack/llxprt-code-telemetry',
    );
    const omitted = join(consumer, 'omitted-telemetry');
    renameSync(telemetry, omitted);
    try {
      const output = run(
        process.execPath,
        [
          ...nodeArgs,
          '--input-type=module',
          '-e',
          `await import('${packageName}')`,
        ],
        consumer,
        'negative-telemetry',
        1,
      );
      assert.match(output, /ERR_MODULE_NOT_FOUND/);
      assert.match(output, /@vybestack\/llxprt-code-telemetry/);
    } finally {
      renameSync(omitted, telemetry);
    }
    writeFileSync(
      join(evidence, 'result.json'),
      JSON.stringify(
        {
          passed: true,
          packages: installed.size,
          symlinks: 0,
          ancestorNodeModules: 0,
          modes: ['stdio', 'standalone-default', 'unavailable-host'],
          missingTelemetryRejected: true,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      terminateSurvivingServer(consumer);
    } finally {
      try {
        preserveServerEvidence(consumer, evidence);
      } finally {
        rmSync(consumer, { recursive: true, force: true });
      }
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const evidence = process.argv[2];
  assert.ok(evidence, 'Provide a unique evidence directory');
  verifyDistribution(resolve(evidence));
}
