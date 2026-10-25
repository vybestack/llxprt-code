import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent } from '../createAgent.js';
import type { Agent } from '../agent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { createRecordingProvider } from './helpers/recording-provider.js';
import {
  recordedSkillDeclaration,
  recordedSkillNames,
  settleTurn,
} from './helpers/skill-declaration-reads.js';

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
      workspace: string;
      recording: ReturnType<typeof createRecordingProvider>;
    }) => Promise<void>,
  ): Promise<void> {
    const workspace = mkdtempSync(join(tmpdir(), 'llxprt-skill-reload-'));
    for (const name of initialSkills) {
      writeSkill(workspace, name);
    }
    // The storage-isolation preload points LLXPRT_AGENTS_HOME at a temp root,
    // so discovery never reads the real ~/.agents/skills here; the strict set
    // assertions only ever see this workspace's skills.
    const recording = createRecordingProvider();
    const agent = await createAgent({
      provider: recording.alias,
      model: 'recording-default',
      providerContributions: recording.contributions,
      credentialAuthority: callerCredentials().authority,
      skillsSupport: true,
      workingDir: workspace,
    });
    try {
      await settleTurn(agent);
      await run({ agent, workspace, recording });
    } finally {
      await agent.dispose();
      rmSync(workspace, { recursive: true, force: true });
    }
  }

  /**
   * No reload happens here. This is the startup path: `createAgent` installs
   * the registrar, `Config.initialize` discovers the skill and rebuilds the
   * tool, and the first turn hands the declaration to the chat session. Before
   * issue #3382 the public Agent API supplied no registrar, so this produced no
   * activate_skill tool at all.
   */
  it('offers a skill discovered at startup, with no reload @issue:3382', async () => {
    await withWorkspace(['alpha'], async ({ recording }) => {
      expect(recordedSkillNames(recording)).toStrictEqual(['alpha']);
    });
  });

  it('offers a skill added on disk after the session started', async () => {
    await withWorkspace(['alpha'], async ({ agent, workspace, recording }) => {
      expect(recordedSkillNames(recording)).toStrictEqual(['alpha']);

      writeSkill(workspace, 'beta');
      await agent.skills.reload();
      await settleTurn(agent);

      expect(recordedSkillNames(recording).sort()).toStrictEqual([
        'alpha',
        'beta',
      ]);
      expect(recordedSkillDeclaration(recording)?.description).toContain(
        "'beta'",
      );
    });
  });
});
