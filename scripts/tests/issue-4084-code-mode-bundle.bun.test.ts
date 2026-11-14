/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4084: the CLI bundle inlines the code mode runtime into llxprt.js, so
 * the runtime looks for `quickjs-wrapper.js` next to the bundle, and the
 * bundled wrapper loads the QuickJS wasm staged next to it. This builds the
 * real wrapper bundle target plus a host entry that inlines the runtime the
 * way llxprt.js does, stages the wasm with the production stager, and runs a
 * script end to end from a directory that has no node_modules.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QUICKJS_WRAPPER_BUNDLE,
  cliBundleTargets,
} from '../bun-build.config.ts';
import {
  BUNDLED_QUICKJS_WASM_FILE,
  stageQuickJsWasm,
} from '../copy_bundle_assets.ts';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const runtimeSource = join(
  repoRoot,
  'packages/agents/src/code-mode/quickjs-process-runtime.ts',
);

function wrapperTarget(): Parameters<typeof Bun.build>[0] {
  const target = cliBundleTargets.find(
    (candidate) => candidate.label === 'quickjs-wrapper',
  );
  if (target === undefined) throw new Error('No quickjs-wrapper bundle target');
  return target.config;
}

async function build(config: Parameters<typeof Bun.build>[0]): Promise<void> {
  const result = await Bun.build(config);
  if (!result.success)
    throw new Error(result.logs.map((log) => String(log)).join('\n'));
}

function runBundledHost(bundleDir: string): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = spawnSync(process.execPath, [join(bundleDir, 'llxprt.js')], {
    cwd: bundleDir,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('code mode bundle layout (issue #4084)', () => {
  let scratch: string;
  let bundleDir: string;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'code-mode-bundle-'));
    bundleDir = join(scratch, 'bundle');
    const entry = join(scratch, 'host-entry.ts');
    writeFileSync(
      entry,
      `import { QuickJsProcessRuntime } from ${JSON.stringify(runtimeSource)};
const result = await new QuickJsProcessRuntime().run(
  {
    language: 'javascript',
    source: 'const r = await tools.echo({ n: 2 }); return { answer: r.value * 21 };',
    tools: ['echo'],
    apiRevision: 'bundle-probe',
    purpose: 'bundled layout',
  },
  async () => ({ ok: true, value: 2, completeness: 'complete' }),
  new AbortController().signal,
);
process.stdout.write(JSON.stringify(result));
`,
    );
    const wrapper = wrapperTarget();
    await build({ ...wrapper, outdir: bundleDir });
    await build({
      ...wrapper,
      define: { 'process.env.NODE_ENV': '"production"' },
      entrypoints: [entry],
      naming: 'llxprt.js',
      outdir: bundleDir,
    });
    stageQuickJsWasm(repoRoot, bundleDir);
  }, 120_000);

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('emits the wrapper and stages the wasm as separate bundle artifacts', () => {
    expect(readdirSync(bundleDir).sort()).toStrictEqual(
      [BUNDLED_QUICKJS_WASM_FILE, 'llxprt.js', QUICKJS_WRAPPER_BUNDLE].sort(),
    );
  });

  it('runs a script end to end from the bundled runtime and wrapper', () => {
    const run = runBundledHost(bundleDir);

    expect(run.stderr).toBe('');
    expect(JSON.parse(run.stdout)).toStrictEqual({
      ok: true,
      value: { answer: 42 },
      callCount: 1,
      logs: [],
    });
  });

  it('loads the staged wasm rather than an installed copy', () => {
    const staged = join(bundleDir, BUNDLED_QUICKJS_WASM_FILE);
    const moved = join(scratch, BUNDLED_QUICKJS_WASM_FILE);
    renameSync(staged, moved);
    try {
      const run = runBundledHost(bundleDir);
      expect(JSON.parse(run.stdout)).toMatchObject({
        ok: false,
        error: { code: 'RUNTIME_UNAVAILABLE' },
      });
    } finally {
      renameSync(moved, staged);
    }
  });
});
