/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertInkMemoryRetentionPatch } from '../bun-build.config.ts';

const PATCH_MARKER = 'export const internal_memoryRetentionPatchVersion = 2;\n';

describe('Ink memory-retention build guard', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  function writeMeasureText(source: string): void {
    root = mkdtempSync(join(tmpdir(), 'ink-patch-build-guard-'));
    const buildDir = join(root, 'node_modules', 'ink', 'build');
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(buildDir, 'measure-text.js'), source);
  }

  it('accepts the current versioned patch marker', () => {
    writeMeasureText(PATCH_MARKER);

    expect(() => assertInkMemoryRetentionPatch(root)).not.toThrow();
  });

  it('rejects a stale patch marker', () => {
    writeMeasureText(
      'export const internal_memoryRetentionPatchVersion = 1;\n',
    );

    expect(() => assertInkMemoryRetentionPatch(root)).toThrow(
      'Ink memory-retention patch v2 is required',
    );
  });

  it('rejects stock Ink with no patch marker', () => {
    writeMeasureText('export function inkCharacterWidth() {}\n');

    expect(() => assertInkMemoryRetentionPatch(root)).toThrow(
      'Ink memory-retention patch v2 is required',
    );
  });
});
