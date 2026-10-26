import { runtimeAppFixture } from '../__tests__/runtime-context-fixture.js';
import { useFakeResponsesReplay } from '../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { runCleanupSteps } from '../../../agents/src/core/subagent-cleanup.js';
import { openBridgeRoot } from '../__tests__/runtime-owner-bridge-route-b-root-fixture.js';
import { createSessionModelCommand } from '../runtime/session-model-command.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coreEvents } from '@vybestack/llxprt-code-core';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';

import {
  afterAll,
  afterEach as afterFixtureTest,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import {
  createMockSettings,
  renderWithProviders,
  waitFor,
} from '../__tests__/render.js';
import { buildUiRuntimeFromSource } from './cliUiRuntime.js';
import {
  buildAppContainerPortsForTest,
  buildUiPortsForTest,
} from '../__tests__/slash-command-runtime-fixture.js';
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

async function openMountedAgent(
  authority: ReturnType<ReturnType<typeof useOwnedCredentials>>['authority'],
  closers: Array<() => Promise<void>>,
) {
  const root = await openBridgeRoot({
    authority,
    label: `app-mount-${closers.length}`,
  });
  closers.push(root.close, async () => {
    if (root.agent.session.getRecording().enabled)
      await root.agent.session.setRecording({ enabled: false });
    await root.agent.dispose();
  });
  return root;
}

describe('interactive Agent owner AppWrapper', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'recording-mount-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  const credentials = useOwnedCredentials();
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const closers: Array<() => Promise<void>> = [];
  afterFixtureTest(async () => {
    fixtureFilesystem = undefined;
    await runCleanupSteps(closers.splice(0).reverse());
  });
  it('renders resumed history and handles slash input using named capabilities without an Agent prop', async () => {
    const { agent, config, settingsOwner } = await openMountedAgent(
      credentials().authority,
      closers,
    );
    const publishedTokens: number[] = [];
    const stopTokens = agent.session.subscribeHistoryTokens((count) =>
      publishedTokens.push(count),
    );
    closers.push(async () => stopTokens());
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
                        {...buildAppContainerPortsForTest(
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
        () => expect(view.lastFrame()).toContain('Ctrl+C - Quit application'),
        { timeout: 5000 },
      );
      expect(view.lastFrame()).toContain('Enter - Send message');
      await agent.chat('live composition history '.repeat(500));
      await waitFor(
        () => expect(publishedTokens.at(-1) ?? 0).toBeGreaterThan(0),
        { timeout: 5000 },
      );
      await waitFor(() =>
        expect(view.lastFrame()).toContain(
          `${((publishedTokens.at(-1) ?? 0) / 1000).toFixed(1)}k/`,
        ),
      );
    } finally {
      view.unmount();
    }
  }, 30000);
  it('mounts with no raw recording integration, recording service or lock', async () => {
    const { agent, config, settingsOwner } = await openMountedAgent(
      credentials().authority,
      closers,
    );
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
        {...buildUiPortsForTest(
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
  }, 30000);
});
