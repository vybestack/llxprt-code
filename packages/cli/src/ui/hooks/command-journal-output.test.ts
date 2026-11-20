/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  decodeJournalUiItem,
  encodeJournalUiItem,
} from '../stores/turn/journal-ui-item.js';
import {
  ConfigSource,
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createExtensionsCommand } from '../commands/extensionsCommand.js';
import { createMemoryCommand } from '../commands/memoryCommand.js';
import { NativeJournalCursor } from '../stores/turn/native-journal-cursor.js';
import { writeCommandOutput } from './command-journal-output.js';
import { ToolCallStatus, type HistoryItemWithoutId } from '../types.js';
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';
import { journalCommandOutput } from '../../__tests__/journal-command-output-fixture.js';
import { bindExtensionsCommand } from '../commands/extensionsCommandHost.js';
import { createHelpCommand } from '../commands/helpCommand.js';
import { createHooksCommand } from '../commands/hooksCommand.js';

const notices: HistoryItemWithoutId[] = [
  { type: 'info', text: 'hook started', icon: '!', color: 'green' },
  { type: 'warning', text: 'startup warning' },
  {
    type: 'tool_group',
    agentId: 'primary',
    tools: [
      {
        callId: 'shell-1',
        name: 'Shell',
        description: 'echo done',
        status: ToolCallStatus.Success,
        resultDisplay: 'done',
        renderOutputAsMarkdown: false,
        confirmationDetails: undefined,
      },
    ],
  },
  { type: 'error', text: 'authentication failed' },
  { type: 'oauth_url', text: 'Authenticate', url: 'https://example.org/auth' },
  { type: 'profile_change', profileName: 'local' },
  { type: 'help', timestamp: new Date('2026-10-26T00:00:00Z') },
  {
    type: 'hooks_list',
    hooks: [
      {
        config: { type: HookType.Command, command: 'echo ok', name: 'start' },
        source: ConfigSource.User,
        eventName: HookEventName.SessionStart,
        enabled: true,
      },
    ],
  },
  {
    type: 'skills_list',
    skills: [
      {
        name: 'build',
        description: 'Build',
        location: '/skills/build',
        body: 'Run build',
        source: 'project',
      },
    ],
    showDescriptions: true,
  },
  {
    type: 'extensions_list',
    extensions: [
      {
        name: 'test',
        version: '1',
        path: '/extensions/test',
        isActive: true,
        contextFiles: ['notes.md'],
      },
    ],
  },
  {
    type: 'mcp_status',
    servers: [
      {
        name: 'local',
        connected: true,
        tools: ['read'],
        prompts: [],
        resources: [],
      },
    ],
  },
];

describe('journal command presentation', () => {
  it('refuses model output and malformed presentation payloads', () => {
    expect(() =>
      encodeJournalUiItem({ type: 'gemini', text: 'model output' }),
    ).toThrow(/Invalid discriminator/);
    expect(() =>
      decodeJournalUiItem('{"type":"oauth_url","text":"missing url"}'),
    ).toThrow(/Required/);
    expect(() =>
      decodeJournalUiItem('{"type":"help","timestamp":"invalid date"}'),
    ).toThrow(/Invalid date/);
  });
  it('awaits direct help and hook command presentation without invoking the ledger', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      const base = createMockCommandContext();
      const context: CommandOwnerFixture = {
        ...base,
        recordingOwner: 'agent',
        services: { ...base.services, agent },
        ui: {
          ...base.ui,
          addItem: () => {
            throw new Error('Ledger write forbidden');
          },
        },
      };
      const output = journalCommandOutput(agent.session);
      const helpCommand = createHelpCommand(output.addItem);
      const hooksCommand = createHooksCommand(
        {
          isConfigured: true,
          isAvailable: true,
          listHooks: () => agent.hooks.listHooks(),
          enable: (name) => agent.hooks.enable(name),
          disable: (name) => agent.hooks.disable(name),
          setDisabledHooks: (names) => agent.hooks.setDisabledHooks(names),
        },
        output.addItem,
      );
      const extensionsCommand = createExtensionsCommand(
        bindExtensionsCommand(
          null,
          output.addItem,
          () => {},
          () => {},
        ),
      );
      const unavailable = (): never => {
        throw new Error('Unconfigured memory operation');
      };
      const memoryCommand = createMemoryCommand({
        isConfigured: false,
        getUserMemory: () => '',
        getLlxprtMdFileCount: () => 0,
        getLlxprtMdFilePaths: () => [],
        refreshMemory: unavailable,
        updateSystemInstruction: unavailable,
        addItem: output.addItem,
        setMemoryFileCount: unavailable,
        saveCoreMemory: unavailable,
      });
      if (!helpCommand.action || !hooksCommand.action)
        throw new Error('Missing command action');
      await helpCommand.action(context, '');
      await hooksCommand.action(context, '');
      const noConfig: CommandOwnerFixture = {
        ...context,
        services: { ...context.services, config: null },
      };
      const showMemory = memoryCommand.subCommands?.find(
        (command) => command.name === 'show',
      )?.action;
      if (!extensionsCommand.action || !showMemory)
        throw new Error('Missing command action');
      await extensionsCommand.action(noConfig, '');
      await showMemory(noConfig, '');
      await output.settle();
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing journal');
      const cursor = await NativeJournalCursor.open(path, {}, 10);
      try {
        expect(
          (await cursor.pageBack(10)).entries.flatMap((entry) =>
            entry.kind === 'projected' ? [entry.item.type] : [],
          ),
        ).toStrictEqual(['info', 'info', 'info', 'help']);
      } finally {
        await cursor.close();
      }
    });
  }, 30000);
  it('preserves structured UI-only output through reopen without model or ledger rows', async () => {
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      const base = createMockCommandContext();
      const context: CommandOwnerFixture = {
        ...base,
        recordingOwner: 'agent',
        services: { ...base.services, agent },
        ui: {
          ...base.ui,
          addItem: () => {
            throw new Error('Ledger write forbidden');
          },
        },
      };
      for (const notice of notices)
        await writeCommandOutput(
          () => agent.session,
          agent.session,
          context.recordingOwner,
          context.ui.addItem,
          notice,
        );
      const path = agent.session.getRecording().path;
      if (!path) throw new Error('Missing journal path');
      await agent.session.setRecording({ enabled: false });
      const cursor = await NativeJournalCursor.open(path, {}, 20);
      try {
        const entries = (await cursor.pageBack(20)).entries;
        const actual = entries.flatMap((entry) =>
          entry.kind === 'projected' ? [entry.item] : [],
        );
        expect(
          actual.map(({ id: _id, rowIdentity: _identity, ...item }) => item),
        ).toStrictEqual([...notices].reverse());
        expect(await agent.session.getHistory()).toStrictEqual([]);
      } finally {
        await cursor.close();
      }
    });
  }, 30000);
});
