/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  classifyWindowsPathCandidate,
  classifyWindowsPathCandidates,
  isWindowsBunWrapper,
  orderWindowsBunCandidates,
} from './bun-candidate-policy.js';

describe('Windows Bun candidate policy', () => {
  it.each([
    ['C:\\tools\\bun.exe', 'path-native'],
    ['C:\\tools\\BUN.EXE', 'path-native'],
    ['C:\\tools\\bun.cmd', 'wrapper'],
    ['C:\\tools\\BUN.CMD', 'wrapper'],
  ] as const)('classifies %s as %s', (path, kind) => {
    expect(classifyWindowsPathCandidate(path)).toStrictEqual({ path, kind });
  });

  it.each([
    'C:\\tools\\bun.bat',
    'C:\\tools\\bun.ps1',
    'C:\\tools\\bun',
    'C:\\tools\\not-bun.exe',
    '"C:\\tools\\bun.exe\'',
    '\'C:\\tools\\bun.cmd"',
  ])('rejects unsupported PATH candidate %s', (path) => {
    expect(classifyWindowsPathCandidate(path)).toBeNull();
  });

  it('filters unsupported PATH candidates while preserving supported candidate order', () => {
    const native = 'C:\\native\\bun.exe';
    const batch = 'C:\\wrapper\\bun.bat';
    const command = 'C:\\wrapper\\bun.cmd';

    expect(
      classifyWindowsPathCandidates([native, batch, command]),
    ).toStrictEqual([
      { path: native, kind: 'path-native' },
      { path: command, kind: 'wrapper' },
    ]);
  });

  it('orders candidate kinds while preserving input order within each kind', () => {
    const candidates = [
      { path: 'z-first-wrapper', kind: 'wrapper' as const },
      { path: 'z-first-bin-native', kind: 'bin-native' as const },
      { path: 'a-second-bin-native', kind: 'bin-native' as const },
      { path: 'path-native', kind: 'path-native' as const },
      { path: 'direct-native', kind: 'direct-native' as const },
      { path: 'a-second-wrapper', kind: 'wrapper' as const },
    ];

    expect(orderWindowsBunCandidates(candidates)).toStrictEqual([
      { path: 'z-first-bin-native', kind: 'bin-native' },
      { path: 'a-second-bin-native', kind: 'bin-native' },
      { path: 'direct-native', kind: 'direct-native' },
      { path: 'path-native', kind: 'path-native' },
      { path: 'z-first-wrapper', kind: 'wrapper' },
      { path: 'a-second-wrapper', kind: 'wrapper' },
    ]);
    expect(candidates.map((candidate) => candidate.path)).toStrictEqual([
      'z-first-wrapper',
      'z-first-bin-native',
      'a-second-bin-native',
      'path-native',
      'direct-native',
      'a-second-wrapper',
    ]);
  });

  it('identifies only command-shim candidates as Windows wrappers', () => {
    expect(isWindowsBunWrapper({ path: 'bun.cmd', kind: 'wrapper' })).toBe(
      true,
    );
    expect(isWindowsBunWrapper({ path: 'bun.exe', kind: 'path-native' })).toBe(
      false,
    );
  });
});
