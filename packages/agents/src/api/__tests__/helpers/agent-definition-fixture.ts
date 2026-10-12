/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createAgentDefinitionFixture(): Promise<{
  readonly definitions: WorkspaceDefinitionOwner;
  dispose(): Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'client-definition-'));
  const definitions = new WorkspaceDefinitionOwner(
    join(directory, 'profiles'),
    join(directory, 'subagents'),
  );
  return {
    definitions,
    dispose: async () => {
      try {
        await definitions.dispose();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
