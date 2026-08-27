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

import { describe, it, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  buildAgent,
  internalConfig,
  type Agent,
} from './helpers/agentHarness.js';

interface ProviderToolDeclaration {
  readonly name: string;
  readonly description?: string;
  readonly parametersJsonSchema?: unknown;
}

/**
 * Reads the tool declarations ChatSession will send with the next provider
 * request. `generationConfig` is the object handed to the provider, so this is
 * the model's actual view rather than a proxy for it.
 *
 * There is no public read seam for this, so the shape is reached directly.
 * Every step is checked and throws on a mismatch rather than returning an
 * empty list, because a silent `?? []` here would let a refactor of
 * `ChatSession.setTools` turn these assertions green while the model saw
 * nothing.
 */
function providerToolDeclarations(config: Config): ProviderToolDeclaration[] {
  const chat = config.getAgentClient().getChat() as unknown as {
    generationConfig?: {
      tools?: Array<{ functionDeclarations?: ProviderToolDeclaration[] }>;
    };
  };
  const toolGroups = chat.generationConfig?.tools;
  if (!Array.isArray(toolGroups) || toolGroups.length === 0) {
    throw new Error(
      'ChatSession carries no tool groups; ChatSession.setTools may have changed shape',
    );
  }
  const declarations = toolGroups[0]?.functionDeclarations;
  if (!Array.isArray(declarations)) {
    throw new Error(
      'ChatSession tool group has no functionDeclarations; ChatSession.setTools may have changed shape',
    );
  }
  return declarations;
}

function activateSkillDeclaration(
  config: Config,
): ProviderToolDeclaration | undefined {
  return providerToolDeclarations(config).find(
    (declaration) => declaration.name === ACTIVATE_SKILL_TOOL_NAME,
  );
}

/** The skill names the model is allowed to pass to `activate_skill`. */
function modelVisibleSkillNames(config: Config): string[] {
  const declaration = activateSkillDeclaration(config);
  if (!declaration) {
    return [];
  }
  const schema = declaration.parametersJsonSchema as {
    properties?: { name?: { enum?: string[] } };
  };
  return schema.properties?.name?.enum ?? [];
}

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

async function withWorkspace(
  initialSkills: string[],
  run: (ctx: {
    agent: Agent;
    config: Config;
    workspace: string;
  }) => Promise<void>,
): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), 'llxprt-skill-reload-'));
  for (const name of initialSkills) {
    writeSkill(workspace, name);
  }
  const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
    skillsSupport: true,
    workingDir: workspace,
  });
  try {
    const config = await settle(agent);
    await run({ agent, config, workspace });
  } finally {
    await cleanup();
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe('skill reload reaches the model @issue:3379', () => {
  /**
   * No reload happens here. This is the startup path: `createAgent` installs
   * the registrar, `Config.initialize` discovers the skill and rebuilds the
   * tool, and the first turn hands the declaration to the chat session. Before
   * issue #3382 the public Agent API supplied no registrar, so this produced no
   * activate_skill tool at all.
   */
  it('offers a skill discovered at startup, with no reload @issue:3382', async () => {
    await withWorkspace(['alpha'], async ({ config }) => {
      expect(modelVisibleSkillNames(config)).toEqual(['alpha']);
    });
  });

  it('offers a skill added on disk after the session started', async () => {
    await withWorkspace(['alpha'], async ({ agent, config, workspace }) => {
      expect(modelVisibleSkillNames(config)).toEqual(['alpha']);

      writeSkill(workspace, 'beta');
      await agent.skills.reload();

      expect(modelVisibleSkillNames(config).sort()).toEqual(['alpha', 'beta']);
      expect(activateSkillDeclaration(config)?.description).toContain("'beta'");
    });
  });

  it('stops offering a skill removed from disk', async () => {
    await withWorkspace(
      ['alpha', 'beta'],
      async ({ agent, config, workspace }) => {
        expect(modelVisibleSkillNames(config).sort()).toEqual([
          'alpha',
          'beta',
        ]);

        removeSkill(workspace, 'beta');
        await agent.skills.reload();

        expect(modelVisibleSkillNames(config)).toEqual(['alpha']);
        expect(activateSkillDeclaration(config)?.description).not.toContain(
          "'beta'",
        );
      },
    );
  });

  it('offers the first skill in a session that started with none', async () => {
    await withWorkspace([], async ({ agent, config, workspace }) => {
      expect(activateSkillDeclaration(config)).toBeUndefined();

      writeSkill(workspace, 'alpha');
      await agent.skills.reload();

      expect(modelVisibleSkillNames(config)).toEqual(['alpha']);
    });
  });

  it('withdraws the tool once the last skill goes away', async () => {
    await withWorkspace(['alpha'], async ({ agent, config, workspace }) => {
      expect(activateSkillDeclaration(config)).toBeDefined();

      removeSkill(workspace, 'alpha');
      await agent.skills.reload();

      expect(activateSkillDeclaration(config)).toBeUndefined();
    });
  });
});
