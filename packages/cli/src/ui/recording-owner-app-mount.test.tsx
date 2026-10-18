import {
  useRecordingPrompts,
  withRecordingLifetimeFixture,
} from '../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createSessionModelCommand } from '../runtime/session-model-command.js';
import { afterEach as afterFixtureTest, describe, expect, it } from 'bun:test';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import {
  createMockSettings,
  renderWithProviders,
} from '../__tests__/render.js';
import {
  buildSlashCommandRuntime,
  buildUiRuntimeFromSource,
} from './cliUiRuntime.js';
import { AppWrapper } from './App.js';
import { createRuntimeOwnerFeatures } from '../runtime/createRuntimeOwnerFeatures.js';

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
  it('mounts with no raw recording integration, recording service or lock', async () => {
    await withRecordingLifetimeFixture(async (agent, config, settingsOwner) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'owner mount' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const settings = createMockSettings({});
      const view = renderWithProviders(
        <AppWrapper
          uiRuntime={buildUiRuntimeFromSource(config, agent)}
          slashCommandRuntime={buildSlashCommandRuntime(config, agent)}
          agent={agent}
          runtimeOwner={{
            create: () =>
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
          }}
          providerAliasRefresh={() => agent.providerReads.refreshAliases()}
          oauthControl={agent.authentication}
          settings={settings}
          version="test-owner"
          recordingOwner="agent"
        />,
        { settings },
      );
      expect(view.lastFrame()).toBeDefined();
      view.unmount();
      expect(agent.session.getRecording().enabled).toBe(true);
    });
  }, 30000);
});
