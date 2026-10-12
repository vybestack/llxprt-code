/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732 in owner (Agent session) mode: `/continue` and the session
 * browser report recordings discovery skipped as unreadable, the same way the
 * raw recording path does.
 */

import { describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { continueCommand } from '../commands/continueCommand.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import { resumeOwnerSession } from '../utils/resumeOwnerSession.js';
import { useSessionBrowser } from './useSessionBrowser.js';
import {
  processSlashCommand,
  type SlashCommandHandlerDeps,
} from './slashCommandHandlers.js';
import { convertMessageToHistoryItem } from './slashCommandProcessorSupport.js';

const BROKEN_NAME = 'session-2026-10-08T21-18-08-broken000001.jsonl';
const EMPTY_FILE_REASON = 'Empty file or unreadable first line';

const human = (text: string) => ({
  speaker: 'human' as const,
  blocks: [{ type: 'text' as const, text }],
});

describe('owner mode with an unreadable recording present (issue #3732)', () => {
  it('/continue <id> restores the session and warns with the unreadable file and reason', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow, chatsDir }) => {
      await agent.setHistory([human('owner restored conversation')]);
      await agent.session.setRecording({ enabled: true });
      const sourceId = (await agent.session.listSessions()).at(0)?.id;
      if (!sourceId) throw new Error('Missing source session');
      await agent.session.setRecording({ enabled: false });
      const brokenPath = join(chatsDir, BROKEN_NAME);
      await writeFile(brokenPath, '', 'utf-8');

      const next = await borrow();
      const turnStore = createTurnStore();
      const { commands } = turnStore;
      const addItem: SlashCommandHandlerDeps['addItem'] = (item, timestamp) =>
        commands.addItem(item, timestamp);
      const deps: SlashCommandHandlerDeps = {
        commands: [continueCommand],
        config: {
          getEphemeralSetting: () => 'auto',
          logSlashCommand: () => {},
        } as never,
        commandContext: createMockCommandContext({
          recordingOwner: 'agent',
          ui: {
            addItem: commands.addItem,
            clear: commands.clearItems,
            loadHistory: commands.loadHistory,
          },
          services: { agent: next },
        }),
        actions: {} as never,
        addItem,
        addMessage: (message) => {
          addItem(
            convertMessageToHistoryItem(message),
            message.timestamp.getTime(),
          );
        },
        setIsProcessing: () => {},
        setLocalIsProcessing: () => {},
        setPendingItem: () => {},
        setSessionShellAllowlist: () => {},
        setConfirmationRequest: () => {},
        confirmationLogger: new DebugLogger('test-confirmation'),
        slashCommandLogger: new DebugLogger('test-slash'),
        beginSlashCommandAction: () => new AbortController(),
        endSlashCommandAction: () => {},
      };

      await processSlashCommand(deps, `/continue ${sourceId}`);

      const visible = turnStore.store
        .getState()
        .history.map((item) => ('text' in item ? item.text : item.type));
      expect(visible).toStrictEqual([
        'owner restored conversation',
        `Warning: Skipped unreadable session recording ${brokenPath}: ${EMPTY_FILE_REASON}`,
      ]);
    });
  });

  it('names the unreadable file when /continue references it directly', async () => {
    await withRecordingLifetimeFixture(async ({ borrow, chatsDir }) => {
      await mkdir(chatsDir, { recursive: true });
      const brokenPath = join(chatsDir, BROKEN_NAME);
      await writeFile(brokenPath, '', 'utf-8');
      const next = await borrow();
      const failure = await resumeOwnerSession(
        next,
        BROKEN_NAME,
        'allowed',
      ).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(
        `unreadable recording skipped: ${brokenPath}: ${EMPTY_FILE_REASON}`,
      );
    });
  });

  it('the session browser counts the skipped unreadable recording', async () => {
    await withRecordingLifetimeFixture(
      async ({ agent, borrow, chatsDir, config }) => {
        await agent.setHistory([human('browser healthy session')]);
        await agent.session.setRecording({ enabled: true });
        const sourceId = (await agent.session.listSessions()).at(0)?.id;
        if (!sourceId) throw new Error('Missing source session');
        await agent.session.setRecording({ enabled: false });
        await writeFile(join(chatsDir, BROKEN_NAME), '', 'utf-8');
        const next = await borrow();

        const browser = renderHook(() =>
          useSessionBrowser({
            chatsDir,
            projectHash: config.projectTempDir.split('/').at(-1) ?? '',
            currentSessionId: config.getSessionId(),
            ownerAgent: next,
            onSelect: async () => ({ ok: false, error: 'not selected' }),
            onClose: () => {},
          }),
        );
        await waitFor(() =>
          expect(browser.result.current.isLoading).toBe(false),
        );

        expect({
          listed: browser.result.current.sessions.map((row) => row.sessionId),
          skippedCount: browser.result.current.skippedCount,
        }).toStrictEqual({ listed: [sourceId], skippedCount: 1 });
        browser.unmount();
      },
    );
  });
});
