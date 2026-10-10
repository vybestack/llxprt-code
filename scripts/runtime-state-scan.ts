/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import type {
  AuditFinding,
  AuditPolicy,
} from './check-runtime-state-boundary.js';
import { scanRuntimeStateStructure } from './tests/runtime-state-structure-guard.js';

export function workspacePath(workspace: string, file: string): string {
  const path = resolve(workspace, file);
  const local = relative(workspace, path);
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new Error(`Path outside audit workspace: ${file}`);
  return path;
}
export function inRoots(
  workspace: string,
  file: string,
  roots: readonly string[],
): boolean {
  return roots.some((root) => {
    const path = workspacePath(workspace, root);
    return file === path || file.startsWith(`${path}${sep}`);
  });
}
export function scanState(
  workspace: string,
  policy: AuditPolicy,
  files: readonly string[],
): Array<Omit<AuditFinding, 'owner'>> {
  const allowances = policy.alsAllowances.map((allowance) => ({
    ...allowance,
    file: workspacePath(workspace, allowance.file),
  }));
  const immutableTables = (policy.immutableTables ?? []).map((entry) => ({
    ...entry,
    file: workspacePath(workspace, entry.file),
  }));
  const stateFiles = files.filter((file) =>
    inRoots(workspace, file, [...policy.mutableRoots, ...policy.alsRoots]),
  );
  const program = ts.createProgram({
    rootNames: [...stateFiles],
    options: {
      allowJs: true,
      noEmit: true,
      noLib: true,
      types: [],
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  });
  const stateFindings = stateFiles.flatMap((file) =>
    scanRuntimeStateStructure(
      file,
      readFileSync(file, 'utf8'),
      allowances,
      program,
      inRoots(workspace, file, policy.mutableRoots)
        ? { allowlist: immutableTables }
        : undefined,
    )
      .filter((finding) =>
        inRoots(
          workspace,
          file,
          finding.kind === 'async-local-storage'
            ? policy.alsRoots
            : policy.mutableRoots,
        ),
      )
      .map((finding) => ({ ...finding, rule: finding.kind })),
  );
  const unscanned = immutableTables
    .filter(
      (entry) =>
        !stateFiles.includes(entry.file) ||
        !inRoots(workspace, entry.file, policy.mutableRoots),
    )
    .map((entry) => ({
      file: entry.file,
      declaration: entry.declaration,
      kind: 'stale-immutable-allowance' as const,
      line: 1,
      column: 1,
      rule: 'stale-immutable-allowance',
    }));
  return [...stateFindings, ...unscanned];
}
