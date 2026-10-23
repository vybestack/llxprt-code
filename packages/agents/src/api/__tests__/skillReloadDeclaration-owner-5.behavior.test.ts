import { openSkillsCaller } from './helpers/skills-fixture-caller.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { internalConfig, type Agent } from './helpers/agentHarness.js';
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

  const builtCredentials = useOwnedCredentials();

  it('publishes actual extension skills on load, restart and exact unload', async () => {
    const workspace = mkdtempSync(
      join(tmpdir(), 'extension-workspace-skills-'),
    );
    writeSkill(workspace, 'native');

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
      parameters: { enableExtensionReloading: true },
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
      await settle(agent);
      const loader = builtCallerMcp.extensionOperations;
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
      expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
      await loader.restart(extension);
      expect(modelVisibleSkillNames(agent).sort()).toStrictEqual([
        'extension-skill',
        'native',
      ]);
      await loader.unload(extension);
      expect(modelVisibleSkillNames(agent)).toStrictEqual(['native']);
      expect(agent.skills.get('extension-skill')).toBeUndefined();
    } finally {
      await agent?.dispose();
      await builtCallerClose();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
