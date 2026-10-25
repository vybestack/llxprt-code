import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { clientSkillNames } from './helpers/skill-declaration-reads.js';
import { openSkillWorkspaceSession } from './helpers/skill-workspace-session.js';

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

  useFakeResponsesReplay('plain-text.jsonl');
  const builtCredentials = useOwnedCredentials();

  it('joins accepted queued reloads before withdrawing declarations and denying disposed activation', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'queued-workspace-skills-'));
    writeSkill(workspace, 'alpha');

    const {
      mcp: builtCallerMcp,
      client: builtCallerClient,
      close,
    } = await openSkillWorkspaceSession({
      authority: builtCredentials().authority,
      overrides: {
        skillsSupport: true,
        workingDir: workspace,
      },
    });

    const entered = publicationGate();
    const released = publicationGate();
    const owner = builtCallerMcp.workspaceSkills;
    let disposal: Promise<void> | undefined;
    const publish = builtCallerClient.setTools.bind(builtCallerClient);
    const publications: string[][] = [];
    const fault = vi
      .spyOn(builtCallerClient, 'setTools')
      .mockImplementation(async () => {
        await publish();
        publications.push(clientSkillNames(builtCallerClient).sort());
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
      expect(clientSkillNames(builtCallerClient)).toStrictEqual([]);
      expect(
        builtCallerClient.tools.getTool(ACTIVATE_SKILL_TOOL_NAME),
      ).toBeUndefined();
      expect(builtCallerMcp.isStopped()).toBe(false);
      expect(builtCallerClient.isInitialized()).toBe(true);
      await builtCallerClient.setTools();
    } finally {
      released.release();
      fault.mockRestore();
      await disposal;
      await close();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
