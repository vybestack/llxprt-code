/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { runtimeAppFixture } from '../__tests__/runtime-context-fixture.js';
import { createSessionModelCommand } from '../runtime/session-model-command.js';
import { readFile } from 'node:fs/promises';
import { coreEvents } from '@vybestack/llxprt-code-core';

import { afterEach as afterFixtureTest, describe, expect, it } from 'bun:test';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
const makeFixtureFilesystem = installTestWorkspaceFilesystem();
let fixtureFilesystem: ReturnType<typeof makeFixtureFilesystem> | undefined;
function fixturePaths() {
  fixtureFilesystem ??= makeFixtureFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return fixtureFilesystem.paths;
}

import { withRecordingLifetimeFixture } from '../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import {
  createMockSettings,
  renderWithProviders,
  waitFor,
} from '../__tests__/render.js';
import {
  buildSlashCommandRuntime,
  buildUiRuntimeFromSource,
} from './cliUiRuntime.js';
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
import { createProviderAliasRefresh } from '../runtime/createRuntimeOwnerFeatures.js';
import { createOAuthControl } from '../runtime/createOAuthControl.js';

describe('interactive Agent owner AppWrapper', () => {
  afterFixtureTest(() => {
    fixtureFilesystem = undefined;
  });
  it('renders resumed history and handles slash input using named capabilities without an Agent prop', async () => {
    await withRecordingLifetimeFixture(
      async ({
        agent,
        config,
        settingsOwner,
        settingsService,
        oauthManager,
      }) => {
        const settings = createMockSettings({ ui: { theme: 'Default' } });
        const runtime = runtimeAppFixture(
          agent,
          createRuntimeOwnerFeatures(
            config,
            agent.providerManager,
            fixturePaths().directories,
            createSessionModelCommand(agent),
            settingsOwner,
            settingsService,
            agent.workspace,
            agent.modelParameters,
            agent.settings,
            agent.toolFormat,
            agent.providerReads,
            agent.auth.keys,
          ),
          agent.sessionClient.fetch,
        );
        const view = renderWithProviders(
          <ScrollProvider>
            <SessionStatsProvider metrics={agent.metrics}>
              <TodoProvider sessionId={agent.session.getSessionId()}>
                {runtime.renderRuntime(
                  <OAuthControlProvider
                    control={createOAuthControl(
                      () => oauthManager,
                      agent.providerManager,
                    )}
                  >
                    <ProviderAliasRefreshProvider
                      refresh={createProviderAliasRefresh(
                        agent.providerManager,
                      )}
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
                            slashCommandRuntime={buildSlashCommandRuntime(
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
        } finally {
          view.unmount();
        }
      },
    );
  }, 30000);
  it('mounts with no raw recording integration, recording service or lock', async () => {
    await withRecordingLifetimeFixture(
      async ({
        agent,
        config,
        settingsOwner,
        settingsService,
        oauthManager,
      }) => {
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
            slashCommandRuntime={buildSlashCommandRuntime(
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
                config,
                agent.providerManager,
                fixturePaths().directories,
                createSessionModelCommand(agent),
                settingsOwner,
                settingsService,
                agent.workspace,
                agent.modelParameters,
                agent.settings,
                agent.toolFormat,
                agent.providerReads,
                agent.auth.keys,
              ),
              agent.sessionClient.fetch,
            )}
            providerAliasRefresh={createProviderAliasRefresh(
              agent.providerManager,
            )}
            oauthControl={createOAuthControl(
              () => oauthManager,
              agent.providerManager,
            )}
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
