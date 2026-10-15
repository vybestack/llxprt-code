/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { SubagentManager } from '@vybestack/llxprt-code-core';
import { useCommandOwners } from '../../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../../__tests__/mockCommandContext.js';
import { createAppCommandBindings } from '../../../__tests__/appCommandBindings.js';
import { renderWithProviders, waitFor } from '../../../__tests__/render.js';
import { AppCommandsProvider } from '../../contexts/AppCommandsContext.js';
import { useSubagentDialogCommands } from '../../hooks/useSubagentDialogCommands.js';
import { useTextBuffer } from '../shared/text-buffer.js';
import { SubagentManagerDialog } from './SubagentManagerDialog.js';
import { SubagentView } from './types.js';

function OwnerDialog({
  definitions,
  profiles,
  decoy,
}: {
  definitions: SubagentManager;
  profiles: ProfileManager;
  decoy: SubagentManager;
}) {
  const buffer = useTextBuffer({
    initialText: '',
    viewport: { width: 80, height: 20 },
    isValidPath: () => false,
    onChange: () => {},
  });
  const value = createAppCommandBindings('subagent dialog', {
    buffer,
    commandContext: createMockCommandContext({
      services: { subagentManager: decoy, profileManager: profiles },
    }),
    generatePromptContent: null,
    inputHistory: [],
  });
  const commands = useSubagentDialogCommands(
    definitions,
    definitions,
    profiles,
    async () => {
      throw new Error('Catalog display must not generate prompts');
    },
  );
  const operations = {
    listSubagents: commands.listSubagentDefinitions,
    loadSubagent: commands.loadSubagentDefinition,
    saveSubagent: commands.saveSubagentDefinition,
    deleteSubagent: commands.deleteSubagentDefinition,
    listProfiles: commands.listSubagentProfiles,
    generatePrompt: commands.generateSubagentPrompt,
  };
  return (
    <AppCommandsProvider value={value}>
      <SubagentManagerDialog
        {...operations}
        onClose={() => {}}
        initialView={SubagentView.LIST}
      />
    </AppCommandsProvider>
  );
}

describe('subagent dialog registration owner', () => {
  const makeOwner = useCommandOwners();

  it('shows its bound definition catalog rather than invocation definitions', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    const profiles = new ProfileManager(
      join(owner.workspace.getWorkingDirectory(), 'profiles'),
    );
    const definitions = new SubagentManager(
      join(owner.workspace.getWorkingDirectory(), 'subagents'),
      profiles,
    );
    const otherProfiles = new ProfileManager(
      join(sibling.workspace.getWorkingDirectory(), 'profiles'),
    );
    const otherDefinitions = new SubagentManager(
      join(sibling.workspace.getWorkingDirectory(), 'subagents'),
      otherProfiles,
    );
    await profiles.saveProfile('registered', owner.captureProfile());
    await definitions.saveSubagent(
      'registered-reviewer',
      'registered',
      'Review changes',
    );
    const view = renderWithProviders(
      <OwnerDialog
        definitions={definitions}
        profiles={profiles}
        decoy={otherDefinitions}
      />,
    );
    await waitFor(() =>
      expect(view.lastFrame()).toContain('registered-reviewer'),
    );
    expect(await otherDefinitions.listSubagents()).toStrictEqual([]);
    view.unmount();
  });
});
