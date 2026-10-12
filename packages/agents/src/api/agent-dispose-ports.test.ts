/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { deferred } from './__tests__/helpers/shell-owner-gate.js';
import { joinAgentWork } from './agentDisposeHelpers.js';

describe('joined shutdown operation ports', () => {
  it('retains MCP resources until pending tasks finish while joining auth and profile work', async () => {
    const open = new Set(['tasks', 'mcp-owner', 'auth', 'profile']);
    const taskCompletion = deferred<void>();
    const errors: unknown[] = [];
    const joining = joinAgentWork(
      async () => {
        open.delete('profile');
      },
      async () => {
        open.delete('auth');
      },
      () => open.has('tasks'),
      async () => {
        await taskCompletion.promise;
        open.delete('tasks');
      },
      async () => {
        open.delete('mcp-owner');
      },
      errors,
    );
    await Promise.resolve();
    expect([...open].sort()).toStrictEqual(['mcp-owner', 'tasks']);
    taskCompletion.resolve();
    await joining;
    expect(open.size).toBe(0);
    expect(errors).toStrictEqual([]);
  });

  it('collects independent cancellation failures without leaving owned MCP resources open', async () => {
    let open = true;
    const errors: unknown[] = [];
    await joinAgentWork(
      async () => {
        throw new Error('profile cancellation failed');
      },
      async () => {
        throw new Error('auth cancellation failed');
      },
      () => false,
      async () => {},
      async () => {
        open = false;
      },
      errors,
    );
    expect(open).toBe(false);
    expect(errors).toHaveLength(2);
  });
});
