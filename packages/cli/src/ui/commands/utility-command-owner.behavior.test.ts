/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createStatsCommand } from './statsCommand.js';
import { createLoggingCommand } from './loggingCommand.js';
import type { SlashCommand } from './types.js';
import { MessageType, type HistoryItemStats } from '../types.js';

async function registered(command: SlashCommand): Promise<SlashCommand> {
  const registry = await CommandService.create(
    [
      new BuiltinCommandLoader(
        {
          ...createUnconfiguredBuiltinOwners(),
          [`${command.name}Command`]: command,
        },
        null,
      ),
    ],
    new AbortController().signal,
  );
  const result = registry
    .getCommands()
    .find((entry) => entry.name === command.name);
  if (!result) throw new Error('Utility command unavailable');
  return result;
}

describe('registered statistics and logging owners', () => {
  const makeOwner = useCommandOwners();
  // The clock is frozen for the duration assertion: building the registry
  // takes a machine-dependent amount of real time, which would otherwise be
  // added to the two minutes the session is declared to have run.
  afterEach(() => {
    setSystemTime();
  });
  it('uses registered session time and reports through its registered UI', async () => {
    await makeOwner('owner');
    const history: Array<Parameters<CommandOwnerFixture['ui']['addItem']>[0]> =
      [];
    const addItem: CommandOwnerFixture['ui']['addItem'] = (item) => {
      history.push(item);
      return history.length;
    };
    const now = new Date('2026-10-14T00:02:00Z');
    setSystemTime(now);
    const startTime = new Date(now.getTime() - 120000);
    const readStartTime = () => startTime;
    const command = await registered(
      createStatsCommand({
        readStartTime,
        readQuota: async () => [],
        isOAuthAvailable: () => false,
        discoverBuckets: async () => [],
        addItem,
      }),
    );
    const context = createMockCommandContext({
      services: { agent: null, config: null },
      session: { stats: { sessionStartTime: new Date(0) } },
    });
    await command.action!(context, '');
    const expected: HistoryItemStats = {
      type: MessageType.STATS,
      duration: '2m',
      quotaLines: undefined,
    };
    expect(history).toContainEqual(expected);
  });
  async function renderTailFromLogDirectory(
    ownerName: string,
    logDirectoryName: string,
  ): Promise<string> {
    const owner = await makeOwner(ownerName);
    const logPath = join(
      owner.workspace.getWorkingDirectory(),
      logDirectoryName,
    );
    await mkdir(logPath);
    await writeFile(
      join(logPath, 'session.jsonl'),
      [
        JSON.stringify({
          type: 'request',
          timestamp: '2026-10-14T00:00:00Z',
          provider: 'fake',
          messages: [{ content: 'older question' }],
        }),
        JSON.stringify({
          type: 'response',
          timestamp: '2026-10-14T00:00:01Z',
          provider: 'fake',
          response: 'newest answer',
        }),
      ].join('\n'),
    );
    const history: Array<Parameters<CommandOwnerFixture['ui']['addItem']>[0]> =
      [];
    const addItem: CommandOwnerFixture['ui']['addItem'] = (item) => {
      history.push(item);
      return history.length;
    };
    const command = await registered(
      createLoggingCommand({
        isConfigured: true,
        readTelemetry: () => ({}),
        writeTelemetry: () => {},
        readRuntimeTelemetry: () => ({}),
        updateRuntimeTelemetry: async () => {},
        getConversationLogPath: () => logPath,
        getRedactionConfig: () => ({
          redactApiKeys: true,
          redactCredentials: true,
          redactFilePaths: false,
          redactUrls: false,
          redactEmails: false,
          redactPersonalInfo: false,
        }),
        addItem,
      }),
    );
    const show = command.subCommands?.find((entry) => entry.name === 'show');
    if (!show?.action) throw new Error('Logging show unavailable');
    await show.action(
      createMockCommandContext({ services: { agent: null, config: null } }),
      '1',
    );
    return JSON.stringify(history);
  }
  it('reads the registered conversation log directory and applies the requested tail limit', async () => {
    const rendered = await renderTailFromLogDirectory('logs', 'logs');
    expect(rendered).toContain('Conversation Logs (1 entries)');
    expect(rendered).toContain('newest answer');
    expect(rendered).not.toContain('older question');
  });
  it('leaves interior tildes in an absolute log path untouched, as in Windows 8.3 short names', async () => {
    const rendered = await renderTailFromLogDirectory(
      'short-name-logs',
      'RUNNER~1-logs',
    );
    expect(rendered).toContain('Conversation Logs (1 entries)');
    expect(rendered).toContain('newest answer');
    expect(rendered).not.toContain('older question');
  });
});
