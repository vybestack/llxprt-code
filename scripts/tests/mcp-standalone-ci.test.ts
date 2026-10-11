/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { classifyDocsOnly } from '../docs-only-filter.ts';
import { parseWorkflowYaml } from './typed-test-helpers.ts';

const root = resolve(import.meta.dir, '../..');
const workflow = parseWorkflowYaml(
  readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
);
const command = 'node scripts/tests/mcp-standalone-distribution-fixture.ts';

describe('standalone MCP distribution CI gate', () => {
  it('runs the Node command after the existing full build on Linux without a shard filter', () => {
    const job = workflow.jobs?.['acp_conformance'];
    expect(job?.['runs-on']).toBe('ubuntu-latest');
    expect(job?.if).toBe(
      "${{ needs.doc_change_filter.outputs.docs_only != 'true' && needs.skip_check.outputs.should_skip != 'true' }}",
    );
    const steps = job?.steps ?? [];
    const build = steps.findIndex((step) => step.name === 'Build project');
    const verify = steps.findIndex(
      (step) => step.name === 'Verify standalone MCP distribution',
    );
    expect(build).toBeGreaterThanOrEqual(0);
    expect(steps[build]?.run).toBe('npm run build');
    expect(verify).toBe(build + 1);
    expect(steps[verify]?.run).toBe(
      'npm run test:mcp:distribution -- tmp/mcp-distribution-ci',
    );
    expect(steps[verify]?.if).toBeUndefined();
    expect(steps[verify]?.['continue-on-error']).toBeUndefined();
    const manifest = z
      .object({ scripts: z.record(z.string()) })
      .parse(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')));
    expect(manifest.scripts['test:mcp:distribution']).toBe(command);
    const upload = steps.find(
      (step) => step.name === 'Upload standalone MCP distribution diagnostics',
    );
    expect(upload?.if).toBe('${{ always() }}');
    expect(upload?.with?.['path']).toBe(
      'tmp/mcp-distribution-ci/\n!tmp/mcp-distribution-ci/packed/',
    );
  });

  it('keeps all declared workspace dependencies and runner inputs relevant', () => {
    const manifestSchema = z.object({
      dependencies: z.record(z.string()).optional(),
      optionalDependencies: z.record(z.string()).optional(),
      peerDependencies: z.record(z.string()).optional(),
    });
    const pending = ['mcp'];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const name = pending.pop();
      if (!name || visited.has(name)) continue;
      visited.add(name);
      const manifest = manifestSchema.parse(
        JSON.parse(
          readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8'),
        ),
      );
      for (const dependency of Object.keys({
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      })) {
        if (dependency.startsWith('@vybestack/llxprt-code-'))
          pending.push(dependency.slice('@vybestack/llxprt-code-'.length));
      }
    }
    for (const filename of [
      ...[...visited].flatMap((name) => [
        `packages/${name}/src/runtime.ts`,
        `packages/${name}/package.json`,
        `packages/${name}/tsconfig.build.json`,
      ]),
      'scripts/tests/mcp-standalone-distribution-fixture.ts',
      'scripts/tests/mcp-standalone-behavior-fixture.ts',
      'scripts/tests/mcp-standalone-stdio-fixture.ts',
      'scripts/build.ts',
      'package.json',
      'bun.lock',
      '.nvmrc',
      '.github/workflows/ci.yml',
      'tsconfig.scripts.json',
    ]) {
      expect(
        classifyDocsOnly({
          entries: [{ filename, status: 'modified' }],
          changedFiles: 1,
        }).docsOnly,
        filename,
      ).toBe(false);
    }
  });
});
