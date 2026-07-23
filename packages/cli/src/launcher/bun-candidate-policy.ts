/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { win32 } from 'node:path';

export type WindowsBunCandidateKind =
  | 'bin-native'
  | 'direct-native'
  | 'path-native'
  | 'wrapper';

export interface WindowsBunCandidate {
  readonly path: string;
  readonly kind: WindowsBunCandidateKind;
}

// Package-local native executables are deterministic and preserve argv without
// a shell. PATH-native Bun follows, while command wrappers remain a last resort.
const WINDOWS_BUN_CANDIDATE_PRIORITY: Readonly<
  Record<WindowsBunCandidateKind, number>
> = {
  'bin-native': 0,
  'direct-native': 1,
  'path-native': 2,
  wrapper: 3,
};

export function orderWindowsBunCandidates<
  Candidate extends WindowsBunCandidate,
>(candidates: readonly Candidate[]): readonly Candidate[] {
  return [...candidates].sort(
    (left, right) =>
      WINDOWS_BUN_CANDIDATE_PRIORITY[left.kind] -
      WINDOWS_BUN_CANDIDATE_PRIORITY[right.kind],
  );
}

export function isWindowsBunWrapper(candidate: WindowsBunCandidate): boolean {
  return candidate.kind === 'wrapper';
}

export function classifyWindowsPathCandidate(
  path: string,
): WindowsBunCandidate | null {
  switch (win32.basename(path).toLowerCase()) {
    case 'bun.exe':
      return { path, kind: 'path-native' };
    case 'bun.cmd':
      return { path, kind: 'wrapper' };
    default:
      return null;
  }
}

export function classifyWindowsPathCandidates(
  paths: readonly string[],
): readonly WindowsBunCandidate[] {
  return paths.flatMap((path) => {
    const candidate = classifyWindowsPathCandidate(path);
    return candidate === null ? [] : [candidate];
  });
}
