import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerActivateSkillTool } from '../../skill-tool-registrar.js';
import { type Agent } from './helpers/agentHarness.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { recordedModelVisibleSkillNames } from './helpers/recorded-skill-declarations.js';
import { createRecordingProvider } from './helpers/recording-provider.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

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
 * Drives one turn so the provider receives the tool list the session holds
 * now, which is the state a reload has to update. The registrar is already
 * installed by `createAgent`; nothing here supplies it.
 */
async function settle(agent: Agent): Promise<void> {
  for await (const _event of agent.stream('hello')) {
    // Drain the turn so the provider records the request.
  }
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
      modelVisibleSkillNames: () => Promise<string[]>;
    }) => Promise<void>,
    operations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    // The storage-isolation preload points LLXPRT_AGENTS_HOME at a temp root,
    // so discovery never reads the real ~/.agents/skills here; the strict set
    // assertions only ever see this workspace's skills.
    const recording = createRecordingProvider();
    const route = await openRouteBPreflight({
      authority: callerCredentials().authority,
      contributions: recording.contributions,
      config: {
        provider: recording.alias,
        model: 'recording-default',
        skillsSupport: true,
      },
    });
    let agent: Agent | undefined;
    try {
      for (const name of initialSkills) {
        writeSkill(route.directory, name);
      }
      await route.prepare();
      agent = await route.createAgent(
        { provider: recording.alias, model: 'recording-default' },
        operations === undefined
          ? {}
          : {
              skillPolicy: operations.reloadPolicy,
              registerSkillTools: operations.registerTools,
            },
      );
      const live = agent;
      await settle(live);
      await run({
        agent: live,
        config: route.config,
        workspace: route.directory,
        modelVisibleSkillNames: async () => {
          await settle(live);
          return recordedModelVisibleSkillNames(recording.requests);
        },
      });
    } finally {
      await agent?.dispose();
      await route.close();
    }
  }

  it('discovers and publishes skills without a Config skill runtime', async () => {
    await withWorkspace(
      ['alpha'],
      async ({ agent, config, workspace, modelVisibleSkillNames }) => {
        expect('skillManager' in config).toBe(false);
        expect('getSkillManager' in config).toBe(false);
        expect('reloadSkills' in config).toBe(false);
        expect('refreshSkills' in config).toBe(false);
        writeSkill(workspace, 'beta');
        await agent.skills.reload();
        expect((await modelVisibleSkillNames()).sort()).toStrictEqual([
          'alpha',
          'beta',
        ]);
      },
    );
  });

  it('retains published skills when a reload cannot rebuild the activation tool', async () => {
    let failRegistration = false;
    await withWorkspace(
      ['alpha'],
      async ({ agent, workspace, modelVisibleSkillNames }) => {
        failRegistration = true;
        writeSkill(workspace, 'beta');
        await expect(agent.skills.reload()).rejects.toThrow(
          'registration failed',
        );
        expect(agent.skills.list().map((skill) => skill.name)).toStrictEqual([
          'alpha',
        ]);
        expect(await modelVisibleSkillNames()).toStrictEqual(['alpha']);
        failRegistration = false;
        await agent.skills.reload();
        expect((await modelVisibleSkillNames()).sort()).toStrictEqual([
          'alpha',
          'beta',
        ]);
      },
      {
        reloadPolicy: async () => ({}),
        registerTools: (...args) => {
          if (failRegistration) throw new Error('registration failed');
          registerActivateSkillTool(...args);
        },
      },
    );
  });
});
