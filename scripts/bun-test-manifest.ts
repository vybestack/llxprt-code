/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { validateResolvedFiles } from './bun-test-manifest-validation.js';
import { PROVIDERS_MANIFEST_ENTRY } from './bun-test-manifest-data-providers.ts';
import { TOOLS_MANIFEST_ENTRY } from './bun-test-manifest-data-tools.ts';
import { MCP_MANIFEST_ENTRY } from './bun-test-manifest-data-mcp.ts';
import { STORAGE_MANIFEST_ENTRY } from './bun-test-manifest-data-storage.ts';

export interface BunTestWorkspaceEntry {
  readonly workspace: string;
  /**
   * Explicit list of test files, relative to the resolved cwd. Used by
   * workspaces that are only partially migrated, where naming alone cannot
   * distinguish a Bun-ready file from one still owned by Vitest.
   *
   * Mutually exclusive with `include`: an entry declares exactly one of the
   * two so it is always obvious whether its file set is curated or derived.
   */
  readonly files?: readonly string[];
  /**
   * Glob patterns (relative to the resolved cwd) that select every test file
   * for a fully migrated root. This is the Bun-native equivalent of a Vitest
   * config's `include`, and it is what makes "no test file can be silently
   * dropped" mechanically true: a newly added test file is picked up without
   * any manifest edit.
   */
  readonly include?: readonly string[];
  /** Glob patterns removed from the `include` result. */
  readonly exclude?: readonly string[];
  /**
   * Optional explicit working directory override. When omitted, the workspace
   * name is resolved under `packages/` (e.g. `packages/core`). When set, this
   * path is used as the cwd and file resolution root.
   */
  readonly cwd?: string;
  /**
   * Optional Bun `--preload` script path(s) (relative to the workspace cwd)
   * run before any test module is imported. Used by workspaces whose tests
   * must isolate global state (e.g. Storage roots) before test modules import
   * the singleton — `bun test` does not run Vitest `setupFiles`, so a preload
   * is the only way to guarantee ordering under Bun.
   */
  readonly preload?: string | readonly string[];
  /**
   * Optional tsconfig (relative to the workspace cwd) passed to Bun as
   * `--tsconfig-override`. Used where test-only module resolution differs from
   * the build configuration (e.g. stubbing the editor-injected `vscode`
   * module), so the production tsconfig stays honest.
   */
  readonly tsconfig?: string;
  /**
   * Per-test timeout in milliseconds for this root, overriding the runner's
   * global `--timeout`. Mirrors a Vitest config's `testTimeout`.
   */
  readonly timeout?: number;
  /**
   * Number of times a failing file is re-run before it is reported as failed.
   * Mirrors a Vitest config's `retry`, which real-provider E2E suites rely on.
   */
  readonly retries?: number;
  /**
   * Module (relative to the workspace cwd) exporting `setup()` and/or
   * `teardown()`, executed once in the runner process around the whole root.
   * Mirrors a Vitest config's `globalSetup`: mutations it makes to
   * `process.env` are inherited by every spawned test process.
   */
  readonly globalSetup?: string;
  /**
   * Marks a root that calls a real provider and therefore needs credentials
   * and quota. Such roots are excluded from an unfiltered run and must be
   * selected explicitly with `--root`, so the ordinary PR gate never burns
   * quota; their dedicated workflows request them by name.
   */
  readonly credentialed?: boolean;
}

export interface BunTestFile {
  readonly file: string;
  readonly cwd: string;
  /**
   * Resolved absolute preload paths for this file's workspace (empty when the
   * workspace declares none). Passed to `bun test --preload`.
   */
  readonly preloads: readonly string[];
  /** Resolved absolute `--tsconfig-override` path, when the entry declares one. */
  readonly tsconfig?: string;
  /** Per-test timeout override in milliseconds, when the entry declares one. */
  readonly timeout?: number;
  /** Retry budget for this file, when the entry declares one. */
  readonly retries?: number;
  /** Resolved absolute global setup module path, when the entry declares one. */
  readonly globalSetup?: string;
}

export interface BunManifestDependencies {
  stat(path: string): { isFile(): boolean };
  /**
   * Expands a glob pattern to file paths relative to `cwd`. Injected so the
   * resolver stays testable without touching the real filesystem.
   */
  glob(pattern: string, cwd: string): readonly string[];
}

export class BunManifestStatError extends Error {
  readonly path: string;
  readonly code: string | undefined;

  constructor(path: string, code: string | undefined, cause: unknown) {
    super(
      `Unable to inspect Bun native test manifest path: ${path}${
        code ? ` (${code})` : ''
      }`,
      { cause },
    );
    this.name = 'BunManifestStatError';
    this.path = path;
    this.code = code;
  }
}

const defaultManifestDependencies: BunManifestDependencies = {
  stat: statSync,
  glob: (pattern, cwd) =>
    Array.from(new Bun.Glob(pattern).scanSync({ cwd, onlyFiles: true })).sort(),
};

export function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

/**
 * The release-install smoke, kept in its own root because it packs and
 * installs a CLI tarball and therefore needs a much larger time budget than
 * the rest of the script harness.
 */
export const SLOW_SCRIPTS_TEST = 'issue-2603-release-install.test.ts';

/** Every test root executed by Bun's native test runner. */
export const BUN_NATIVE_TEST_MANIFEST: readonly BunTestWorkspaceEntry[] = [
  {
    workspace: 'a2a-server',
    preload: [
      '../../test-setup/augment-bun-vi.ts',
      'bun-preload-storage-isolation.ts',
    ],
    include: ['src/**/*.test.ts'],
  },
  {
    workspace: 'agents',
    files: [
      'src/core/CompressionProfileResolver.proxyKeyStorage.test.ts',
      'test-bun/generatingModelStamp.issue2511.bun.ts',
      'test-bun/subagentAnthropicTextSettings.issue1738.bun.ts',
      'test-bun/taskTimeoutBounds.issue3031.bun.ts',
      'test-bun/taskTimeoutDescription.issue3031.bun.ts',
      'test-bun/taskAsyncTimeout.issue3031.bun.ts',
      'test-bun/taskTimeoutResultAgentId.cr3031.bun.ts',
    ],
  },
  {
    workspace: 'cli',
    files: [
      'src/__tests__/cliSessionDispatch.characterization.test.tsx',
      // Extension settings storage drives the REAL SecureStore against an
      // in-memory keyring, so it needs no module mocking and is Bun-native.
      'test-bun/settingsStorage.bun.ts',
      // JSP/1 observation producer (issue #2779). Bun-native from the start:
      // these are excluded from the Vitest selection so they run only here.
      'src/observation/jspBounds.test.ts',
      'src/observation/jspProducer.test.ts',
      'src/observation/jspProducerState.test.ts',
      'src/observation/jspRedaction.test.ts',
      'src/observation/jspSchema.test.ts',
      'src/observation/jspTransport.test.ts',
      'src/observation/jspWiring.test.ts',
      'src/observation/observationTap.test.ts',
      'src/utils/sandbox-containers.test.ts',
      // Sandbox SSH agent preflight (issue #1699). Bun-native from the start
      // and likewise excluded from the Vitest selection.
      'src/utils/sandbox-ssh-agent-preflight.test.ts',
      // Process memory hardening (issue #3028). Imports the real `bun:test`
      // API rather than the Vitest shim, so it runs only here and is excluded
      // from the Vitest selection.
      'src/launcher/process-memory-hardening.test.ts',
      'src/zed-integration/zed-session-lifecycle.test.ts',
      // Issue #2980: Zed terminal command correlation. Migrated to bun:test
      // and excluded from the Vitest selection below; the strict wrapper
      // matcher is exercised here while keeping the lifecycle guard intact.
      'src/zed-integration/zedIntegration.terminal.test.ts',
      'test-bun/iContentToHistoryItems.issue2511.bun.ts',
      'src/ui/commands/authCommand.loginWithBucket.issue2891.test.ts',
      'test-utils/augment-bun-vi-cleanup.bun.ts',
      // Issue #2951: Windows Ctrl+Enter steering. Each file pins
      // process.platform at the very top before the key-matcher module graph
      // loads, so win32 and darwin must run in separate processes.
      'test-bun/steerKey.win32.bun.ts',
      'test-bun/steerKey.darwin.bun.ts',
      'test-bun/resolveKeyBindings.bun.ts',
      'test-bun/keypressLineFeed.bun.ts',
      'test-bun/profileAuthKeyNameIssue2916.bun.ts',
    ],
  },
  {
    workspace: 'cli',
    preload: 'bun-test-setup.ts',
    files: [
      'src/ui/hooks/agentStream/__tests__/useAgentEventStream.bun.tsx',
      'src/ui/hooks/agentStream/__tests__/useAgentStreamOrchestration.terminal.bun.tsx',
      'src/ui/hooks/agentStream/__tests__/useSubmitQuery.doublecancel.bun.tsx',
      'src/ui/hooks/agentStream/__tests__/useSubmitQuery.terminalError.bun.tsx',
    ],
  },
  {
    workspace: 'core',
    files: [
      'src/utils/errors.test.ts',
      // Issue #1985: ToolKeyStorage.deleteKey() must still remove its own
      // encrypted .key file when SecureStore.delete() surfaces a keyring
      // failure.
      'src/tools/tool-key-storage.test.ts',
      'src/tools-adapters/CoreSubagentServiceAdapter.timeout.test.ts',
      'src/tools-adapters/CoreSubagentServiceAdapter.cancellation.cr3031.test.ts',
    ],
  },
  PROVIDERS_MANIFEST_ENTRY,
  TOOLS_MANIFEST_ENTRY,
  MCP_MANIFEST_ENTRY,
  {
    workspace: 'telemetry',
    preload: [
      '../../test-setup/augment-bun-vi.ts',
      'test-setup-storage-isolation.ts',
    ],
    include: ['src/**/*.test.ts'],
  },
  STORAGE_MANIFEST_ENTRY,
  {
    workspace: 'test-utils',
    preload: ['../../test-setup/augment-bun-vi.ts'],
    include: ['src/**/*.test.ts'],
  },
  {
    workspace: 'settings',
    preload: [
      '../../test-setup/augment-bun-vi.ts',
      'test-setup-storage-isolation.ts',
    ],
    include: ['src/**/*.test.ts'],
  },
  {
    workspace: 'ide-integration',
    preload: [
      '../../test-setup/augment-bun-vi.ts',
      'test-setup-storage-isolation.ts',
      'test-setup.ts',
    ],
    include: ['src/**/*.test.ts'],
  },
  {
    // `vscode` is injected by the editor host and cannot be resolved outside
    // it, so a test-only tsconfig maps the specifier at a stub the per-file
    // `vi.mock('vscode', …)` factories then replace.
    workspace: 'vscode-ide-companion',
    preload: [
      '../../test-setup/augment-bun-vi.ts',
      'test-setup-storage-isolation.ts',
    ],
    tsconfig: 'tsconfig.bun-test.json',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
  {
    workspace: 'policy',
    preload: ['../../test-setup/augment-bun-vi.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['src/research/**'],
  },
  {
    workspace: 'test-setup',
    cwd: '.',
    files: [
      'test-setup/augment-bun-vi.test.ts',
      'test-setup/stub-helpers.bun.test.ts',
    ],
  },
  {
    // The whole script harness. Previously split into several curated roots
    // (acplint, scripts-pr-review, scripts-ocr-review, issue-planner-*) while
    // the rest of the directory still belonged to Vitest; now that Vitest no
    // longer runs this tree, one glob root covers every file — including the
    // `*.bun.test.ts` files that were always Bun-only.
    workspace: 'scripts-tests',
    cwd: '.',
    preload: ['test-setup/augment-bun-vi.ts', 'scripts/tests/test-setup.ts'],
    include: ['scripts/tests/**/*.test.ts', 'scripts/tests/**/*.test.js'],
    exclude: [`scripts/tests/${SLOW_SCRIPTS_TEST}`],
  },
  {
    // The release-install smoke packs a CLI tarball and runs three npm
    // installs, so it needs a far larger budget than the rest of the harness.
    // It is a separate root so the ordinary script tests keep a tight timeout
    // that still catches genuine hangs.
    workspace: 'scripts-tests-slow',
    cwd: '.',
    preload: ['test-setup/augment-bun-vi.ts', 'scripts/tests/test-setup.ts'],
    files: [`scripts/tests/${SLOW_SCRIPTS_TEST}`],
    timeout: 300_000,
  },
  {
    workspace: 'evals',
    cwd: 'evals',
    preload: ['../test-setup/augment-bun-vi.ts'],
    include: ['**/*.eval.ts'],
    globalSetup: 'globalSetup.ts',
    timeout: 300_000,
    credentialed: true,
  },
  {
    // End-to-end tests against a real provider: long per-test budget, a
    // global setup that isolates storage roots for every spawned CLI, and a
    // retry budget mirroring the Vitest config these replaced.
    workspace: 'integration-tests',
    cwd: 'integration-tests',
    preload: ['../test-setup/augment-bun-vi.ts', 'setup-quota-guard.ts'],
    include: ['**/*.test.ts'],
    globalSetup: 'globalSetup.ts',
    timeout: 300_000,
    retries: 2,
    credentialed: true,
  },
];

/**
 * Resolves the working directory for a workspace entry.
 *
 * - When `cwd` is `undefined`, the workspace name is resolved under
 *   `packages/` (e.g. `packages/core`).
 * - When `cwd` is an empty string, the repo root itself is used.
 * - When `cwd` is a non-empty string, it is joined under the repo root.
 *
 * Using `cwd !== undefined` (not truthiness) ensures an empty string
 * correctly means the repo root rather than falling through to the
 * `packages/` default.
 */
export function resolveWorkspaceCwd(
  repoRoot: string,
  workspace: string,
  cwd: string | undefined,
): string {
  if (cwd === undefined) {
    return join(repoRoot, 'packages', workspace);
  }
  return join(repoRoot, cwd);
}

/**
 * Expands one manifest entry into its relative test-file list.
 *
 * `files` is returned verbatim (curated set). `include` is expanded through
 * the injected glob and then filtered by `exclude`, mirroring how a Vitest
 * config's include/exclude pair selects files. Declaring both, or neither, is
 * a manifest authoring error and fails loudly rather than silently running a
 * partial set.
 */
export function resolveEntryFileNames(
  entry: BunTestWorkspaceEntry,
  resolvedCwd: string,
  dependencies: BunManifestDependencies,
): readonly string[] {
  const { workspace, files, include, exclude } = entry;
  if (files !== undefined && include !== undefined) {
    throw new Error(
      `Bun native test manifest entry "${workspace}" declares both "files" and "include"; choose one.`,
    );
  }
  if (files !== undefined) {
    return files;
  }
  if (include === undefined) {
    throw new Error(
      `Bun native test manifest entry "${workspace}" declares neither "files" nor "include".`,
    );
  }
  const excluded = new Set(
    (exclude ?? []).flatMap((pattern) =>
      dependencies.glob(pattern, resolvedCwd),
    ),
  );
  const selected = new Set(
    include.flatMap((pattern) => dependencies.glob(pattern, resolvedCwd)),
  );
  const remaining = [...selected].filter((file) => !excluded.has(file)).sort();
  if (remaining.length === 0) {
    throw new Error(
      `Bun native test manifest entry "${workspace}" matched no test files under ${resolvedCwd}.`,
    );
  }
  return remaining;
}

function toPreloadList(
  preload: string | readonly string[] | undefined,
): readonly string[] {
  if (preload === undefined) {
    return [];
  }
  return typeof preload === 'string' ? [preload] : preload;
}

/**
 * Decides whether a root participates in this run.
 *
 * A named filter selects exactly that root, credentialed or not. An
 * unfiltered run covers every root that does not require provider
 * credentials, so the ordinary gate stays complete without burning quota.
 */
export function selectsEntry(
  entry: BunTestWorkspaceEntry,
  workspaceFilter: string | undefined,
): boolean {
  if (workspaceFilter !== undefined) {
    return entry.workspace === workspaceFilter;
  }
  return entry.credentialed !== true;
}

export function resolveBunNativeTestFiles(
  repoRoot: string,
  workspaceFilter?: string,
  dependencies: BunManifestDependencies = defaultManifestDependencies,
): BunTestFile[] {
  const files = BUN_NATIVE_TEST_MANIFEST.filter((entry) =>
    selectsEntry(entry, workspaceFilter),
  ).flatMap((entry) => resolveManifestEntry(entry, repoRoot, dependencies));
  validateResolvedFiles(files, dependencies);
  return files.sort((left, right) => left.file.localeCompare(right.file));
}

function resolveManifestEntry(
  entry: BunTestWorkspaceEntry,
  repoRoot: string,
  dependencies: BunManifestDependencies,
): BunTestFile[] {
  const resolvedCwd = resolveWorkspaceCwd(repoRoot, entry.workspace, entry.cwd);
  const resolvedPreloads = toPreloadList(entry.preload).map((preload) =>
    join(resolvedCwd, preload),
  );
  return resolveEntryFileNames(entry, resolvedCwd, dependencies).map(
    (file) => ({
      cwd: resolvedCwd,
      file: join(resolvedCwd, file),
      preloads: resolvedPreloads,
      tsconfig:
        entry.tsconfig !== undefined
          ? join(resolvedCwd, entry.tsconfig)
          : undefined,
      timeout: entry.timeout,
      retries: entry.retries,
      globalSetup:
        entry.globalSetup !== undefined
          ? join(resolvedCwd, entry.globalSetup)
          : undefined,
    }),
  );
}
