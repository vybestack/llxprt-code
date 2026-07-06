/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, it, expect } from 'vitest';
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

function isTestFile(path: string): boolean {
  return (
    path.endsWith('.test.ts') ||
    path.endsWith('.test.tsx') ||
    path.endsWith('.spec.ts') ||
    path.endsWith('.spec.tsx')
  );
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

  it('removes obsolete bridge comments from CLI production source', () => {
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
    expect(offenders).toStrictEqual([]);
  });

  it('keeps UI production source off the core Config class', () => {
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
    expect(offenders).toStrictEqual([]);
  });

  it('keeps CliUiRuntime as a UI-owned structural source, not a core Config alias', () => {
    const text = readFileSync(join(UI_ROOT, 'cliUiRuntime.ts'), 'utf8');

    for (const pattern of CORE_CONFIG_IMPORT_PATTERNS) {
      expect(text).not.toMatch(pattern);
    }
    expect(text).not.toMatch(/type\s+CliUiRuntime\s*=\s*Config\b/);
    expect(text).not.toMatch(/interface\s+CliUiRuntime\s+extends/);
    expect(text).toMatch(
      /export\s+type\s+CliUiRuntime\s*=\s*UiRuntimeBareSource/,
    );
    expect(text).not.toMatch(/buildStreamRuntimeFromConfig/);
    expect(text).not.toMatch(/buildUiRuntimeFromConfig/);
  });

  it('exposes focused capability read-models instead of only a monolithic runtime', () => {
    const text = readFileSync(join(UI_ROOT, 'cliUiRuntime.ts'), 'utf8');

    // The narrow boundaries that decompose the former Config-shaped catch-all.
    expect(text).toMatch(/export\s+interface\s+AgentClientSource\s*\{/);
    expect(text).toMatch(/export\s+interface\s+SessionIdentity\s*\{/);
    expect(text).toMatch(/export\s+interface\s+ModelState\s*\{/);
    expect(text).toMatch(/export\s+interface\s+StreamRuntime\s*\{/);
    expect(text).toMatch(/export\s+interface\s+UiRuntime\s+extends/);
  });

  it('threads nested runtimes through bootstrap and the streaming input path', () => {
    const bootstrap = read(
      'ui/containers/AppContainer/hooks/useAppBootstrap.ts',
    );
    const input = read('ui/containers/AppContainer/hooks/useAppInput.ts');
    const runtime = read('ui/AppContainerRuntime.tsx');

    expect(bootstrap).toMatch(/streamRuntime:\s*StreamRuntime/);
    expect(bootstrap).toMatch(/uiRuntime:\s*UiRuntime/);
    expect(bootstrap).not.toMatch(/\bconfig:\s*CliUiRuntime\b/);
    expect(bootstrap).not.toMatch(/\bconfig:\s*SlashCommandRuntime\b/);
    expect(bootstrap).not.toMatch(/\bconfig:\s*props\./);
    expect(bootstrap).not.toMatch(/\bconfig:\s*uiRuntime/);
    expect(bootstrap).not.toMatch(/agentClientSource:\s*props\.config/);

    expect(input).toMatch(/streamRuntime:\s*AppBootstrapResult/);
    expect(input).not.toMatch(/uiRuntime:\s*AppBootstrapResult/);
    expect(input).toMatch(/slashCommandRuntime:\s*SlashCommandRuntime/);
    expect(input).not.toMatch(/AppBootstrapResult\['config'\]/);
    expect(input).not.toMatch(/useAgentStream\([^)]*\bslashCommandRuntime\b/);

    expect(runtime).toMatch(/streamRuntime:\s*bootstrap\.streamRuntime/);
    expect(runtime).toMatch(/uiRuntime:\s*bootstrap\.uiRuntime/);
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
      expect(text).not.toMatch(
        /config:\s*(?:Config|CliUiRuntime|SlashCommandRuntime)\b/,
      );
    }
  });

  it('does not expose broad CliUiRuntime in the streaming input hook', () => {
    const input = read('ui/containers/AppContainer/hooks/useAppInput.ts');
    expect(input).not.toMatch(
      /slashCommandRuntime:\s*AppBootstrapResult\['config'\]/,
    );
    expect(input).not.toMatch(/\bCliUiRuntime\b/);
    expect(input).not.toMatch(/config:\s*AppBootstrapResult\['config'\]/);
    expect(input).not.toMatch(/config:\s*CliUiRuntime\b/);
  });

  it('keeps the MCP command path on an explicit MCP runtime boundary', () => {
    const display = read('ui/commands/mcpDisplay.ts');
    const command = read('ui/commands/mcpCommand.ts');

    expect(display).toMatch(/RuntimeMcpServices\s*=\s*McpCommandRuntime/);
    expect(display).not.toMatch(/Omit<CliUiRuntime/);
    expect(display).not.toMatch(/asRuntimeConfig/);
    expect(command).not.toMatch(/asRuntimeConfig/);
  });

  it('keeps agent stream modules on StreamRuntime rather than CliUiRuntime', () => {
    const offenders: string[] = [];
    for (const file of UI_FILES.filter((candidate) =>
      relative(UI_ROOT, candidate).startsWith(join('hooks', 'agentStream')),
    )) {
      if (isTestFile(file)) continue;
      const text = readFileSync(file, 'utf8');
      if (/\bCliUiRuntime\b/.test(text)) {
        offenders.push(relative(CLI_ROOT, file));
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('does not pass raw Config as slashCommandRuntime at the composition root', () => {
    const interactiveUI = read('session/interactiveUI.tsx');

    // The composition root must build a delegation adapter via
    // buildSlashCommandRuntime, never pass the raw config object directly.
    expect(interactiveUI).toMatch(/buildSlashCommandRuntime/);
    expect(interactiveUI).not.toMatch(/slashCommandRuntime=\{config\}/);
  });
});
