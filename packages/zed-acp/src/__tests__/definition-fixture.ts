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
import {
  WorkspaceDefinitionOwner,
  type ProfileDefinitionReads,
} from '@vybestack/llxprt-code-core';

export function installZedDefinitionFixture(): () => ProfileDefinitionReads {
  const roots: Array<{ directory: string; owner: WorkspaceDefinitionOwner }> =
    [];
  afterEach(async () => {
    const errors: unknown[] = [];
    for (const { directory, owner } of roots.splice(0)) {
      const results = await Promise.allSettled([owner.dispose()]);
      errors.push(
        ...results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      );
      await rm(directory, { recursive: true, force: true });
    }
    if (errors.length > 0)
      throw new AggregateError(errors, 'ACP definition fixture cleanup failed');
  });
  return () => {
    const directory = mkdtempSync(join(tmpdir(), 'acp-definitions-'));
    const owner = new WorkspaceDefinitionOwner(
      join(directory, 'profiles'),
      join(directory, 'subagents'),
    );
    roots.push({ directory, owner });
    return owner.profileReads;
  };
}
