#!/usr/bin/env bun

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { verifyBunWorkspaceLinks } from './verify-bun-workspace-links.ts';

function readWorkspaceDirectories(repoRoot: string): readonly string[] {
  const manifest: unknown = JSON.parse(
    readFileSync(resolve(repoRoot, 'package.json'), 'utf8'),
  );
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('Root package.json must contain a JSON object.');
  }
  const workspaces = Reflect.get(manifest, 'workspaces');
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw new Error('Root package.json must declare a non-empty `workspaces`.');
  }
  if (!workspaces.every((entry) => typeof entry === 'string')) {
    throw new Error('Root package.json `workspaces` entries must be strings.');
  }
  return workspaces;
}

export function prepareWorkspaceBuild(repoRoot: string): void {
  const failures = verifyBunWorkspaceLinks(repoRoot);
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }

  for (const workspaceDir of new Set(readWorkspaceDirectories(repoRoot))) {
    rmSync(resolve(repoRoot, workspaceDir, 'dist'), {
      recursive: true,
      force: true,
    });
  }
}

function main(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  prepareWorkspaceBuild(repoRoot);
}

if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
