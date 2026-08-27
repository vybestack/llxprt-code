/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Standalone-consumer contract for `@vybestack/llxprt-code-mcp` (#3305).
 *
 * `packages/mcp` value-imports `@vybestack/llxprt-code-core` at runtime
 * (`getErrorMessage`, `DebugLogger`, `debugLogger`, `coreEvents`,
 * `openBrowserSecurely`, `AuthProviderType`, `safeJsonStringify`) but declared
 * core in `devDependencies` only. `scripts/bind-release-deps.ts` rewrites the
 * `file:` specifier in every dependency section at release time, so the
 * published manifest carried core in `devDependencies` — a section `npm i
 * @vybestack/llxprt-code-mcp` never installs. The shipped `dist/mcp/**` still
 * emits bare `@vybestack/llxprt-code-core/...` specifiers, so the published
 * package could not resolve its own imports.
 *
 * This does not reproduce in-repo: workspace hoisting and the tsconfig path
 * wildcards satisfy the import regardless of what the manifest declares. These
 * tests therefore build a sandbox whose module resolution is constrained to the
 * PACKED manifest's declared dependencies and nothing else.
 *
 * Two details are essential and were both established empirically:
 *
 *  1. The sandbox must live in the OS temp directory, never inside the repo.
 *     Node and Bun walk parent directories looking for `node_modules`, so a
 *     sandbox under `<repo>/tmp/` reaches the repo's own `node_modules` and the
 *     test passes vacuously even with the dependency omitted.
 *  2. The packed package is COPIED rather than symlinked, so its realpath is
 *     inside the sandbox. Resolution follows realpaths; a symlink back into the
 *     repo would again resolve against the repo's `node_modules`.
 *
 * The import is driven with the Bun runtime so the `bun` export condition
 * resolves to the packed TypeScript source. That keeps the test independent of
 * whether `dist/` has been built.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const mcpWorkspaceDir = join(repoRoot, 'packages', 'mcp');
const MCP_PACKAGE_NAME = '@vybestack/llxprt-code-mcp';
const CORE_PACKAGE_NAME = '@vybestack/llxprt-code-core';

const PACK_TIMEOUT_MS = 300_000;
const IMPORT_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 420_000;

const nodeRequire = createRequire(import.meta.url);

interface TarCommandModule {
  spawnTarExtract: (
    tarball: string,
    extractDir: string,
    timeoutMs?: number,
    cwd?: string,
  ) => { stdout: string; stderr: string };
  findTarballName: (packOutput: string, cacheDir?: string) => string;
}

const { spawnTarExtract, findTarballName } = nodeRequire(
  join(repoRoot, 'scripts', 'lib', 'tar-command.cjs'),
) as TarCommandModule;

interface PackedManifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

/** Directories created by this suite, removed in `afterAll`. */
const temporaryDirectories: string[] = [];

function createTemporaryDirectory(prefix: string): string {
  const created = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(created);
  return created;
}

/**
 * Run `npm pack` on `packages/mcp` and extract the tarball.
 * Returns the extracted `package/` directory.
 */
function packAndExtractMcp(): string {
  const packDir = createTemporaryDirectory('llxprt-3305-pack-');
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packResult = spawnSync(
    npmBin,
    ['pack', '--pack-destination', packDir],
    {
      cwd: mcpWorkspaceDir,
      encoding: 'utf8',
      timeout: PACK_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (packResult.error !== undefined && packResult.error !== null) {
    throw new Error(`npm pack failed to spawn: ${packResult.error.message}`);
  }
  if (packResult.status !== 0) {
    throw new Error(
      `npm pack exited ${packResult.status} (signal=${packResult.signal ?? 'none'}): ` +
        `${packResult.stderr || packResult.stdout}`,
    );
  }
  const tarballName = findTarballName(packResult.stdout ?? '', packDir);
  spawnTarExtract(join(packDir, tarballName), packDir);
  const extracted = join(packDir, 'package');
  if (!existsSync(extracted)) {
    throw new Error(`Extracted tarball is missing ${extracted}`);
  }
  return extracted;
}

function readPackedManifest(packageDir: string): PackedManifest {
  return JSON.parse(
    readFileSync(join(packageDir, 'package.json'), 'utf8'),
  ) as PackedManifest;
}

/**
 * Build a sandbox in the OS temp directory containing only the packed package
 * and the dependencies its own manifest declares.
 *
 * `omit` removes a declared dependency from the sandbox, which is how the
 * negative control proves the sandbox genuinely constrains resolution instead
 * of leaking to the repository's `node_modules`.
 */
function materializeConsumer(
  packageDir: string,
  manifest: PackedManifest,
  omit: ReadonlySet<string> = new Set(),
): string {
  const consumerRoot = createTemporaryDirectory('llxprt-3305-consumer-');
  const nodeModules = join(consumerRoot, 'node_modules');
  const packageTarget = join(nodeModules, ...MCP_PACKAGE_NAME.split('/'));
  mkdirSync(dirname(packageTarget), { recursive: true });
  cpSync(packageDir, packageTarget, { recursive: true });

  const declared = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ];
  for (const dependencyName of declared) {
    if (omit.has(dependencyName)) {
      continue;
    }
    const source = join(repoRoot, 'node_modules', dependencyName);
    if (!existsSync(source)) {
      throw new Error(
        `Declared dependency ${dependencyName} is not installed at ${source}; ` +
          'run npm install before this test.',
      );
    }
    const link = join(nodeModules, ...dependencyName.split('/'));
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(source, link);
  }
  return consumerRoot;
}

interface ImportOutcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Import the package entrypoint from inside the sandbox. */
function importEntrypoint(consumerRoot: string): ImportOutcome {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `const m = await import(${JSON.stringify(MCP_PACKAGE_NAME)});` +
        'console.log("EXPORT_COUNT:" + Object.keys(m).length);',
    ],
    {
      cwd: consumerRoot,
      encoding: 'utf8',
      timeout: IMPORT_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.error !== undefined && result.error !== null) {
    throw new Error(`Failed to spawn the runtime: ${result.error.message}`);
  }
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// Symlink creation and `tar` availability are unreliable on Windows runners;
// the packaging contract this suite pins is platform independent.
const describeStandalone =
  process.platform === 'win32' ? describe.skip : describe;

describeStandalone('published mcp package installs standalone (#3305)', () => {
  let packageDir: string;
  let manifest: PackedManifest;

  beforeAll(() => {
    packageDir = packAndExtractMcp();
    manifest = readPackedManifest(packageDir);
  }, TEST_TIMEOUT_MS);

  afterAll(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('declares the core package as an installable runtime dependency', () => {
    expect(manifest.name).toBe(MCP_PACKAGE_NAME);
    expect(
      Object.keys(manifest.dependencies ?? {}),
      `${MCP_PACKAGE_NAME} value-imports ${CORE_PACKAGE_NAME} at runtime, so ` +
        'it must appear in "dependencies" of the packed manifest.',
    ).toContain(CORE_PACKAGE_NAME);
    expect(
      Object.keys(manifest.devDependencies ?? {}),
      `${CORE_PACKAGE_NAME} must not be a devDependency: consumers never ` +
        'install that section, which is the #3305 defect.',
    ).not.toContain(CORE_PACKAGE_NAME);
  });

  it(
    'imports its entrypoint with only its declared dependencies present',
    () => {
      const consumerRoot = materializeConsumer(packageDir, manifest);
      const outcome = importEntrypoint(consumerRoot);
      expect(
        outcome.status,
        `Importing ${MCP_PACKAGE_NAME} from a standalone install failed.\n` +
          `stderr:\n${outcome.stderr}\nstdout:\n${outcome.stdout}`,
      ).toBe(0);
      expect(outcome.stderr).not.toContain('Cannot find module');
      expect(outcome.stdout).toContain('EXPORT_COUNT:');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'fails to import when the declared core dependency is absent',
    () => {
      // Negative control. Without it, a sandbox that silently resolved against
      // the repository's node_modules would make the test above meaningless.
      const consumerRoot = materializeConsumer(
        packageDir,
        manifest,
        new Set([CORE_PACKAGE_NAME]),
      );
      const outcome = importEntrypoint(consumerRoot);
      expect(
        outcome.status,
        'Removing the core dependency must break the import; if this passes, ' +
          'the sandbox is leaking to an outer node_modules and the positive ' +
          'test proves nothing.',
      ).not.toBe(0);
      expect(outcome.stderr).toContain('Cannot find module');
      expect(outcome.stderr).toContain(CORE_PACKAGE_NAME);
    },
    TEST_TIMEOUT_MS,
  );
});
