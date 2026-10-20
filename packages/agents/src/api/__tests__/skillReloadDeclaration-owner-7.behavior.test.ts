import { openSkillsCaller } from './helpers/skills-fixture-caller.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { internalConfig, type Agent } from './helpers/agentHarness.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { modelVisibleSkillNames } from './helpers/skills-fixture-declarations.js';

import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';

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

function publicationGate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('workspace skill publication compensation', () => {
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

  it('joins accepted queued reloads before withdrawing declarations and denying disposed activation', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'queued-workspace-skills-'));
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

    const agent = await fromConfig(
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
    const entered = publicationGate();
    const released = publicationGate();
    const owner = builtCallerMcp.workspaceSkills;
    let disposal: Promise<void> | undefined;
    await settle(agent);
    const publish = builtCallerClient.setTools.bind(builtCallerClient);
    const publications: string[][] = [];
    const fault = vi
      .spyOn(builtCallerClient, 'setTools')
      .mockImplementation(async () => {
        await publish();
        publications.push(modelVisibleSkillNames(agent).sort());
        if (publications.length === 1) {
          entered.release();
          await released.promise;
        }
      });
    try {
      writeSkill(workspace, 'beta');
      const first = owner.operations.reload();
      await entered.promise;
      writeSkill(workspace, 'gamma');
      const queued = owner.operations.reload();
      disposal = owner.dispose();
      await expect(owner.operations.activate('alpha')).rejects.toThrow(
        'disposed',
      );
      await expect(owner.operations.reload()).rejects.toThrow('disposed');
      released.release();
      await first;
      await queued;
      await disposal;
      expect(publications).toStrictEqual([
        ['alpha', 'beta'],
        ['alpha', 'beta', 'gamma'],
        [],
      ]);
      expect(owner.operations.list()).toStrictEqual([]);
      expect(modelVisibleSkillNames(agent)).toStrictEqual([]);
      expect(agent.tools.get(ACTIVATE_SKILL_TOOL_NAME)).toBeUndefined();
      expect(builtCallerMcp.isStopped()).toBe(false);
      expect(builtCallerClient.isInitialized()).toBe(true);
      await builtCallerClient.setTools();
    } finally {
      released.release();
      fault.mockRestore();
      await disposal;
      await agent.dispose();
      await builtCallerClose();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
