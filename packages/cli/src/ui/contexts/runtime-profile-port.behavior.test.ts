import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from '../../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from '../../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import { cleanupAfterFailure } from '../../../../agents/src/core/subagent-cleanup.js';
import { createSessionModelCommand } from '../../runtime/session-model-command.js';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';

import { createRuntimeOwnerFeatures } from '../../__tests__/runtime-owner-features-fixture.js';
import { createRuntimeApi } from '../../__tests__/runtime-context-fixture.js';
import { projectRuntimeAgent } from '../../__tests__/runtime-profile-agent-fixture.js';

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

interface ProfileRoot {
  readonly settingsOwner: SessionSettingsOwner;
  readonly agent: Agent;
  readonly close: () => Promise<void>;
}

async function openProfileRoot(
  authority: RouteBPreflight['authority'],
): Promise<ProfileRoot> {
  const route = await openRouteBPreflight({
    authority,
    config: { interactive: true, includeDirectories: [process.cwd()] },
  });
  const settingsOwner = new SessionSettingsOwner(route.settings);
  const close = async (): Promise<void> => {
    try {
      await route.close();
    } finally {
      await settingsOwner.dispose();
    }
  };
  try {
    for (const [key, value] of Object.entries(
      route.config.getInitialSettings(),
    ))
      route.settings.set(key, value);
    settingsOwner.initializeProviderSelection(
      route.config.getProvider(),
      route.config.getModel(),
    );
    await route.prepare({ settingsOwner });
    const agent = await route.createAgent();
    return { settingsOwner, agent, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}

describe('CLI profile operation projection', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  useFakeResponsesReplay('plain-text.jsonl');

  const ownerCredentials = useOwnedCredentials();

  it('retains live provider/model settings while excluding root lifecycle and service containers', async () => {
    const root = await openProfileRoot(ownerCredentials().authority);
    const { agent } = root;
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
          agent.providerReads.inspection,
          fixturePaths().directories,
          createSessionModelCommand(agent),
          root.settingsOwner,
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
      await root.close();
    }
  });
});
