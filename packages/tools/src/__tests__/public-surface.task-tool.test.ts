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
import * as toolsRoot from '@vybestack/llxprt-code-tools';

const toolsIndexPath = resolve(import.meta.dirname, '../index.ts');

function readToolsRootBarrel(): string {
  return readFileSync(toolsIndexPath, 'utf-8');
}

describe('issue #2250: tools package public surface no longer exposes duplicate TaskTool', () => {
  const rootKeys = new Set(Object.keys(toolsRoot));
  const rootBarrelSource = readToolsRootBarrel();

  it('does not export a TaskTool class from the tools root barrel', () => {
    expect(rootKeys.has('TaskTool')).toBe(false);
  });

  it('does not export TaskTool or TaskToolParams from the tools root barrel source', () => {
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

  it('does not re-export the duplicate task module into the tools root surface', () => {
    expect(
      exportsModuleFromSource(rootBarrelSource, './tools/task.js', {
        includeTypeOnly: true,
      }),
    ).toBe(false);
  });
});
