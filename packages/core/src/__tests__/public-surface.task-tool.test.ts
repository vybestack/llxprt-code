/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  exportsIdentifierFromSource,
  exportsModuleFromSource,
} from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect } from 'vitest';
import * as coreRoot from '@vybestack/llxprt-code-core';

const coreIndexPath = resolve(import.meta.dirname, '../index.ts');

function readCoreRootBarrel(): string {
  return readFileSync(coreIndexPath, 'utf-8');
}

describe('issue #2250: core public surface no longer re-exports duplicate TaskTool', () => {
  const rootKeys = new Set(Object.keys(coreRoot));
  const rootBarrelSource = readCoreRootBarrel();

  it('does not re-export a TaskTool class from the core root barrel', () => {
    expect(rootKeys.has('TaskTool')).toBe(false);
  });

  it('does not re-export TaskTool or TaskToolParams from the core root barrel source', () => {
    expect(
      exportsIdentifierFromSource(rootBarrelSource, 'TaskTool', {
        includeTypeOnly: true,
      }),
    ).toBe(false);
    expect(
      exportsIdentifierFromSource(rootBarrelSource, 'TaskToolParams', {
        includeTypeOnly: true,
      }),
    ).toBe(false);
  });

  it('does not re-export the entire tools package into the core root surface', () => {
    expect(
      exportsModuleFromSource(rootBarrelSource, '@vybestack/llxprt-code-tools'),
    ).toBe(false);
  });
});
