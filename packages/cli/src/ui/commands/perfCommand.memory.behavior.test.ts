/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/perf memory` wiring: it must read live session state, and it must degrade
 * honestly when no session exists yet.
 */

import { describe, expect, it } from 'bun:test';
import { createPerfCommand } from './perfCommand.js';
import type { CommandContext, SlashCommand } from './types.js';
import type { IContent } from '@vybestack/llxprt-code-core';

function memorySubCommand(): SlashCommand {
  const command = createPerfCommand({ perfDir: '/tmp/perf-memory-test' });
  const sub = command.subCommands?.find((s) => s.name === 'memory');
  if (sub === undefined) {
    throw new Error('/perf memory subcommand is not registered');
  }
  return sub;
}

/** A context whose agent client exposes the given history. */
function contextWithHistory(history: readonly IContent[]): CommandContext {
  return {
    services: {
      config: {
        getAgentClient: () => ({
          getHistoryService: () => ({
            getAll: () => history,
            getChronologyTrace: () => [],
            getRawHistory: () => history,
          }),
        }),
      },
    },
  } as unknown as CommandContext;
}

async function run(
  sub: SlashCommand,
  context: CommandContext,
): Promise<string> {
  const result = await sub.action?.(context, '');
  if (result === undefined || !('content' in result)) {
    throw new Error('expected a message action return');
  }
  return String(result.content);
}

describe('/perf memory', () => {
  it('is registered as a subcommand of /perf', () => {
    expect(memorySubCommand().name).toBe('memory');
  });

  it('reports retained bytes attributed to the responsible tool', async () => {
    const history: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'read_file',
            result: { body: 'a'.repeat(300_000) },
          },
        ],
      },
    ];
    const output = await run(memorySubCommand(), contextWithHistory(history));
    expect(output).toContain('History Memory');
    expect(output).toContain('read_file');
    expect(output).toContain('across 1 history items');
  });

  it('says history is empty rather than printing an empty table', async () => {
    const output = await run(memorySubCommand(), contextWithHistory([]));
    expect(output).toContain('History is empty.');
  });

  it('degrades honestly when no agent client exists yet', async () => {
    const context = {
      services: { config: null },
    } as unknown as CommandContext;
    const output = await run(memorySubCommand(), context);
    expect(output).toContain('History is not available');
  });

  it('degrades honestly when the agent client has no history service', async () => {
    const context = {
      services: { config: { getAgentClient: () => null } },
    } as unknown as CommandContext;
    const output = await run(memorySubCommand(), context);
    expect(output).toContain('History is not available');
  });

  it('does not require perf telemetry to be enabled', async () => {
    // createPerfCommand is constructed with no snapshotCapability, i.e. perf
    // telemetry off. The memory view reads live state, so it still works.
    const command = createPerfCommand({ perfDir: '/tmp/perf-memory-test' });
    const sub = command.subCommands?.find((s) => s.name === 'memory');
    expect(sub).toBeDefined();
    if (sub === undefined) {
      throw new Error('/perf memory subcommand is not registered');
    }
    const output = await run(sub, contextWithHistory([]));
    expect(output).toContain('History Memory');
  });
});
