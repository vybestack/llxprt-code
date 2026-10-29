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
import { compilerHostWithWorkspaceModules } from './runtime-state-workspace-modules.js';
import { resolveStateRoots } from './runtime-state-roots.js';

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
  const { mutableRoots, alsRoots } = resolveStateRoots(workspace, policy);
  const allowances = policy.alsAllowances.map((allowance) => ({
    ...allowance,
    file: workspacePath(workspace, allowance.file),
  }));
  const immutableTables = (policy.immutableTables ?? []).map((entry) => ({
    ...entry,
    file: workspacePath(workspace, entry.file),
  }));
  const stateFiles = files.filter((file) =>
    inRoots(workspace, file, [...mutableRoots, ...alsRoots]),
  );
  const options: ts.CompilerOptions = {
    allowJs: true,
    noEmit: true,
    noLib: true,
    types: [],
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const program = ts.createProgram({
    rootNames: [...stateFiles],
    options,
    host: compilerHostWithWorkspaceModules(workspace, options),
  });
  const stateFindings = stateFiles.flatMap((file) =>
    scanRuntimeStateStructure(
      file,
      readFileSync(file, 'utf8'),
      allowances,
      program,
      inRoots(workspace, file, mutableRoots)
        ? { allowlist: immutableTables }
        : undefined,
    )
      .filter((finding) =>
        inRoots(
          workspace,
          file,
          finding.kind === 'async-local-storage' ? alsRoots : mutableRoots,
        ),
      )
      .map((finding) => ({ ...finding, rule: finding.kind })),
  );
  const unscanned = immutableTables
    .filter(
      (entry) =>
        !stateFiles.includes(entry.file) ||
        !inRoots(workspace, entry.file, mutableRoots),
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
