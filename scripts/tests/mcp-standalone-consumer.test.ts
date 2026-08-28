/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Standalone-consumer contract for `@vybestack/llxprt-code-mcp` (#3305).
 *
 * The original defect did not reproduce in-repo because workspace hoisting and
 * TypeScript path mappings satisfied imports that a published consumer could
 * not resolve. MCP is now below core in the package graph and must neither
 * import nor declare core. These tests build a sandbox whose module resolution
 * is constrained to the PACKED manifest's declared dependencies.
 *
 * The sandbox lives in the OS temp directory so Node and Bun cannot walk up to
 * the repository's `node_modules`. The packed package is copied rather than
 * symlinked so its realpath also stays inside that sandbox.
 *
 * Imports use the Bun runtime so the `bun` export condition resolves to packed
 * TypeScript source. This keeps the test independent of existing `dist` output.
 *
 * Declared dependencies are symlinked from the repository. Once execution
 * enters one of them, that package can resolve its own imports from the
 * repository. This suite therefore checks MCP's direct imports and package
 * exports. `scripts/check-runtime-dependency-declarations.ts` checks runtime
 * declarations for the complete set of published workspaces.
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
const REQUIRED_DEPENDENCY_FOR_NEGATIVE_CONTROL =
  '@vybestack/llxprt-code-telemetry';

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
  readonly optionalDependencies?: Record<string, string>;
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
  // dereference: a preserved symlink would resolve outside the sandbox and
  // silently defeat the isolation this copy exists to create.
  cpSync(packageDir, packageTarget, { recursive: true, dereference: true });

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
      `const root = await import(${JSON.stringify(MCP_PACKAGE_NAME)});` +
        `const host = await import(${JSON.stringify(
          `${MCP_PACKAGE_NAME}/host/hostServices.js`,
        )});` +
        'if ("registerMcpHostServices" in root) ' +
        'throw new Error("Host registration leaked through the root barrel");' +
        'if (typeof host.registerMcpHostServices !== "function") ' +
        'throw new Error("Host registration subpath is unavailable");' +
        'console.log("EXPORT_COUNT:" + Object.keys(root).length);',
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
    // Per-directory try/catch: one undeletable sandbox (a Windows file lock, a
    // CI cleanup race) must not strand the others, since the array has already
    // been drained.
    const failures: string[] = [];
    for (const directory of temporaryDirectories.splice(0)) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(`${directory}: ${String(error)}`);
      }
    }
    if (failures.length > 0) {
      console.warn(
        `Failed to remove temp directories:\n${failures.join('\n')}`,
      );
    }
  });

  it('does not declare core in any dependency section', () => {
    expect(manifest.name).toBe(MCP_PACKAGE_NAME);
    const dependencySections = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ];
    for (const section of dependencySections) {
      expect(Object.keys(section ?? {})).not.toContain(CORE_PACKAGE_NAME);
    }
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
    'fails when a required declared dependency is absent',
    () => {
      // Negative control. Without it, a sandbox that silently resolved against
      // the repository's node_modules would make the test above meaningless.
      const consumerRoot = materializeConsumer(
        packageDir,
        manifest,
        new Set([REQUIRED_DEPENDENCY_FOR_NEGATIVE_CONTROL]),
      );
      const outcome = importEntrypoint(consumerRoot);
      expect(
        outcome.status,
        `Removing ${REQUIRED_DEPENDENCY_FOR_NEGATIVE_CONTROL} must break the ` +
          'import. If this passes, the sandbox is leaking to an outer ' +
          'node_modules and the positive test proves nothing.',
      ).not.toBe(0);
      expect(outcome.stderr).toContain('Cannot find module');
      expect(outcome.stderr).toContain(
        REQUIRED_DEPENDENCY_FOR_NEGATIVE_CONTROL,
      );
    },
    TEST_TIMEOUT_MS,
  );
});
