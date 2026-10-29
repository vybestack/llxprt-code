/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { describe, expect, it } from 'bun:test';
import { createPerfCommand } from './perfCommand.js';
import type { SlashCommand } from './types.js';
import type { IContent } from '@vybestack/llxprt-code-core';

function historyRows(history: readonly IContent[]): AsyncIterable<IContent> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void> {
      yield* history;
    },
  };
}

function memorySubCommand(
  readHistory: () => AsyncIterable<IContent> | null = () => null,
): SlashCommand {
  const command = createPerfCommand({
    perfDir: '/tmp/perf-memory-test',
    readHistory,
  });
  return requireSubcommand(
    command.subCommands?.find((s) => s.name === 'memory'),
  );
}

async function run(sub: SlashCommand): Promise<string> {
  const result = await sub.action?.(createMockCommandContext(), '');
  if (result === undefined || !('content' in result)) {
    throw new Error('expected a message action return');
  }
  return String(result.content);
}

function requireSubcommand(subcommand: SlashCommand | undefined): SlashCommand {
  if (subcommand === undefined) {
    throw new Error('/perf memory subcommand is not registered');
  }
  return subcommand;
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
    const output = await run(memorySubCommand(() => historyRows(history)));
    expect(output).toContain('History Memory');
    expect(output).toContain('read_file');
    expect(output).toContain('across 1 history items');
  });

  it('says history is empty rather than printing an empty table', async () => {
    const output = await run(memorySubCommand(() => historyRows([])));
    expect(output).toContain('History is empty.');
  });

  it('reports unavailable history when no session exists yet', async () => {
    const output = await run(memorySubCommand());
    expect(output).toContain('History is not available');
  });

  it('reports unavailable history when the session has no journal', async () => {
    const output = await run(memorySubCommand(() => null));
    expect(output).toContain('History is not available');
  });

  it('does not require perf telemetry to be enabled', async () => {
    const command = createPerfCommand({
      perfDir: '/tmp/perf-memory-test',
      readHistory: () => historyRows([]),
    });
    const sub = command.subCommands?.find((s) => s.name === 'memory');
    expect(sub).toBeDefined();
    const output = await run(requireSubcommand(sub));
    expect(output).toContain('History Memory');
  });
});
