import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent } from '../createAgent.js';
import type { Agent } from '../agent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { createRecordingProvider } from './helpers/recording-provider.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';
import {
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
      recording: ReturnType<typeof createRecordingProvider>;
    }) => Promise<void>,
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
      agent = await route.createAgent({
        provider: recording.alias,
        model: 'recording-default',
      });
      await settleTurn(agent);
      await run({
        agent,
        config: route.config,
        workspace: route.directory,
        recording,
      });
    } finally {
      await agent?.dispose();
      await route.close();
    }
  }

  it('keeps same-project same-label workspace catalogues and policy independent', async () => {
    await withWorkspace(
      ['alpha'],
      async ({
        agent: first,
        config,
        workspace,
        recording: firstRecording,
      }) => {
        const secondRecording = createRecordingProvider();
        const second = await createAgent({
          provider: secondRecording.alias,
          model: 'recording-default',
          providerContributions: secondRecording.contributions,
          credentialAuthority: callerCredentials().authority,
          skillsSupport: true,
          workingDir: workspace,
          sessionId: config.getSessionId(),
        });
        try {
          await settleTurn(second);
          config.setDisabledSkills(['alpha']);
          expect(first.skills.list()).toStrictEqual([]);
          expect(second.skills.list().map((skill) => skill.name)).toStrictEqual(
            ['alpha'],
          );
          writeSkill(workspace, 'beta');
          await first.skills.reload();
          await settleTurn(first);
          await settleTurn(second);
          expect(recordedSkillNames(firstRecording)).toStrictEqual(['beta']);
          expect(recordedSkillNames(secondRecording)).toStrictEqual(['alpha']);
          await first.dispose();
          await second.skills.reload();
          await settleTurn(second);
          expect(recordedSkillNames(secondRecording).sort()).toStrictEqual([
            'alpha',
            'beta',
          ]);
        } finally {
          await second.dispose();
        }
      },
    );
  });
});
