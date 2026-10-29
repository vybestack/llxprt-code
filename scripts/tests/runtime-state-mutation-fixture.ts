/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  auditRuntimeStateBoundary,
  type AuditPolicy,
} from '../check-runtime-state-boundary.js';

const policy: AuditPolicy = Object.freeze({
  compilerConfig: 'tsconfig.json',
  sourceRoots: Object.freeze(['packages/demo/src']),
  mutableRoots: Object.freeze(['packages/demo/src/runtime']),
  alsRoots: Object.freeze(['packages/demo/src']),
  services: Object.freeze([]),
  configs: Object.freeze([]),
  assembly: Object.freeze([]),
  ambientSources: Object.freeze([]),
  alsAllowances: Object.freeze([]),
});

export function useMutationBoundaryFixture(): {
  put(file: string, source: string): void;
  audit(): ReturnType<typeof auditRuntimeStateBoundary>;
} {
  let workspace: string;
  function put(file: string, source: string): void {
    const path = resolve(workspace, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  beforeEach(() => {
    const evidence = resolve(
      import.meta.dir,
      '../../tmp/verify2616-final/scanner-fixtures',
    );
    mkdirSync(evidence, { recursive: true });
    workspace = mkdtempSync(resolve(evidence, 'mutation-'));
    put(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: [],
          skipLibCheck: true,
        },
      }),
    );
  });
  afterEach(() => rmSync(workspace, { recursive: true, force: true }));
  return { put, audit: () => auditRuntimeStateBoundary(workspace, policy) };
}
