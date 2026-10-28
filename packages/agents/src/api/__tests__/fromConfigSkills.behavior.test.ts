import { beforeAll, afterAll, afterEach, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { type Agent } from '@vybestack/llxprt-code-agents';
import {
  ToolConfirmationOutcome,
  PolicyDecision,
} from '@vybestack/llxprt-code-core';
import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  createRecordingProvider,
  type RecordedRequest,
} from './helpers/recording-provider.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3382, second composition root.
 *
 * `Config` cannot construct the skill activation tool itself (issue #2417), so
 * it takes a registrar hook and silently registers nothing when none is
 * supplied. The agent adopts a Config the caller built, and a caller has no
 * reason to know that hook exists, so an adopted Config with skills enabled
 * would produce an agent whose model was never told any skill exists.
 *
 * The Config here is built the way an embedder would, without a registrar,
 * which is exactly the case under test. Nothing here installs one.
 */

/**
 * The skill names the model may pass to `activate_skill`, read from the
 * declarations the provider received with the latest request. Throws rather
 * than returning empty if the shape moves, so a refactor of the request's tool
 * declarations cannot turn this green by accident.
 */
function modelVisibleSkillNames(
  requests: readonly RecordedRequest[],
): string[] {
  if (requests.length === 0) {
    throw new Error('The provider received no request');
  }
  const declarations = requests[requests.length - 1].tools;
  if (declarations === undefined || declarations.length === 0) {
    throw new Error(
      'The provider request carries no tool declarations; the request shape may have changed',
    );
  }
  const declaration = declarations.find(
    (candidate) => candidate.name === ACTIVATE_SKILL_TOOL_NAME,
  );
  if (declaration === undefined) {
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

describe('fromConfig gives the model the skills the config discovered @issue:3382', () => {
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

  const credentials = useOwnedCredentials();
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('offers a skill from an adopted config that supplied no registrar', async () => {
    const recording = createRecordingProvider();
    const route = await openRouteBPreflight({
      authority: credentials().authority,
      contributions: recording.contributions,
      config: {
        provider: recording.alias,
        model: 'recording-default',
        skillsSupport: true,
      },
    });
    cleanups.push(() => route.close());
    writeSkill(route.directory, 'alpha');
    await route.prepare();
    const agent: Agent = await route.createAgent({
      provider: recording.alias,
      model: 'recording-default',
    });
    cleanups.push(() => agent.dispose());
    for await (const _event of agent.stream('hello')) {
      // Drain the turn so the chat session and its tool list exist.
    }

    expect(agent.skills.list().map((skill) => skill.name)).toContain('alpha');
    expect(modelVisibleSkillNames(recording.requests)).toContain('alpha');
    const tool = agent.tools.get(ACTIVATE_SKILL_TOOL_NAME);
    if (!tool) throw new Error('Missing published activation tool');
    const confirmation = await tool
      .build({ name: 'alpha' })
      .shouldConfirmExecute(new AbortController().signal);
    if (confirmation === false)
      throw new Error('Missing activation confirmation');
    await (
      confirmation as {
        onConfirm(outcome: ToolConfirmationOutcome): Promise<void>;
      }
    ).onConfirm(ToolConfirmationOutcome.ProceedAlways);
    expect(agent.policy.getRules()).toContainEqual(
      expect.objectContaining({
        toolName: ACTIVATE_SKILL_TOOL_NAME,
        decision: PolicyDecision.ALLOW,
      }),
    );
  });
});
