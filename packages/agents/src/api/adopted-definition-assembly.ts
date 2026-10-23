/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';

export function adoptedDefinitionCleanup(
  workspace: McpRuntimeOwner,
  definitions: WorkspaceDefinitionOwner | undefined,
  ownership: 'agent' | 'caller' | undefined,
  ownsWorkspace: boolean,
): (() => Promise<void>) | undefined {
  const owned =
    ownership === 'agent' &&
    definitions !== undefined &&
    (!ownsWorkspace || definitions !== workspace.workspaceDefinitions);
  if (!owned && !ownsWorkspace) return undefined;
  return async () => {
    const results = await Promise.allSettled([
      owned ? definitions.dispose() : undefined,
      ownsWorkspace ? workspace.dispose() : undefined,
    ]);
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        'Adopted workspace definition cleanup failed',
      );
  };
}
