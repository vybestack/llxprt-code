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
import { modelVisibleSkillNames } from './helpers/skills-fixture-declarations.js';

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

describe('workspace skill root lifetime @issue:2615', () => {
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

  const builtCredentials = useOwnedCredentials();

  it('keeps same-project same-label workspace catalogues and policy independent', async () => {
    await withWorkspace(
      ['alpha'],
      async ({ agent: first, config, workspace }) => {
        const second = await buildAgent('plain-text.jsonl', {
          skillsSupport: true,
          workingDir: workspace,
          sessionId: config.getSessionId(),
        });
        try {
          await settle(second.agent);
          config.setDisabledSkills(['alpha']);
          expect(first.skills.list()).toStrictEqual([]);
          expect(
            second.agent.skills.list().map((skill) => skill.name),
          ).toStrictEqual(['alpha']);
          writeSkill(workspace, 'beta');
          await first.skills.reload();
          expect(modelVisibleSkillNames(first)).toStrictEqual(['beta']);
          expect(modelVisibleSkillNames(second.agent)).toStrictEqual(['alpha']);
          await first.dispose();
          await second.agent.skills.reload();
          expect(modelVisibleSkillNames(second.agent).sort()).toStrictEqual([
            'alpha',
            'beta',
          ]);
        } finally {
          await second.cleanup();
        }
      },
    );
  });

  it('keeps caller Config identity and skills alive after borrowed facade disposal', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'borrowed-workspace-skills-'));
    writeSkill(workspace, 'alpha');

    const {
      config: builtCallerConfig,
      settings: builtCallerSettings,
      settingsOwner: builtCallerSettingsOwner,
      manager: builtCallerManager,
      mcp: builtCallerMcp,
      close: builtCallerClose,
      client: builtCallerClient,
    } = await openSkillsCaller({
      fixture: new URL('./fixtures/plain-text.jsonl', import.meta.url),
      authority: builtCredentials().authority,
      overrides: {
        skillsSupport: true,
        workingDir: workspace,
      },
      operations: undefined,
    });

    let agent: Agent | undefined;
    try {
      agent = await fromConfig(
        builtCallerConfig,
        builtCallerSettings,
        {},
        builtCallerSettingsOwner,
        builtCallerManager,
        undefined,
        undefined,
        builtCallerMcp,
        undefined,
        builtCallerClient,
      );
      expect(internalConfig(agent)).toBe(builtCallerConfig);
      await settle(agent);
      await agent.dispose();
      writeSkill(workspace, 'beta');
      await builtCallerMcp.workspaceSkills.operations.reload();
      expect(
        builtCallerMcp.workspaceSkills.operations
          .list()
          .map((skill) => skill.name)
          .sort(),
      ).toStrictEqual(['alpha', 'beta']);
      expect('skillManager' in builtCallerConfig).toBe(false);
    } finally {
      await agent?.dispose();
      await builtCallerClose();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
