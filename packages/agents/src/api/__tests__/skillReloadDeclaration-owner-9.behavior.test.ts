import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerActivateSkillTool } from '../../skill-tool-registrar.js';
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

describe('workspace skill required publication ports', () => {
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

  it('rejects an enabled reload without its registrar instead of silently publishing stale declarations', async () => {
    let missingRegistrar = false;
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
    writeSkill(route.directory, 'alpha');
    try {
      await route.prepare();
      const agent = await route.createAgent(
        { provider: recording.alias, model: 'recording-default' },
        {
          skillPolicy: async () => ({}),
          registerSkillTools: (...args) => {
            if (missingRegistrar)
              throw new Error('Missing workspace skill registrar');
            registerActivateSkillTool(...args);
          },
        },
      );
      try {
        await settleTurn(agent);
        missingRegistrar = true;
        writeSkill(route.directory, 'beta');
        try {
          await expect(agent.skills.reload()).rejects.toThrow(
            'Missing workspace skill registrar',
          );
          await settleTurn(agent);
          expect(recordedSkillNames(recording)).toStrictEqual(['alpha']);
          expect(agent.skills.list().map((skill) => skill.name)).toStrictEqual([
            'alpha',
          ]);
        } finally {
          missingRegistrar = false;
        }
      } finally {
        await agent.dispose();
      }
    } finally {
      await route.close();
    }
  });
});
