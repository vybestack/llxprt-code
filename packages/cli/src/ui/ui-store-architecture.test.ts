/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('UI store architecture contracts', () => {
  it('passes explicit layout props rather than hook result bags into the runtime view', () => {
    const source = readFileSync(
      new URL('./AppContainerRuntime.tsx', import.meta.url),
      'utf8',
    );
    const viewContract = source.slice(
      source.indexOf('interface AppRuntimeViewProps'),
    );
    expect(viewContract).not.toMatch(/\b(?:bootstrap|layout)\s*:/);
    expect(source).not.toMatch(
      /\b(?:bootstrap|layout)=\{(?:bootstrap|layout)\}/,
    );
    expect(source).toContain('export function buildAppCommands(');
  });

  it('documents the production regions and isolation coverage without outstanding deleted projections', () => {
    const doc = readFileSync(
      new URL(
        '../../../../dev-docs/architecture/ui-stores.md',
        import.meta.url,
      ),
      'utf8',
    );
    expect(doc).not.toMatch(/build(?:Input|Layout)Params/);
    expect(doc).toContain('DefaultAppLayout.renderIsolation.test.tsx');
    expect(doc).toContain('FooterRegion');
    expect(doc).not.toContain('That test is still outstanding');
  });
});
