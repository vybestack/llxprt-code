/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type {
  SubagentDefinitionReads,
  SubagentDefinitionWrites,
  ProfileDefinitionReads,
} from '@vybestack/llxprt-code-core';

export function useSubagentDialogCommands(
  reads: SubagentDefinitionReads,
  writes: SubagentDefinitionWrites,
  profiles: ProfileDefinitionReads,
  generatePrompt: (input: string) => Promise<string>,
) {
  return useMemo(
    () => ({
      listSubagentDefinitions: () => reads.listSubagents(),
      loadSubagentDefinition: (name: string) => reads.loadSubagent(name),
      saveSubagentDefinition: (name: string, profile: string, prompt: string) =>
        writes.saveSubagent(name, profile, prompt),
      deleteSubagentDefinition: (name: string) => writes.deleteSubagent(name),
      listSubagentProfiles: () => profiles.listProfiles(),
      generateSubagentPrompt: generatePrompt,
    }),
    [reads, writes, profiles, generatePrompt],
  );
}
