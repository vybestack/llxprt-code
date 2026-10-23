import { openSkillsCaller } from './helpers/skills-fixture-caller.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import {
  buildAgent,
  internalConfig,
  type Agent,
} from './helpers/agentHarness.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { activateSkillDeclaration } from './helpers/skills-fixture-declarations.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end coverage for issue #3379.
 *
 * `/skills reload` used to refresh SkillManager and stop there, so a skill
 * added on disk never reached the model. The model learns which skills exist
 * from exactly one place: the `activate_skill` declaration carried in the tool
 * list that ChatSession hands to the provider on every request. These tests
 * therefore assert on that declaration rather than on which functions were
 * called.
 *
 * The whole production chain runs for real, with nothing supplied by the test:
 * skill files on disk, the real SkillManager, the registrar `createAgent`
 * installs, the real ActivateSkillTool, a real ToolRegistry, the real
 * AgentClient.setTools(), and the real ChatSession.
 *
 * This file used to install the registrar itself, because `createAgent` did not
 * (issue #3382). Now that it does, these cases also cover that wiring: removing
 * it from `createAgent` fails every test here.
 */

function writeSkill(workspace: string, name: string): void {
  const skillDir = join(workspace, '.llxprt', 'skills', name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: The ${name} skill\n---\n\n${name} instructions\n`,
    'utf-8',
  );
}

function removeSkill(workspace: string, name: string): void {
  rmSync(join(workspace, '.llxprt', 'skills', name), {
    recursive: true,
    force: true,
  });
}

/**
 * Drives one turn so a live chat session exists with a tool list, which is the
 * state a reload has to update. The registrar is already installed by
 * `createAgent`; nothing here supplies it.
 */
async function settle(agent: Agent): Promise<Config> {
  for await (const _event of agent.stream('hello')) {
    // Drain the turn so the chat session and its tool list exist.
  }
  return internalConfig(agent);
}

describe('skill reload reaches the model @issue:3379', () => {
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
  const callerCredentials = useOwnedCredentials();
  async function withWorkspace(
    initialSkills: string[],
    run: (ctx: {
      agent: Agent;
      config: Config;
      workspace: string;
    }) => Promise<void>,
    operations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    const workspace = mkdtempSync(join(tmpdir(), 'llxprt-skill-reload-'));
    for (const name of initialSkills) {
      writeSkill(workspace, name);
    }
    // The storage-isolation preload points LLXPRT_AGENTS_HOME at a temp root,
    // so discovery never reads the real ~/.agents/skills here; the strict set
    // assertions only ever see this workspace's skills.
    let agent: Agent;
    let cleanup: () => Promise<void>;
    if (operations === undefined) {
      const owned = await buildAgent('plain-text.jsonl', {
        skillsSupport: true,
        workingDir: workspace,
      });
      agent = owned.agent;
      cleanup = owned.cleanup;
    } else {
      const {
        config: callerCallerConfig,
        settings: callerCallerSettings,
        settingsOwner: callerCallerSettingsOwner,
        manager: callerCallerManager,
        mcp: callerCallerMcp,
        close: callerCallerClose,
        client: callerCallerClient,
      } = await openSkillsCaller({
        fixture: new URL('./fixtures/plain-text.jsonl', import.meta.url),
        authority: callerCredentials().authority,
        overrides: {
          skillsSupport: true,
          workingDir: workspace,
        },
        operations,
      });

      agent = await fromConfig(
        callerCallerConfig,
        callerCallerSettings,
        {},
        callerCallerSettingsOwner,
        callerCallerManager,
        undefined,
        undefined,
        callerCallerMcp,
        undefined,
        callerCallerClient,
      );
      cleanup = callerCallerClose;
    }
    try {
      const config = await settle(agent);
      await run({ agent, config, workspace });
    } finally {
      await agent.dispose();
      await cleanup();
      rmSync(workspace, { recursive: true, force: true });
    }
  }

  it('withdraws the tool once the last skill goes away', async () => {
    await withWorkspace(['alpha'], async ({ agent, workspace }) => {
      expect(activateSkillDeclaration(agent)).toBeDefined();

      removeSkill(workspace, 'alpha');
      await agent.skills.reload();

      expect(activateSkillDeclaration(agent)).toBeUndefined();
    });
  });
});
