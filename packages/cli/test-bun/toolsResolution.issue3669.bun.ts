/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import stripJsonComments from 'strip-json-comments';
import { z } from 'zod';
import { canonicalizePolicyToolEntry } from '@vybestack/llxprt-code-tools';
import { createByteBudget } from '@vybestack/llxprt-code-tools/acquisition.js';

describe('#3669 CLI workspace tools resolution', () => {
  it('loads executable exports from the tools barrel and deep subpath', () => {
    expect(typeof canonicalizePolicyToolEntry).toBe('function');
    expect(typeof createByteBudget).toBe('function');
  });

  it('resolves the tools entry to source rather than dist', () => {
    const resolved = import.meta.resolve('@vybestack/llxprt-code-tools');

    expect(resolved).not.toContain('/dist/');
    expect(resolved).toContain('/tools/index.ts');
  });

  it('keeps every CLI workspace path mapping out of dist', () => {
    const content = readFileSync(
      new URL('../tsconfig.json', import.meta.url),
      'utf8',
    );
    const parsed: unknown = JSON.parse(stripJsonComments(content));
    const config = z
      .object({
        compilerOptions: z.object({
          paths: z.record(z.array(z.string()).nonempty()),
        }),
      })
      .parse(parsed);

    // Issue #3669: Bun applies these mappings at runtime, so dev/test workspace
    // dependencies must bind to source rather than build output.
    const targets = Object.values(config.compilerOptions.paths).flat();
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target).not.toContain('/dist/');
    }
  });
});
