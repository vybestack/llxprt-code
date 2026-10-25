import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerActivateSkillTool } from '../../skill-tool-registrar.js';
import { SkillsControl } from '../control/skillsControl.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openSkillPublicationOwner } from './helpers/skill-publication-owner.js';
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
  useFakeResponsesReplay('plain-text.jsonl');
  const callerCredentials = useOwnedCredentials();
  async function withWorkspace(
    initialSkills: string[],
    run: (ctx: {
      skills: SkillsControl;
      client: Awaited<ReturnType<typeof openSkillPublicationOwner>>['client'];
      workspace: string;
    }) => Promise<void>,
    operations: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    const workspace = mkdtempSync(join(tmpdir(), 'llxprt-skill-reload-'));
    for (const name of initialSkills) {
      writeSkill(workspace, name);
    }
    // The storage-isolation preload points LLXPRT_AGENTS_HOME at a temp root,
    // so discovery never reads the real ~/.agents/skills here; the strict set
    // assertions only ever see this workspace's skills.
    const opened = await openSkillPublicationOwner(
      callerCredentials().authority,
      workspace,
      operations,
    );
    const skills = new SkillsControl(opened.mcp.workspaceSkills.operations);
    try {
      await run({ skills, client: opened.client, workspace });
    } finally {
      await skills.dispose();
      await opened.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  }

  it('attempts republication and aggregates a failed real registration restore', async () => {
    let registration: ReturnType<typeof vi.spyOn> | undefined;
    let failRestore = false;
    const failed = new Error('publication failed');
    const restore = new Error('registration restore failed');
    await withWorkspace(
      ['alpha'],
      async ({ skills, client, workspace }) => {
        failRestore = true;
        const publish = client.setTools.bind(client);
        const fault = vi
          .spyOn(client, 'setTools')
          .mockImplementationOnce(async () => {
            await publish();
            throw failed;
          });
        writeSkill(workspace, 'beta');
        try {
          const error: unknown = await skills
            .reload()
            .catch((reason: unknown) => reason);
          if (
            !(error instanceof Error) ||
            !('cause' in error) ||
            !(error.cause instanceof AggregateError)
          )
            throw new Error('Expected aggregate control cause');
          expect(error.cause.errors).toStrictEqual([failed, restore]);
          expect(clientModelVisibleSkillNames(client)).toStrictEqual([]);
          expect(skills.list().map((skill) => skill.name)).toStrictEqual([
            'alpha',
          ]);
        } finally {
          fault.mockRestore();
          registration?.mockRestore();
          failRestore = false;
        }
        await skills.reload();
        expect(clientModelVisibleSkillNames(client).sort()).toStrictEqual([
          'alpha',
          'beta',
        ]);
      },
      {
        reloadPolicy: async () => ({}),
        registerTools: (tools, skills, bus) => {
          registerActivateSkillTool(tools, skills, bus);
          if (failRestore)
            registration = vi
              .spyOn(tools, 'registerTool')
              .mockImplementationOnce(() => {
                throw restore;
              });
        },
      },
    );
  });
});
