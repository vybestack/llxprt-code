import {
  useRecordingPrompts,
  withRecordingLifetimeFixture,
} from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { bindFixtureOwnerResume } from '../../__tests__/command-history-result-fixture.js';
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';
import { createDeps } from './slash-command-handler-deps-test-helpers.js';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { CommandKind } from '../commands/types.js';
import { processSlashCommand } from './slashCommandHandlers.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const composeFixtureRuntime = installWorkspaceRuntimeFixture();

const performResumeMock = vi.fn();

describe('recording owner slash command construction', () => {
  useRecordingPrompts();

  beforeEach(() => {
    performResumeMock.mockReset();
  });

  /**
   * Wires the REAL cancellation registry into the handler deps so the tests
   * exercise the same begin/cancel/end contract the app uses.
   */
  it('routes /continue through a real Agent owner without raw swap callbacks', async () => {
    await withRecordingLifetimeFixture(
      async (
        agent,
        config,
        _settingsOwner,
        _settingsService,
        _oauthManager,
        borrow,
      ) => {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'slash replay' }],
          },
        ]);
        await agent.session.setRecording({ enabled: true });
        const sourceId = (await agent.session.listSessions()).at(0)?.id;
        if (!sourceId) throw new Error('Missing source');
        await agent.session.setRecording({ enabled: false });
        const next = await borrow();
        await next.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'current live owner' }],
          },
        ]);
        await next.session.setRecording({ enabled: true });
        const deps = createDeps(vi.fn());
        deps.config = composeFixtureRuntime(config);
        deps.commandContext.services.agent = next;
        deps.commandContext.recordingOwner = 'agent';
        let loaded:
          | Parameters<CommandOwnerFixture['ui']['loadHistory']>[0]
          | undefined;
        deps.commandContext.ui.loadHistory = (history) => {
          loaded = history;
        };
        deps.commands = [
          {
            name: 'continue',
            description: 'Continue session',
            kind: CommandKind.BUILT_IN,
            action: async () => ({
              type: 'perform_resume',
              sessionRef: sourceId,
            }),
          },
        ];
        deps.resumeOwnedSession = bindFixtureOwnerResume(
          deps.commandContext,
          deps.config,
        );
        await processSlashCommand(deps, `/continue ${sourceId}`);
        expect(
          loaded?.some(
            (item) => item.type === 'user' && item.text === 'slash replay',
          ),
        ).toBe(true);
        expect(next.session.getRecording().enabled).toBe(true);
      },
    );
  }, 30000);
});
