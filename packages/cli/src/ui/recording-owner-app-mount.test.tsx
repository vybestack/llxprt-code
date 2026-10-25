import { runtimeAppFixture } from '../__tests__/runtime-context-fixture.js';
import {
  useRecordingPrompts,
  withRecordingLifetimeFixture,
} from '../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createSessionModelCommand } from '../runtime/session-model-command.js';
import { readFile } from 'node:fs/promises';
import { coreEvents } from '@vybestack/llxprt-code-core';

import { afterEach as afterFixtureTest, describe, expect, it } from 'bun:test';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import {
  createMockSettings,
  renderWithProviders,
  waitFor,
} from '../__tests__/render.js';
import { buildUiRuntimeFromSource } from './cliUiRuntime.js';
import { buildSlashCommandRuntimeForTest } from '../__tests__/slash-command-runtime-fixture.js';
import { AppWrapper } from './App.js';
import { AppContainer } from './AppContainer.js';
import { appContainerBoundAgentProps } from './__tests__/app-bootstrap-owner-props.js';
import {
  createCommandRegistrationFixture,
  createCommandRegistryFixture,
} from '../__tests__/command-registry-fixture.js';
import {
  createUnconfiguredCredentialRegistry,
  createUnconfiguredHistoryReaders,
} from '../__tests__/unconfigured-model-command.js';
import { initialAppState } from './reducers/appReducer.js';
import { SessionStatsProvider } from './contexts/SessionContext.js';
import { TodoProvider } from './contexts/TodoProvider.js';
import { OAuthControlProvider } from './contexts/OAuthControlContext.js';
import { ProviderAliasRefreshProvider } from './contexts/ProviderAliasRefreshContext.js';
import { OverflowProvider } from './contexts/OverflowContext.js';
import { ScrollProvider } from './contexts/ScrollProvider.js';
import { AppDispatchProvider } from './contexts/AppDispatchContext.js';
import { createRuntimeOwnerFeatures } from '../__tests__/runtime-owner-features-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const makeFixtureFilesystem = installTestWorkspaceFilesystem();
let fixtureFilesystem: ReturnType<typeof makeFixtureFilesystem> | undefined;
function fixturePaths() {
  fixtureFilesystem ??= makeFixtureFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return fixtureFilesystem.paths;
}

describe('interactive Agent owner AppWrapper', () => {
  useRecordingPrompts();
  afterFixtureTest(() => {
    fixtureFilesystem = undefined;
  });
  it('renders resumed history and handles slash input using named capabilities without an Agent prop', async () => {
    await withRecordingLifetimeFixture(
      async (
        agent,
        config,
        settingsOwner,
        _settings,
        _oauth,
        _borrow,
        _chats,
        _history,
        resources,
      ) => {
        const settings = createMockSettings({ ui: { theme: 'Default' } });
        const runtime = runtimeAppFixture(
          agent,
          createRuntimeOwnerFeatures(
            agent.providerReads.inspection,
            fixturePaths().directories,
            createSessionModelCommand(agent),
            settingsOwner,
            agent.workspace,
            agent.modelParameters,
            agent.settings,
            agent.toolFormat,
            agent.providerReads,
            agent.auth.keys,
            () => agent.providerReads.readOpenAIInfo(),
          ),
          agent.sessionClient.fetch,
        );
        const view = renderWithProviders(
          <ScrollProvider>
            <SessionStatsProvider metrics={agent.metrics}>
              <TodoProvider sessionId={agent.session.getSessionId()}>
                {runtime.renderRuntime(
                  <OAuthControlProvider control={agent.authentication}>
                    <ProviderAliasRefreshProvider
                      refresh={() => agent.providerReads.refreshAliases()}
                    >
                      <OverflowProvider>
                        <AppDispatchProvider value={() => {}}>
                          <AppContainer
                            {...appContainerBoundAgentProps(agent)}
                            {...createCommandRegistryFixture(null)}
                            {...createCommandRegistrationFixture(agent)}
                            registerCredentials={() =>
                              createUnconfiguredCredentialRegistry()
                            }
                            historyReads={createUnconfiguredHistoryReaders()}
                            uiRuntime={buildUiRuntimeFromSource(
                              config,
                              agent,
                              undefined,
                              settingsOwner,
                            )}
                            slashCommandRuntime={buildSlashCommandRuntimeForTest(
                              config,
                              agent,
                              undefined,
                              undefined,
                              undefined,
                              undefined,
                              undefined,
                              settingsOwner,
                            )}
                            readAgentRecordingPath={() =>
                              agent.session.getRecording().path
                            }
                            generateSubagentPrompt={async () => ''}
                            settings={settings}
                            version="test-capabilities"
                            recordingOwner="agent"
                            suppressStartupWelcome
                            resumedHistory={[
                              {
                                speaker: 'human',
                                blocks: [
                                  {
                                    type: 'text',
                                    text: 'Resumed capability history',
                                  },
                                ],
                              },
                            ]}
                            appState={initialAppState}
                            appDispatch={() => {}}
                          />
                        </AppDispatchProvider>
                      </OverflowProvider>
                    </ProviderAliasRefreshProvider>
                  </OAuthControlProvider>,
                )}
              </TodoProvider>
            </SessionStatsProvider>
          </ScrollProvider>,
          { settings },
        );
        try {
          await waitFor(() =>
            expect(view.frames.join()).toContain('Resumed capability history'),
          );
          await waitFor(() =>
            expect(view.lastFrame()).toContain('Type your message'),
          );
          view.stdin.write('/help');
          await waitFor(() => expect(view.lastFrame()).toMatch(/>\s*\/help/));
          view.stdin.write('\r');
          await waitFor(
            () =>
              expect(view.lastFrame()).toContain('Ctrl+C - Quit application'),
            { timeout: 5000 },
          );
          expect(view.lastFrame()).toContain('Enter - Send message');
          await resources.client.startChat([
            {
              speaker: 'human',
              blocks: [
                { type: 'text', text: 'live composition history '.repeat(500) },
              ],
            },
          ]);
          const liveHistory = resources.client.getHistoryService();
          if (liveHistory === null)
            throw new Error('Missing live composition history');
          await liveHistory.waitForTokenUpdates();
          await waitFor(() =>
            expect(view.lastFrame()).toContain(
              `${(liveHistory.getTotalTokens() / 1000).toFixed(1)}k/`,
            ),
          );
        } finally {
          view.unmount();
        }
      },
    );
  }, 30000);
  it('mounts with no raw recording integration, recording service or lock', async () => {
    await withRecordingLifetimeFixture(
      async (
        agent,
        config,
        settingsOwner,
        _settings,
        _oauth,
        _borrow,
        _chats,
        _history,
        _resources,
      ) => {
        await agent.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'owner mount' }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        coreEvents.emitFeedback('warning', 'captured App bootstrap feedback');
        const settings = createMockSettings({ ui: { theme: 'Default' } });
        const view = renderWithProviders(
          <AppWrapper
            uiRuntime={buildUiRuntimeFromSource(
              config,
              agent,
              undefined,
              settingsOwner,
            )}
            slashCommandRuntime={buildSlashCommandRuntimeForTest(
              config,
              agent,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              settingsOwner,
            )}
            agent={agent}
            {...runtimeAppFixture(
              agent,
              createRuntimeOwnerFeatures(
                agent.providerReads.inspection,
                fixturePaths().directories,
                createSessionModelCommand(agent),
                settingsOwner,
                agent.workspace,
                agent.modelParameters,
                agent.settings,
                agent.toolFormat,
                agent.providerReads,
                agent.auth.keys,
                () => agent.providerReads.readOpenAIInfo(),
              ),
              agent.sessionClient.fetch,
            )}
            providerAliasRefresh={() => agent.providerReads.refreshAliases()}
            oauthControl={agent.authentication}
            settings={settings}
            version="test-owner"
            recordingOwner="agent"
          />,
          { settings },
        );
        expect(view.lastFrame()).toBeDefined();
        const recordingPath = agent.session.getRecording().path;
        if (!recordingPath) throw new Error('Missing app recording path');
        await waitFor(async () =>
          expect(await readFile(recordingPath, 'utf8')).toContain(
            'captured App bootstrap feedback',
          ),
        );
        view.unmount();
        expect(agent.session.getRecording().enabled).toBe(true);
      },
    );
  }, 30000);
});
