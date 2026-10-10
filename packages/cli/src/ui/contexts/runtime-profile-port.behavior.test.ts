/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createSessionModelCommand } from '../../runtime/session-model-command.js';

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

import { fromConfig } from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from '../../../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { createRuntimeOwnerFeatures } from '../../runtime/createRuntimeOwnerFeatures.js';
import { createRuntimeApi } from './RuntimeContext.js';
import { projectRuntimeAgent } from './runtimeProfileAgent.js';

describe('CLI profile operation projection', () => {
  afterFixtureTest(() => {
    fixtureFilesystem = undefined;
  });
  it('retains live provider/model settings while excluding root lifecycle and service containers', async () => {
    const owner = await buildCliStyleConfig('plain-text.jsonl');
    const agent = await fromConfig({
      settingsService: owner.settingsService,
      settingsOwner: owner.settingsOwner,
      config: owner.config,
      providerManager: owner.providerManager,
      messageBus: owner.messageBus,
      mcpRuntime: owner.mcpRuntime,
    });
    try {
      const port = projectRuntimeAgent(agent);
      expect(
        ['providerManager', 'agentClient', 'sessionClient', 'dispose'].filter(
          (key) => key in port,
        ),
      ).toStrictEqual([]);
      const api = createRuntimeApi(
        port,
        createRuntimeOwnerFeatures(
          owner.config,
          owner.providerManager,
          fixturePaths().directories,
          createSessionModelCommand(agent),
          owner.settingsOwner,
          owner.settingsService,
          agent.workspace,
        ),
      );
      api.setEphemeralSetting('context-limit', 8192);
      expect(agent.getEphemeralSetting('context-limit')).toBe(8192);
      await api.setActiveModel('replacement-model');
      expect(api.getRuntimeDiagnosticsSnapshot().modelName).toBe(
        'replacement-model',
      );
      const response = await agent.chat('Use the retained provider');
      expect(response.text).toContain('a plain text reply');
    } finally {
      await agent.dispose();
      await owner.cleanup();
    }
  });
});
