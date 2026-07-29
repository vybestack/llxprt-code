/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the canonical lint runner (issue #2710).
 *
 * These tests exercise the REAL command builder exported from
 * `scripts/run-lint.ts`. No mock theater: the builder is imported and invoked
 * with real argument lists and environment inputs, and the produced ESLint
 * invocations are asserted as concrete command/argument tuples.
 *
 * Coverage (per project-plans/issue-2710 acceptance matrix A1/A2/A7):
 *  - lint/lint:ci/lint:fix delegate to the runner (package-script migration test)
 *  - Full run uses ONE root ESLint invocation (no duplicate integration pass)
 *  - Full run target includes integration-tests via root '.'
 *  - Scoped run consumes a JSON target list and forwards it as explicit targets
 *  - Scoped run always includes integration-tests as an explicit target
 *  - Argument forwarding (--max-warnings 0, --fix) is preserved
 *  - Cache is opt-in only (--cache requires explicit env/flag, not default)
 *  - Heap is normalized to 12GB (12288) and a stale inherited limit is replaced
 */

import { describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const RUNNER_PATH = join(REPO_ROOT, 'scripts', 'run-lint.ts');

/** A single ESLint invocation the runner would spawn. */
interface LintCommand {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly nodeOptions: string;
}

/** Parameters for the runner's command builder. */
interface BuildCommandsParams {
  readonly targets: readonly string[] | null;
  readonly forwardedArgs: readonly string[];
  readonly cache: boolean;
  readonly heapMb?: number;
  readonly nodeOptions?: string;
}

interface RunnerModule {
  buildLintCommands: (params: BuildCommandsParams) => readonly LintCommand[];
  stripRunnerArgs: (rawArgs: readonly string[]) => string[];
}

async function loadRunner(): Promise<RunnerModule> {
  return await import(RUNNER_PATH);
}

describe('run-lint runner — full run is a single root invocation (A1/A2)', () => {
  it('produces exactly one ESLint command for a full run (null targets)', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
    });
    expect(commands.length).toBe(1);
  });

  it('the full-run command targets the root "."', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
    });
    expect(commands[0].args).toContain('.');
  });

  it('does NOT produce a separate integration-tests invocation for a full run', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
    });
    // A single root '.' invocation already covers integration-tests; there
    // must be no standalone second "integration-tests" command.
    const standaloneIntegration = commands.filter((c) =>
      c.args.includes('integration-tests'),
    );
    expect(standaloneIntegration.length).toBe(0);
  });
});

describe('run-lint runner — scoped run forwards explicit targets (A2)', () => {
  it('produces one ESLint command with the explicit target list', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: ['packages/core', 'integration-tests'],
      forwardedArgs: [],
      cache: false,
    });
    expect(commands.length).toBe(1);
    expect(commands[0].args).toContain('packages/core');
    expect(commands[0].args).toContain('integration-tests');
  });

  it('treats an empty targets array as a scoped run with integration-tests only', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: [],
      forwardedArgs: [],
      cache: false,
    });
    expect(commands.length).toBe(1);
    expect(commands[0].args).toContain('integration-tests');
    expect(commands[0].args).not.toContain('.');
  });

  it('scoped run always includes integration-tests even if omitted from input', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: ['packages/cli'],
      forwardedArgs: [],
      cache: false,
    });
    expect(commands[0].args).toContain('integration-tests');
  });

  it('scoped run does not add a separate root "." target', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: ['packages/core'],
      forwardedArgs: [],
      cache: false,
    });
    expect(commands[0].args).not.toContain('.');
  });

  it('scoped run deduplicates integration-tests if already present', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: ['packages/core', 'integration-tests'],
      forwardedArgs: [],
      cache: false,
    });
    const itCount = commands[0].args.filter(
      (a) => a === 'integration-tests',
    ).length;
    expect(itCount).toBe(1);
  });
});

describe('run-lint runner — argument forwarding', () => {
  it('forwards --max-warnings 0 to the ESLint invocation', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: ['--max-warnings', '0'],
      cache: false,
    });
    expect(commands[0].args).toContain('--max-warnings');
    expect(commands[0].args).toContain('0');
  });

  it('forwards --fix to the ESLint invocation', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: ['--fix'],
      cache: false,
    });
    expect(commands[0].args).toContain('--fix');
  });
});

describe('run-lint runner — cache is opt-in only (A3)', () => {
  it('does NOT add cache flags by default (cache=false)', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
    });
    expect(commands[0].args).not.toContain('--cache');
    expect(commands[0].args).not.toContain('--cache-strategy');
    expect(commands[0].args).not.toContain('--cache-location');
  });

  it('adds --cache --cache-strategy content --cache-location when cache=true', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: true,
    });
    expect(commands[0].args).toContain('--cache');
    expect(commands[0].args).toContain('--cache-strategy');
    expect(commands[0].args).toContain('content');
    expect(commands[0].args).toContain('--cache-location');
    expect(commands[0].args.join(' ')).toContain('node_modules/.cache/eslint');
  });
});

describe('run-lint runner — runner-managed arg stripping', () => {
  it('strips --cache so it is not forwarded (runner owns caching)', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(stripRunnerArgs(['--max-warnings', '0', '--cache'])).toEqual([
      '--max-warnings',
      '0',
    ]);
  });

  it('strips --cache-strategy and its value', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(
      stripRunnerArgs(['--max-warnings', '0', '--cache-strategy', 'content']),
    ).toEqual(['--max-warnings', '0']);
  });

  it('strips --cache-location and its value', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(
      stripRunnerArgs([
        '--max-warnings',
        '0',
        '--cache-location',
        'node_modules/.cache/eslint',
      ]),
    ).toEqual(['--max-warnings', '0']);
  });

  it('strips --targets and its JSON value', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(
      stripRunnerArgs([
        '--targets',
        '["packages/core"]',
        '--max-warnings',
        '0',
      ]),
    ).toEqual(['--max-warnings', '0']);
  });

  it('does not consume the next flag when --targets has no value (malformed)', async () => {
    const { stripRunnerArgs } = await loadRunner();
    // --targets followed by another flag must not eat --fix
    expect(
      stripRunnerArgs(['--targets', '--fix', '--max-warnings', '0']),
    ).toEqual(['--fix', '--max-warnings', '0']);
  });

  it('strips --targets alone when it is the last arg (no value)', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(stripRunnerArgs(['--max-warnings', '0', '--targets'])).toEqual([
      '--max-warnings',
      '0',
    ]);
  });

  it('does not consume the next flag when a cache value flag has no value', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(
      stripRunnerArgs(['--cache-location', '--fix', '--max-warnings', '0']),
    ).toEqual(['--fix', '--max-warnings', '0']);
  });

  it('preserves eslint args like --fix and --max-warnings', async () => {
    const { stripRunnerArgs } = await loadRunner();
    expect(stripRunnerArgs(['--fix', '--max-warnings', '0'])).toEqual([
      '--fix',
      '--max-warnings',
      '0',
    ]);
  });
});

describe('run-lint runner — heap normalization', () => {
  it('normalizes to 12GB (12288) by default', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
    });
    expect(commands[0].nodeOptions).toContain('--max-old-space-size=12288');
  });

  it('does not retain a stale --max-old-space-size from inherited NODE_OPTIONS', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      nodeOptions: '--max-old-space-size=4096 --enable-source-maps',
    });
    // The inherited 4096 must be replaced by the normalized 12288, but
    // unrelated options must survive.
    expect(commands[0].nodeOptions).not.toContain('4096');
    expect(commands[0].nodeOptions).toContain('--max-old-space-size=12288');
    expect(commands[0].nodeOptions).toContain('--enable-source-maps');
  });

  it('removes a space-separated --max-old-space-size and its numeric value', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      nodeOptions: '--max-old-space-size 4096 --enable-source-maps',
    });
    // The space-separated 4096 must be stripped (not left as a stray token)
    // and replaced by the normalized 12288.
    expect(commands[0].nodeOptions).not.toContain('4096');
    expect(commands[0].nodeOptions).toContain('--max-old-space-size=12288');
    expect(commands[0].nodeOptions).toContain('--enable-source-maps');
  });

  it('clamps a non-positive heap to the default so Node.js still starts', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      heapMb: 0,
    });
    expect(commands[0].nodeOptions).toContain('--max-old-space-size=12288');
  });

  it('clamps NaN heap to the default instead of producing --max-old-space-size=NaN', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      heapMb: Number.NaN,
    });
    expect(commands[0].nodeOptions).toContain('--max-old-space-size=12288');
    expect(commands[0].nodeOptions).not.toContain('NaN');
  });

  it('clamps Infinity heap to the default', async () => {
    const { buildLintCommands } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      heapMb: Number.POSITIVE_INFINITY,
    });
    expect(commands[0].nodeOptions).toContain('--max-old-space-size=12288');
    expect(commands[0].nodeOptions).not.toContain('Infinity');
  });
});
