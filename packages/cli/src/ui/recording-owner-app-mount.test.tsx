/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createSessionModelCommand } from '../runtime/session-model-command.js';

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
} from '../__tests__/render.js';
import {
  buildSlashCommandRuntime,
  buildUiRuntimeFromSource,
} from './cliUiRuntime.js';
import { AppWrapper } from './App.js';
import {
  createRuntimeOwnerFeatures,
  createProviderAliasRefresh,
} from '../runtime/createRuntimeOwnerFeatures.js';
import { createOAuthControl } from '../runtime/createOAuthControl.js';

describe('interactive Agent owner AppWrapper', () => {
  afterFixtureTest(() => {
    fixtureFilesystem = undefined;
  });
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
        const settings = createMockSettings({});
        const view = renderWithProviders(
          <AppWrapper
            uiRuntime={buildUiRuntimeFromSource(config, agent)}
            slashCommandRuntime={buildSlashCommandRuntime(config, agent)}
            agent={agent}
            runtimeOwner={{
              create: () =>
                createRuntimeOwnerFeatures(
                  config,
                  agent.providerManager,
                  fixturePaths().directories,
                  createSessionModelCommand(agent),
                  settingsOwner,
                  settingsService,
                  agent.workspace,
                ),
            }}
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
        view.unmount();
        expect(agent.session.getRecording().enabled).toBe(true);
      },
    );
  }, 30000);
});
