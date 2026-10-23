/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const files = [
  '../cli.tsx',
  '../session/interactiveUI.tsx',
  './App.tsx',
  './AppContainerRuntime.tsx',
  './layouts/DefaultAppLayout.tsx',
  './layouts/DefaultAppLayoutRegions.tsx',
  './components/BucketAuthConfirmation.tsx',
  './hooks/useHookDisplayState.ts',
];

describe('CLI consent and hook owner boundaries', () => {
  it.each(files)('does not propagate a bus through %s', (file) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(source).not.toMatch(
      /\bruntimeMessageBus\b|\bgetMessageBus\s*\(|\b(?:type\s+)?MessageBus\s*[,};]/,
    );
  });
});
