/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { createCompletionHandler } from '../schema/index.js';
import { authCommand } from '../authCommand.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import type {
  CommandArgumentSchema,
  CompletionResult,
} from '../schema/types.js';

/**
 * Finding 8: schema/autocomplete behavioral tests for the `unlock`
 * subcommand. These exercise the exported schema and user-visible
 * completion behavior, not just executor mock calls.
 */
describe('authCommand unlock schema completion (Finding 8)', () => {
  const mockContext = createMockCommandContext();

  function getProviderSchema(): CommandArgumentSchema {
    const schema = authCommand.schema;
    if (schema === undefined) {
      throw new Error('authCommand has no schema');
    }
    return schema;
  }

  function getUnlockBucketNode(): CommandArgumentSchema[number] {
    const providerNode = getProviderSchema()[0];
    const unlockNode = (providerNode.next ?? []).find(
      (node) => node.kind === 'literal' && node.value === 'unlock',
    );
    if (unlockNode === undefined) {
      throw new Error('authCommand schema has no unlock node');
    }
    const bucketNode = unlockNode.next?.[0];
    if (bucketNode === undefined) {
      throw new Error('authCommand unlock schema has no bucket node');
    }
    return bucketNode;
  }

  async function getCompletions(input: string): Promise<readonly string[]> {
    const handler = createCompletionHandler(getProviderSchema());
    const parts = input.split(' ');
    // The first token after '/auth' is the provider, followed by the action.
    // We drive the completion handler with the args already consumed.
    const completedArgs = parts.slice(0, -1);
    const partialArg = parts[parts.length - 1] ?? '';

    const result: CompletionResult = await handler(
      mockContext,
      {
        args: '',
        completedArgs,
        partialArg,
        commandPathLength: 1,
      },
      `/auth ${input}`,
    );
    return result.suggestions.map((s) => s.value);
  }

  it('authCommand schema has unlock subcommand', () => {
    const schema = getProviderSchema();
    // The schema is [provider] → [action...]. Find the provider node.
    const providerNode = schema[0];
    expect(providerNode).toBeDefined();
    const actions = providerNode.next ?? [];
    const unlock = actions.find(
      (a) => a.kind === 'literal' && a.value === 'unlock',
    );
    expect(unlock).toBeDefined();
  });

  it('completion offers unlock after provider', async () => {
    const values = await getCompletions('codex ');
    expect(values).toContain('unlock');
  });

  it('partialArg "un" yields unlock', async () => {
    const values = await getCompletions('codex un');
    expect(values).toContain('unlock');
  });

  it('completion offers lock after provider', async () => {
    const values = await getCompletions('codex ');
    expect(values).toContain('lock');
  });

  it('unlock has --force flag in schema', () => {
    const flags = getUnlockBucketNode().next ?? [];
    const forceFlag = flags.find(
      (flag) => flag.kind === 'literal' && flag.value === '--force',
    );
    expect(forceFlag).toBeDefined();
  });

  it('nests --i-have-stopped-all-processes beneath --force', () => {
    const flags = getUnlockBucketNode().next ?? [];
    const standaloneAck = flags.find(
      (flag) =>
        flag.kind === 'literal' &&
        flag.value === '--i-have-stopped-all-processes',
    );
    const forceFlag = flags.find(
      (flag) => flag.kind === 'literal' && flag.value === '--force',
    );
    const nestedAck = forceFlag?.next?.find(
      (flag) =>
        flag.kind === 'literal' &&
        flag.value === '--i-have-stopped-all-processes',
    );

    expect(standaloneAck).toBeUndefined();
    expect(nestedAck).toBeDefined();
  });
});
