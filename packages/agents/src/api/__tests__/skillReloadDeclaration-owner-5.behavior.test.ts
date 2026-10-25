import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openSkillsOwner } from './helpers/skills-owner-session.js';
import { clientModelVisibleSkillNames } from './helpers/skills-fixture-declarations.js';

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

  useFakeResponsesReplay('plain-text.jsonl');
  const builtCredentials = useOwnedCredentials();

  it('publishes actual extension skills on load, restart and exact unload', async () => {
    const workspace = mkdtempSync(
      join(tmpdir(), 'extension-workspace-skills-'),
    );
    writeSkill(workspace, 'native');

    const { mcp, client, skills, close } = await openSkillsOwner({
      authority: builtCredentials().authority,
      overrides: {
        skillsSupport: true,
        workingDir: workspace,
      },
      parameters: { enableExtensionReloading: true },
    });

    try {
      const loader = mcp.extensionOperations;
      const extension = {
        name: 'skill-pack',
        version: '1',
        isActive: true,
        path: workspace,
        contextFiles: [],
        skills: [
          {
            name: 'extension-skill',
            description: 'Extension instructions',
            body: 'Actual extension body',
            location: join(workspace, 'SKILL.md'),
          },
        ],
      };
      await loader.load(extension);
      expect(clientModelVisibleSkillNames(client).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
      await loader.restart(extension);
      expect(clientModelVisibleSkillNames(client).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
      await loader.unload(extension);
      expect(clientModelVisibleSkillNames(client)).toStrictEqual(['native']);
      expect(skills.get('extension-skill')).toBeUndefined();
    } finally {
      await close();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
