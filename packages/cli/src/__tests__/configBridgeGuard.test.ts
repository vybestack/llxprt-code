/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, it, expect } from 'bun:test';
import { lstatSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const CLI_ROOT = join(import.meta.dirname, '..');
const UI_ROOT = join(CLI_ROOT, 'ui');

const SKIP_DIRS = new Set(['node_modules', 'dist', '.cache', '__snapshots__']);

const CORE_CONFIG_IMPORT_PATTERNS = [
  /(?:import|export)(?:\s+type)?\s*\{[\s\S]*?\bConfig\b[\s\S]*?\}\s*from\s*['"]@vybestack\/llxprt-code-core['"]/,
  /import\s+\*\s+as\s+\w+\s+from\s*['"]@vybestack\/llxprt-code-core['"]/,
  /from '@vybestack\/llxprt-code-core\/config\/config\.js'/,
];

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        walk(full, acc);
      }
    } else if (
      (full.endsWith('.ts') || full.endsWith('.tsx')) &&
      !/\.d\.tsx?$/.test(full)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

const TEST_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '.bun.ts',
  '.bun.tsx',
] as const;

function isTestFile(path: string): boolean {
  return TEST_FILE_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

function read(rel: string): string {
  const full = join(CLI_ROOT, rel);
  if (!existsSync(full)) {
    throw new Error(
      `configBridgeGuard: expected file '${rel}' no longer exists; ` +
        `update the guard path in the calling test case.`,
    );
  }
  return readFileSync(full, 'utf8');
}

let CLI_FILES: string[];
let UI_FILES: string[];

describe('#2373 config boundary guard', () => {
  beforeAll(() => {
    CLI_FILES = walk(CLI_ROOT);
    UI_FILES = walk(UI_ROOT);
  });
  it('removes the obsolete runtime adapter bridge', () => {
    expect(
      existsSync(join(CLI_ROOT, 'runtime', 'agentRuntimeAdapter.ts')),
    ).toBe(false);
    expect(
      existsSync(join(CLI_ROOT, 'runtime', 'agentRuntimeAdapter.spec.ts')),
    ).toBe(false);
    expect(
      existsSync(
        join(CLI_ROOT, 'integration-tests', 'runtime-isolation.test.ts'),
      ),
    ).toBe(false);
  });

  function findProductionFilesWithObsoleteBridgeComments(): readonly string[] {
    const offenders: string[] = [];
    // Catches "temporary migration bridge", "Migration bridge", "Config bridge",
    // "migration bridge", and similar bridge-wording that signals a temporary
    // adapter/migration shim in production code.
    const forbidden = /\b(temporary\s+)?(migration|config)\s+bridge\b/i;
    for (const file of CLI_FILES) {
      if (isTestFile(file)) continue;
      const text = readFileSync(file, 'utf8');
      if (forbidden.test(text)) {
        offenders.push(relative(CLI_ROOT, file));
      }
    }

    return offenders;
  }

  it('removes obsolete bridge comments from CLI production source', () => {
    const filesWithObsoleteBridgeComments =
      findProductionFilesWithObsoleteBridgeComments();
    expect(filesWithObsoleteBridgeComments).toStrictEqual([]);
  });

  function findUIProductionFilesUsingCoreConfig(): readonly string[] {
    const offenders: string[] = [];
    const forbidden = [
      ...CORE_CONFIG_IMPORT_PATTERNS,
      /\bconfig:\s*Config\b/,
      /\bextends\s+Config\b/,
      /\b=\s*Config\b/,
    ];
    for (const file of UI_FILES) {
      if (isTestFile(file)) continue;
      const text = readFileSync(file, 'utf8');
      if (forbidden.some((pattern) => pattern.test(text))) {
        offenders.push(relative(CLI_ROOT, file));
      }
    }

    return offenders;
  }

  it('keeps UI production source off the core Config class', () => {
    const filesUsingCoreConfig = findUIProductionFilesUsingCoreConfig();
    expect(filesUsingCoreConfig).toStrictEqual([]);
  });

  it('keeps the UI runtime source off the core Config class', () => {
    const text = readFileSync(join(UI_ROOT, 'cliUiRuntime.ts'), 'utf8');

    for (const pattern of CORE_CONFIG_IMPORT_PATTERNS) {
      expect(text).not.toMatch(pattern);
    }
    expect(text).not.toMatch(/=\s*Config\b/);
    expect(text).not.toMatch(/extends\s+Config\b/);
    expect(text).not.toMatch(/buildStreamRuntimeFromConfig/);
    expect(text).not.toMatch(/buildUiRuntimeFromConfig/);
  });

  it('keeps the UI runtime free of the removed Config-shaped catch-all', () => {
    const text = readFileSync(join(UI_ROOT, 'cliUiRuntime.ts'), 'utf8');

    expect(text).not.toMatch(/\bAgentClientSource\b|\bagentClientSource\b/);
    expect(text).not.toMatch(/\bgetAgentClient\b|\bagentClient\b/);
  });

  it('threads nested runtimes through bootstrap and the streaming input path', () => {
    const bootstrap = read(
      'ui/containers/AppContainer/hooks/useAppBootstrap.ts',
    );
    const input = read('ui/containers/AppContainer/hooks/useAppInput.ts');
    const runtime = read('ui/AppContainerRuntime.tsx');
    const app = read('ui/App.tsx');

    expect(bootstrap).toMatch(/subscribeHistoryTokens:\s*Parameters/);
    expect(bootstrap).toMatch(/readLlxprtMdFileCount:\s*\(\)\s*=>\s*number/);
    expect(bootstrap).not.toMatch(/\b(?:uiRuntime|streamRuntime):/);
    expect(bootstrap).not.toMatch(/\bconfig:\s*props\./);
    expect(bootstrap).not.toMatch(/\bconfig:\s*uiRuntime/);
    expect(bootstrap).not.toMatch(/agentClientSource:\s*props\.config/);

    expect(input).toMatch(/AppInputParams extends InputStreamOperations/);
    expect(input).not.toMatch(/uiRuntime:\s*AppBootstrapResult/);
    expect(input).not.toMatch(/\b(?:agent|streamRuntime|slashCommandRuntime):/);
    expect(input).not.toMatch(/AppBootstrapResult\['config'\]/);
    expect(input).not.toMatch(/useAgentStream\([^)]*\bslashCommandRuntime\b/);

    expect(`${runtime}\n${app}`).toMatch(
      /disposeInput:\s*props\.disposeInput[\s\S]*disposeInput:\s*AppContainerProps\['disposeInput'\]\s*=\s*\(\)\s*=>\s*this\.props\.agent\.dispose\(\)/,
    );
    expect(runtime).toMatch(/readLlxprtMdFileCount:\s*useBound/);
    expect(runtime).not.toMatch(/bootstrap\.config/);
    expect(runtime).not.toMatch(/(?:props|bootstrap)\.config\b/);
  });

  it('does not call config.getAgentClient() inline in the streaming input path', () => {
    const input = read('ui/containers/AppContainer/hooks/useAppInput.ts');

    // The streaming path must resolve the client via the threaded
    // agentClientSource boundary, not by dereferencing config inline.
    expect(input).not.toMatch(/config\.getAgentClient\(\)/);
  });

  it('uses the UI runtime interface for bootstrap-level entry props', () => {
    const entryPoints = [
      'ui/App.tsx',
      'ui/AppContainer.tsx',
      'ui/AppContainerRuntime.tsx',
      'ui/containers/AppContainer/hooks/useAppBootstrap.ts',
    ];

    for (const rel of entryPoints) {
      const text = read(rel);
      expect(text).not.toMatch(/config:\s*Config\b/);
    }
  });

  it('does not expose the bootstrap config in the streaming input hook', () => {
    const input = read('ui/containers/AppContainer/hooks/useAppInput.ts');
    expect(input).not.toMatch(/config:\s*AppBootstrapResult\['config'\]/);
  });

  it('keeps MCP display and auth commands independent of the legacy runtime bag', () => {
    const display = read('ui/commands/mcpDisplay.ts');
    const command = read('ui/commands/mcpCommand.ts');
    const auth = read('ui/commands/mcpAuth.ts');

    expect(display).not.toMatch(/McpCommandRuntime|RuntimeMcpServices/);
    expect(auth).not.toMatch(/McpCommandRuntime|RuntimeMcpServices/);
    expect(display).not.toMatch(/asRuntimeConfig/);
    expect(command).not.toMatch(/asRuntimeConfig/);
  });
});
