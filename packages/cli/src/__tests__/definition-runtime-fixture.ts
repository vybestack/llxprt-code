/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';

export function installDefinitionRuntimeFixture(): () => Pick<
  Agent['workspace'],
  | 'profileDefinitions'
  | 'profileWrites'
  | 'subagentDefinitions'
  | 'subagentWrites'
> & { readonly definitionOwner: WorkspaceDefinitionOwner } {
  const owned: Array<{ root: string; definitions: WorkspaceDefinitionOwner }> =
    [];
  afterEach(async () => {
    const failures: unknown[] = [];
    for (const { root, definitions } of owned.splice(0)) {
      const results = await Promise.allSettled([definitions.dispose()]);
      failures.push(
        ...results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      );
      await rm(root, { recursive: true, force: true });
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Definition fixture cleanup failed');
  });
  return () => {
    const root = mkdtempSync(join(tmpdir(), 'llxprt-definition-fixture-'));
    const definitions = new WorkspaceDefinitionOwner(
      join(root, 'profiles'),
      join(root, 'subagents'),
    );
    owned.push({ root, definitions });
    return {
      definitionOwner: definitions,
      profileDefinitions: definitions.profileReads,
      profileWrites: definitions.profileWrites,
      subagentDefinitions: definitions.subagentReads,
      subagentWrites: definitions.subagentWrites,
    };
  };
}
