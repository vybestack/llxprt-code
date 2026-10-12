/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  ProfileManager,
  type SettingsService,
} from '@vybestack/llxprt-code-settings';
import {
  ContextState,
  SubagentTerminateMode,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import {
  SubagentOrchestrator,
  type SubagentOrchestratorOptions,
} from '../../core/subagentOrchestrator.js';
import {
  createSessionClientEngineFixture,
  type SessionClientEngineFixture,
} from './helpers/session-client-engine-fixture.js';

async function withChildOwner(
  scenario: (
    orchestrator: SubagentOrchestrator,
    parent: SessionClientEngineFixture,
    childSettings: () => SettingsService,
  ) => Promise<void>,
  runtimeLoader?: SubagentOrchestratorOptions['runtimeLoader'],
): Promise<void> {
  const built = await createSessionClientEngineFixture();
  const directory = join(
    built.config.projectTempDir,
    `child-owner-${randomUUID()}`,
  );
  const profiles = new ProfileManager(join(directory, 'profiles'));
  const subagents = new SubagentManager(join(directory, 'subagents'), profiles);
  try {
    await profiles.saveProfile('child-profile', {
      version: 1,
      provider: 'fake',
      model: 'fake-model',
      modelParams: {},
      ephemeralSettings: {},
    });
    await subagents.saveSubagent(
      'child',
      'child-profile',
      'Answer the parent question.',
    );
    let adoptedChildSettings: SettingsService | undefined;
    const orchestrator = new SubagentOrchestrator({
      workspaceTrust: built.mcp.trust,
      instructions: emptyInstructionReads,
      toolRegistry: built.owner.getAgentClient().tools,
      workspacePaths: built.mcp.workspacePaths,
      profileManager: profiles,
      subagentManager: subagents,
      foregroundConfig: built.config,
      createChildSettings: () => {
        adoptedChildSettings = built.handle.settingsOwner.createChildStore();
        return adoptedChildSettings;
      },
      readRunPolicy: () => built.handle.settingsOwner.readSubagentRunPolicy(),
      messageBus: built.messageBus,
      readMcpInstructions: built.mcp.readInstructions,
      runtimeLoader,
    });
    await scenario(orchestrator, built, () => {
      if (adoptedChildSettings === undefined)
        throw new Error('Child store has not been adopted');
      return adoptedChildSettings;
    });
  } finally {
    await built.cleanup();
  }
}

describe('Isolated child session client ownership', () => {
  it('withdraws child tool metadata immediately after adopted-store governance changes', async () => {
    await withChildOwner(async (orchestrator, parent, childSettings) => {
      const child = await orchestrator.launch({ name: 'child' });
      try {
        expect(child.runtime.toolsView.listToolNames()).toContain('read_file');
        childSettings().set('tools.allowed', []);
        expect(child.runtime.toolsView.listToolNames()).toStrictEqual([]);
        expect(
          child.runtime.toolsView.getToolMetadata('read_file'),
        ).toBeUndefined();
        expect(
          child.runtime.runtimeContext.readToolGovernance().allowedExplicit,
        ).toBe(true);
        expect(
          parent.owner
            .getAgentClient()
            .tools.getFunctionDeclarations()
            .map((tool) => tool.name),
        ).toContain('read_file');
      } finally {
        await child.dispose();
      }
    });
  }, 30000);

  it('enforces live caller-store output limits in each child launch', async () => {
    await withChildOwner(async (orchestrator, parent) => {
      parent.settingsService.set('subagent-max-output-tokens-total', 0);
      const limited = await orchestrator.launch({ name: 'child' });
      try {
        await limited.scope.runNonInteractive(new ContextState());
        expect(limited.scope.output.terminate_reason).toBe(
          SubagentTerminateMode.MAX_OUTPUT,
        );
        expect(limited.scope.output.output_tokens_total ?? 0).toBe(0);
      } finally {
        await limited.dispose();
      }
      parent.settingsService.set('subagent-max-output-tokens-total', -1);
      const continuing = await orchestrator.launch({ name: 'child' });
      try {
        await continuing.scope.runNonInteractive(new ContextState());
        expect(continuing.scope.output.terminate_reason).toBe(
          SubagentTerminateMode.GOAL,
        );
        expect(continuing.scope.output.output_tokens_total).toBeGreaterThan(0);
      } finally {
        await continuing.dispose();
      }
    });
  }, 30000);
  it('closes the child client after success without closing its parent', async () => {
    await withChildOwner(async (orchestrator, parent) => {
      const baseline = new Set(coreEvents.listeners(CoreEvent.ModelChanged));
      const child = await orchestrator.launch({ name: 'child' });
      expect(
        coreEvents
          .listeners(CoreEvent.ModelChanged)
          .filter((listener) => !baseline.has(listener)),
      ).not.toHaveLength(0);
      await child.dispose();
      expect(
        coreEvents
          .listeners(CoreEvent.ModelChanged)
          .filter((listener) => !baseline.has(listener)),
      ).toHaveLength(0);
      await parent.mcp.refreshContext();
      await parent.owner.getAgentClient().addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'parent continues' }],
      });
      expect(
        (await parent.owner.getAgentClient().getHistory()).filter(
          (item) => item.speaker === 'human',
        ),
      ).toHaveLength(1);
    });
  }, 30000);
  it('closes the child client after loader failure without closing its parent', async () => {
    await withChildOwner(
      async (orchestrator, parent) => {
        const baseline = new Set(coreEvents.listeners(CoreEvent.ModelChanged));
        await expect(orchestrator.launch({ name: 'child' })).rejects.toThrow(
          'Child loader failure',
        );
        expect(
          coreEvents
            .listeners(CoreEvent.ModelChanged)
            .filter((listener) => !baseline.has(listener)),
        ).toHaveLength(0);
        await parent.mcp.refreshContext();
        await parent.owner.getAgentClient().addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'parent continues' }],
        });
        expect(
          (await parent.owner.getAgentClient().getHistory()).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(1);
      },
      async () => {
        throw new Error('Child loader failure');
      },
    );
  }, 30000);
});
